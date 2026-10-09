/**
 * Support assistant — channel-agnostic conversation service.
 *
 * Today's provider is GUIDED: deterministic intent rules over the customer's
 * words, calling the same backend services as the rest of the support centre
 * (public tracking view, help-article search, ticket creation). It is labelled
 * as an automated menu in the UI and never claims to have done something it
 * didn't: every action it reports comes from a real service call.
 *
 * The `AssistantProvider` seam lets an LLM provider be added later (store
 * owner chose "no AI for now"); website chat, WhatsApp and voice would all call
 * `handleAssistantTurn`, so escalation rules stay identical across channels.
 *
 * Hand-off to a person happens when the customer asks for one, repeats that
 * the answers don't help, reports a safety hazard, or the request needs staff
 * (refund/replacement approval, payment problems). With a verified session the
 * ticket is created immediately with the transcript, so nobody has to repeat
 * themselves; otherwise the customer is sent to the ticket form pre-filled.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { supportTickets } from "@/db/schema";
import { getPublicTrackingView } from "@/lib/tracking/view";
import { waLink } from "@/lib/config";
import { listArticles } from "./kb";
import { createTicket } from "./tickets";
import { mentionsSafetyHazard, type TicketCategory } from "./rules";
import type { SupportSession } from "./session";

export type AssistantCard =
  | {
      kind: "tracking";
      orderId: string;
      status: string;
      lastCourierUpdateAt: string | null;
      lastCheckedAt: string | null;
      estimate: string;
      delay: string | null;
    }
  | { kind: "article"; slug: string; title: string; summary: string }
  | { kind: "ticket"; number: string }
  | { kind: "link"; label: string; href: string };

export type AssistantReply = {
  text: string[];
  cards: AssistantCard[];
  quickReplies: string[];
  handoff: { reason: string; category: TicketCategory; prefill: string } | null;
};

export type AssistantState = { pending?: "ORDER_ID"; dissatisfied?: number; lastIntent?: string };

export type AssistantTurn = {
  text: string;
  state: AssistantState;
  transcript: Array<{ from: "customer" | "assistant"; text: string }>;
  session: SupportSession | null;
  channel: "CHAT" | "WHATSAPP" | "VOICE";
};

export interface AssistantProvider {
  readonly name: string;
  reply(turn: AssistantTurn): Promise<{ reply: AssistantReply; state: AssistantState }>;
}

const MENU = ["Track my order", "Car not moving", "Battery or charging", "Refund status", "Return or replacement", "Talk to a person"];
const ORDER_RE = /\bPRC-[A-Z0-9]{4,12}\b/i;

const has = (t: string, re: RegExp) => re.test(t);

function estimateText(v: NonNullable<Awaited<ReturnType<typeof getPublicTrackingView>>>): string {
  const e = v.facts.estimate;
  switch (e.state) {
    case "COURIER":
      return e.arrivingToday ? "Arriving today" : `${e.dateText} (courier estimate)`;
    case "STORE_ESTIMATE":
      return `By ${e.dateText} (PRC estimate)`;
    case "EXPIRED":
      return "Delayed — updated estimate pending";
    case "DELIVERED":
      return "Delivered";
    default:
      return "Not available yet";
  }
}

function transcriptText(t: AssistantTurn["transcript"]): string {
  return t
    .slice(-20)
    .map((m) => `${m.from === "customer" ? "Customer" : "Assistant"}: ${m.text}`)
    .join("\n")
    .slice(0, 3500);
}

const reply = (r: Partial<AssistantReply>): AssistantReply => ({ text: [], cards: [], quickReplies: [], handoff: null, ...r });

async function recentTicketCount(customerId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportTickets)
    .where(and(eq(supportTickets.customerId, customerId), gte(supportTickets.createdAt, new Date(Date.now() - 10 * 60_000))));
  return r?.n ?? 0;
}

async function trackingReply(orderId: string): Promise<AssistantReply> {
  const v = await getPublicTrackingView(orderId.toUpperCase()).catch(() => null);
  if (!v) return reply({ text: [`I couldn't find order ${orderId.toUpperCase()}. Check the ID in your confirmation email — it looks like PRC-XXXXXXXX.`], quickReplies: ["Talk to a person"] });
  return reply({
    text: [
      v.delay ? `${v.delay.headline} I've noted it for our team.` : `Here's the latest on ${v.orderId}.`,
      ...(v.sync.healthy ? [] : ["We couldn't get a fresh update from the courier recently, so this is the last verified information."]),
    ],
    cards: [
      {
        kind: "tracking",
        orderId: v.orderId,
        status: v.facts.currentStatus,
        lastCourierUpdateAt: v.facts.lastCourierUpdateAt,
        lastCheckedAt: v.facts.lastCheckedAt,
        estimate: estimateText(v),
        delay: v.delay?.headline ?? null,
      },
    ],
    quickReplies: v.delay ? ["Raise a ticket about this delay", "Talk to a person"] : ["Something else"],
  });
}

async function articleReply(query: string, intro: string): Promise<AssistantReply> {
  const found = (await listArticles({ q: query }).catch(() => [])).slice(0, 3);
  if (!found.length) {
    return reply({ text: [intro, "I don't have a guide for that yet — let's get a person on it."], quickReplies: ["Talk to a person"] });
  }
  return reply({
    text: [intro, "These guides cover it — try the steps, and if it's still not fixed you can raise a request from the guide."],
    cards: found.map((a) => ({ kind: "article" as const, slug: a.slug, title: a.title, summary: a.summary })),
    quickReplies: ["Still not working", "Talk to a person"],
  });
}

export const guidedProvider: AssistantProvider = {
  name: "guided",
  async reply(turn) {
    const text = turn.text.trim().slice(0, 500);
    const t = text.toLowerCase();
    const state: AssistantState = { ...turn.state, pending: undefined };
    const orderInText = text.match(ORDER_RE)?.[0];

    const handoff = async (reason: string, category: TicketCategory): Promise<AssistantReply> => {
      const prefill = `${reason}\n\nChat so far:\n${transcriptText(turn.transcript)}`;
      // Same budget as the ticket form: a verified customer can't open more
      // than 3 tickets from chat in 10 minutes (the assistant route's own rate
      // limit allows 30 messages a minute).
      const recent = turn.session ? await recentTicketCount(turn.session.customerId) : 0;
      if (turn.session && recent >= 3) {
        return reply({
          text: ["You've opened several requests in the last few minutes — our team will pick them up. You can follow them under My tickets."],
          cards: [{ kind: "link", label: "My tickets", href: "/support/tickets" }],
        });
      }
      if (turn.session) {
        const created = await createTicket({
          category,
          description: prefill,
          orderId: category === "GENERAL" || category === "SPARE_PARTS" || category === "PAYMENT_ISSUE" ? null : turn.session.orderId,
          verifiedCustomerId: turn.session.customerId,
          contact: { email: turn.session.email },
          channel: turn.channel,
          actor: "customer",
          context: { handoff: reason, transcript: turn.transcript.slice(-20) },
        });
        return reply({
          text: [`I've passed this to our team as ticket ${created.number}, with this conversation attached — you won't need to repeat anything.`, "We reply within support hours (10 AM – 8 PM IST). You can also WhatsApp us."],
          cards: [{ kind: "ticket", number: created.number }, { kind: "link", label: "WhatsApp us", href: waLink(`Hi, about ticket ${created.number}.`) }],
        });
      }
      return reply({
        text: ["A person from our team will take this. Raise a request (this chat is copied into it), or WhatsApp us during support hours (10 AM – 8 PM IST)."],
        cards: [{ kind: "link", label: "WhatsApp us", href: waLink("Hi, I need help from a person.") }],
        handoff: { reason, category, prefill },
      });
    };

    // Safety first — always a person, always urgent.
    if (mentionsSafetyHazard(t)) {
      return {
        state,
        reply: {
          ...(await handoff("Customer reported a possible safety hazard (heat / smoke / swelling / burning).", "BATTERY_CHARGING")),
          text: ["Please unplug the car, stop using it and keep it away from anything flammable.", "I'm flagging this as urgent for our team."],
        },
      };
    }

    if (state.lastIntent && /\b(not help|useless|doesn'?t help|didn'?t help|still not|not working|no use|waste)\b/.test(t)) {
      state.dissatisfied = (state.dissatisfied ?? 0) + 1;
      if (state.dissatisfied >= 2) {
        return { state, reply: await handoff("Customer says the self-help answers didn't solve it.", "PRODUCT_NOT_WORKING") };
      }
    }

    if (turn.state.pending === "ORDER_ID" || orderInText) {
      if (orderInText) {
        state.lastIntent = "track";
        return { state, reply: await trackingReply(orderInText) };
      }
      state.pending = "ORDER_ID";
      return { state, reply: reply({ text: ["That doesn't look like an order ID. It looks like PRC-XXXXXXXX and is in your confirmation email."], quickReplies: ["Talk to a person"] }) };
    }

    if (has(t, /\b(human|person|agent|someone|call me|talk to|speak)\b/)) {
      return { state, reply: await handoff("Customer asked to talk to a person.", "GENERAL") };
    }
    if (has(t, /raise a ticket about this delay/)) {
      return { state, reply: await handoff("Customer reports a delivery delay.", "DELIVERY_DELAYED") };
    }
    if (has(t, /\b(track|where.*(order|parcel)|status|courier|awb|delivery|deliver)\b/)) {
      state.pending = "ORDER_ID";
      state.lastIntent = "track";
      return { state, reply: reply({ text: ["Sure — what's your order ID? It looks like PRC-XXXXXXXX."] }) };
    }
    if (has(t, /\b(refund|money back|deducted|debited|charged twice|double|payment)\b/)) {
      state.lastIntent = "money";
      return {
        state,
        reply: reply({
          text: [
            "Refund and payment details are private, so I'll need you to verify the order first (we email a code).",
            "Prepaid refunds take 5–7 working days after we start them; COD refunds 3–5 working days to your bank/UPI.",
          ],
          cards: [{ kind: "link", label: "Verify my order", href: "/support/order" }],
          quickReplies: ["Talk to a person"],
        }),
      };
    }
    if (has(t, /\b(return|replace|replacement|broken|damage|damaged|wrong item|missing|defect)\b/)) {
      state.lastIntent = "claim";
      return {
        state,
        reply: reply({
          text: [
            "Damaged, defective, wrong or missing items are covered for 7 days from delivery. You'll need a photo or short video.",
            "Verify your order, then choose the item and the problem — we check eligibility and stock straight away.",
          ],
          cards: [{ kind: "link", label: "Start a return / replacement", href: "/support/order?next=claim" }],
          quickReplies: ["Talk to a person"],
        }),
      };
    }
    if (has(t, /\b(charg|battery|power)\w*/)) {
      state.lastIntent = "tech";
      return { state, reply: await articleReply("charging", "Let's sort out the battery.") };
    }
    if (has(t, /\b(remote|pair|connect|signal)\w*/)) {
      state.lastIntent = "tech";
      return { state, reply: await articleReply("remote", "Let's get the remote talking to the car.") };
    }
    if (has(t, /\b(not moving|won'?t move|doesn'?t move|stuck|steer|wheel|motor|drift|slow)\w*/)) {
      state.lastIntent = "tech";
      return { state, reply: await articleReply("moving", "Let's get it moving.") };
    }
    if (has(t, /\b(spare|part|shell|tyre|tire)\w*/)) {
      state.lastIntent = "spares";
      return { state, reply: await articleReply("spare", "We stock spares.") };
    }
    if (has(t, /\b(still not working|something else)\b/)) {
      return { state, reply: reply({ text: ["No problem. What do you need help with?"], quickReplies: MENU }) };
    }

    return {
      state,
      reply: reply({
        text: [text ? "I can help with these — pick one, or type your order ID." : "Hi! I'm PRC's automated support menu. I can track orders, help with charging or remote problems, and connect you to our team."],
        quickReplies: MENU,
      }),
    };
  },
};

export function getAssistantProvider(): AssistantProvider {
  // Seam for a future LLM provider (SUPPORT_AI_PROVIDER). Only "guided" exists.
  return guidedProvider;
}

export async function handleAssistantTurn(turn: AssistantTurn) {
  return getAssistantProvider().reply(turn);
}

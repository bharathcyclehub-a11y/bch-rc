/**
 * Customer notices — tracking exceptions, support tickets, claims and refunds.
 *
 * Order-lifecycle emails stay on notifyOrderEvent (which deliberately sends
 * only the confirmation + delivered emails). Notices are a separate,
 * admin-configurable family that goes through the SAME durable outbox, so they
 * inherit its claim/lease, retry/backoff and provider idempotency:
 *
 *   - every notice has a dedup key (one row per logical event — a webhook
 *     replayed five times still sends once);
 *   - each kind can be switched off in /admin/support/settings;
 *   - non-urgent notices raised during quiet hours (IST) are deferred to the
 *     end of the window instead of being sent at night;
 *   - content is rendered at enqueue time and stored in the payload, so a
 *     retry sends exactly what was decided, even if the order changes later.
 *
 * WhatsApp follows the store-wide WHATSAPP_ENABLED switch. Business-initiated
 * WhatsApp messages need Meta-approved templates; until those exist the
 * channel stays off and notices go by email only.
 */

import { db } from "@/db";
import { notificationsOutbox } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { logError } from "@/lib/logger";
import { noticeSendAt, type QuietHours } from "./quiet-hours";
import { defaultChannels } from "./notify";
import { sendOutboxRow } from "./drain";

export const NOTICE_TEMPLATE = "CUSTOMER_NOTICE";

export const NOTICE_KINDS = [
  "OUT_FOR_DELIVERY",
  "DELIVERY_ATTEMPT_FAILED",
  "DELIVERY_DELAYED",
  "DELIVERY_ESTIMATE_UPDATED",
  "DELIVERY_EXCEPTION",
  "TICKET_CREATED",
  "TICKET_REPLY",
  "TICKET_RESOLVED",
  "CLAIM_DECISION",
  "REPLACEMENT_SHIPPED",
  "REFUND_INITIATED",
  "REFUND_CONFIRMED",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_LABEL: Record<NoticeKind, string> = {
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERY_ATTEMPT_FAILED: "Delivery attempt failed",
  DELIVERY_DELAYED: "Delivery estimate missed",
  DELIVERY_ESTIMATE_UPDATED: "Courier changed the delivery date",
  DELIVERY_EXCEPTION: "Courier exception (lost / damaged / held)",
  TICKET_CREATED: "Ticket received",
  TICKET_REPLY: "Support replied",
  TICKET_RESOLVED: "Ticket resolved",
  CLAIM_DECISION: "Return / replacement decision",
  REPLACEMENT_SHIPPED: "Replacement shipped",
  REFUND_INITIATED: "Refund initiated",
  REFUND_CONFIRMED: "Refund confirmed by the bank",
};

export type NoticeConfig = {
  enabled: Record<NoticeKind, boolean>;
  /** IST hours; a notice raised in [start, end) waits until `end`. */
  quietHours: QuietHours;
};

/**
 * Defaults. OUT_FOR_DELIVERY and DELIVERY_ESTIMATE_UPDATED start OFF to keep
 * the existing product decision of no routine mid-transit messages (see
 * CUSTOMER_FACING_TEMPLATES in notify.ts); everything a customer would
 * otherwise have to chase us for starts ON.
 */
export const DEFAULT_NOTICE_CONFIG: NoticeConfig = {
  enabled: {
    OUT_FOR_DELIVERY: false,
    DELIVERY_ATTEMPT_FAILED: true,
    DELIVERY_DELAYED: true,
    DELIVERY_ESTIMATE_UPDATED: false,
    DELIVERY_EXCEPTION: true,
    TICKET_CREATED: true,
    TICKET_REPLY: true,
    TICKET_RESOLVED: true,
    CLAIM_DECISION: true,
    REPLACEMENT_SHIPPED: true,
    REFUND_INITIATED: true,
    REFUND_CONFIRMED: true,
  },
  quietHours: { startHour: 21, endHour: 9 },
};

export async function loadNoticeConfig(): Promise<NoticeConfig> {
  const stored = await getSetting<Partial<NoticeConfig>>("notifications.config");
  return {
    enabled: { ...DEFAULT_NOTICE_CONFIG.enabled, ...(stored?.enabled ?? {}) },
    quietHours: stored && "quietHours" in stored ? (stored.quietHours ?? null) : DEFAULT_NOTICE_CONFIG.quietHours,
  };
}

export type NoticePayload = {
  kind: NoticeKind;
  to: string;
  toPhone: string | null;
  orderId: string | null;
  subject: string;
  html: string;
  text: string;
  whatsapp: string;
};

export type NoticeInput = {
  kind: NoticeKind;
  /** One logical event → one notice. e.g. `PRC-X:DELIVERY_DELAYED:2026-10-08`. */
  dedupKey: string;
  siteId: string | null;
  orderId: string | null;
  customerId: string | null;
  email: string | null;
  phone: string | null;
  subject: string;
  /** Plain paragraphs; rendered into the store email shell. */
  lines: string[];
  cta?: { label: string; url: string };
  /** Urgent notices ignore quiet hours (none today). */
  urgent?: boolean;
  now?: Date;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderNotice(input: NoticeInput): Pick<NoticePayload, "html" | "text" | "whatsapp"> {
  const body = input.lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${esc(l)}</p>`).join("");
  const cta = input.cta
    ? `<p><a href="${esc(input.cta.url)}" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">${esc(input.cta.label)}</a></p>`
    : "";
  const html = `<!DOCTYPE html><html lang="en-IN"><head><meta charset="utf-8"><title>${esc(input.subject)}</title></head>
<body style="margin:0;padding:24px;background:#f7f4ed;font-family:-apple-system,system-ui,Segoe UI,Helvetica,sans-serif;color:#0b0b0c">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
<div style="font-weight:900;font-size:22px;letter-spacing:-0.5px">PRC Cars</div>
<h1 style="font-size:20px;margin:14px 0 12px">${esc(input.subject)}</h1>
${body}${cta}
<hr style="border:none;border-top:1px solid #eee;margin:24px 0">
<div style="font-size:12px;color:#666">PRC Support Centre · https://pocketrccars.com/support</div>
</div></body></html>`;
  const text = [...input.lines, input.cta ? `${input.cta.label}: ${input.cta.url}` : "", "— PRC Support"]
    .filter(Boolean)
    .join("\n\n");
  const whatsapp = `*PRC Cars* — ${input.subject}\n${input.lines.join("\n")}${input.cta ? `\n${input.cta.url}` : ""}`;
  return { html, text, whatsapp };
}

/**
 * Enqueue a notice on every enabled channel. Never throws. Returns false when
 * the kind is switched off or the customer has no reachable channel.
 */
export async function sendCustomerNotice(input: NoticeInput): Promise<boolean> {
  try {
    const cfg = await loadNoticeConfig();
    if (!cfg.enabled[input.kind]) return false;
    const now = input.now ?? new Date();
    const sendAt = input.urgent ? now : noticeSendAt(now, cfg.quietHours);
    const rendered = renderNotice(input);
    let queued = false;

    for (const channel of defaultChannels()) {
      if (channel === "email" && !input.email) continue;
      if (channel === "whatsapp" && !input.phone) continue;
      const payload: NoticePayload = {
        kind: input.kind,
        to: input.email ?? "",
        toPhone: input.phone,
        orderId: input.orderId,
        subject: input.subject,
        ...rendered,
      };
      const inserted = await db
        .insert(notificationsOutbox)
        .values({
          siteId: input.siteId,
          orderId: input.orderId,
          customerId: input.customerId,
          channel,
          template: NOTICE_TEMPLATE,
          payload,
          dedupKey: `notice:${input.dedupKey}:${channel}`,
          nextAttemptAt: sendAt,
        })
        .onConflictDoNothing({ target: notificationsOutbox.dedupKey })
        .returning({ id: notificationsOutbox.id });
      if (inserted.length > 0) {
        queued = true;
        if (sendAt.getTime() <= now.getTime()) sendOutboxRow(inserted[0].id).catch(() => {});
      }
    }
    return queued;
  } catch (err) {
    logError("notify:notice", err, { kind: input.kind, orderId: input.orderId });
    return false;
  }
}

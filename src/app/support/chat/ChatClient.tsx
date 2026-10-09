"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, BadgeCheck, BookOpen, Headset, RotateCw, Send, Ticket, Truck } from "lucide-react";
import type { AssistantCard, AssistantReply, AssistantState } from "@/lib/support/assistant";
import { SUPPORT_HOURS, btnPrimary, fmtDateTime } from "../_components/ui";
import { writePrefill } from "../_lib/prefill";

type Line = { from: "customer" | "assistant"; text: string };
type Msg =
  | { id: number; from: "customer"; text: string }
  | { id: number; from: "assistant"; reply: AssistantReply }
  | { id: number; from: "error"; text: string; retry: string };

const GREETING: AssistantReply = {
  text: [
    "Hi! I'm PRC's automated support menu. I can track orders, help with charging or remote problems, and connect you to our team.",
  ],
  cards: [],
  quickReplies: ["Track my order", "Car not moving", "Battery or charging", "Refund status", "Return or replacement", "Talk to a person"],
  handoff: null,
};

const MAX_TEXT = 500;

export default function ChatClient({ verifiedAs }: { verifiedAs: string | null }) {
  const [messages, setMessages] = useState<Msg[]>([{ id: 0, from: "assistant", reply: GREETING }]);
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [state, setState] = useState<AssistantState>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  async function send(raw: string, echo = true) {
    const text = raw.trim().slice(0, MAX_TEXT);
    if (!text || busy) return;
    const lines: Line[] = [...transcript, { from: "customer" as const, text }].slice(-20);
    if (echo) setMessages((m) => [...m, { id: nextId.current++, from: "customer", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/support/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, state, transcript: lines }),
      });
      if (res.status === 429) throw new Error("rate");
      if (!res.ok) throw new Error("server");
      const data = (await res.json()) as { reply: AssistantReply; state: AssistantState };
      setState(data.state ?? {});
      setTranscript([...lines, { from: "assistant" as const, text: data.reply.text.join(" ").slice(0, 1000) }].slice(-20));
      setMessages((m) => [...m, { id: nextId.current++, from: "assistant", reply: data.reply }]);
    } catch (err) {
      const rate = err instanceof Error && err.message === "rate";
      setMessages((m) => [
        ...m,
        {
          id: nextId.current++,
          from: "error",
          text: rate
            ? "That's a lot of messages in a short time. Please wait a minute and try again."
            : "The support menu couldn't answer just now. Check your connection and try again, or WhatsApp us.",
          retry: text,
        },
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function retry(msg: Extract<Msg, { from: "error" }>) {
    setMessages((m) => m.filter((x) => x.id !== msg.id));
    void send(msg.retry, false);
  }

  /** Description for the ticket form: the hand-off text, or a short version of it. */
  function handoffPrefill(h: NonNullable<AssistantReply["handoff"]>) {
    const said = transcript.filter((l) => l.from === "customer").map((l) => `- ${l.text}`);
    const text = h.prefill.length <= 1000 ? h.prefill : `${h.reason}\n\nWhat I said in the support menu:\n${said.join("\n")}`;
    writePrefill({
      text: text.slice(0, 1000),
      category: h.category,
      source: "chat",
      context: { transcript: h.prefill.slice(0, 4000) },
    });
  }

  const lastAssistant = [...messages].reverse().find((m) => m.from === "assistant");

  return (
    <div className="flex flex-col rounded-2xl border border-brand-line bg-white">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-brand-line p-4">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-red-soft text-brand-red">
          <Headset size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold text-brand-ink">PRC Support</h1>
          <p className="text-xs text-brand-ink-soft">Automated support menu · team available {SUPPORT_HOURS}</p>
        </div>
        <button
          type="button"
          onClick={() => void send("Talk to a person")}
          disabled={busy}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-brand-ink px-4 text-sm font-semibold text-brand-ink hover:bg-brand-ink hover:text-white disabled:opacity-60"
        >
          Talk to a person
        </button>
      </div>

      {/* ── Conversation ─────────────────────────────────────────────── */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation with the automated support menu"
        aria-busy={busy}
        className="h-[60vh] min-h-80 max-h-[640px] space-y-4 overflow-y-auto overscroll-contain p-4"
      >
        {messages.map((m) => {
          if (m.from === "customer") {
            return (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-ink px-4 py-2.5 text-sm text-white break-words">
                  <span className="sr-only">You: </span>
                  {m.text}
                </p>
              </div>
            );
          }
          if (m.from === "error") {
            return (
              <div key={m.id} role="alert" className="flex max-w-[90%] items-start gap-2 rounded-2xl border border-tone-neg/30 bg-tone-neg-bg p-3 text-sm text-tone-neg">
                <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p>{m.text}</p>
                  <button
                    type="button"
                    onClick={() => retry(m)}
                    disabled={busy}
                    className="mt-1 inline-flex min-h-12 items-center gap-1.5 font-semibold underline underline-offset-4"
                  >
                    <RotateCw size={14} aria-hidden />
                    Try again
                  </button>
                </div>
              </div>
            );
          }
          const r = m.reply;
          const isLast = m === lastAssistant;
          return (
            <div key={m.id} className="max-w-[92%] space-y-2">
              <div className="rounded-2xl rounded-bl-md border border-brand-line bg-brand-cream px-4 py-3 text-sm text-brand-ink">
                <span className="sr-only">Support menu: </span>
                {r.text.map((t, i) => (
                  <p key={i} className={`break-words leading-relaxed ${i ? "mt-2" : ""}`}>
                    {t}
                  </p>
                ))}
              </div>
              {r.cards.map((c, i) => (
                <ChatCard key={i} card={c} />
              ))}
              {r.handoff && (
                <Link
                  href={`/support/new?category=${encodeURIComponent(r.handoff.category)}`}
                  onClick={() => handoffPrefill(r.handoff!)}
                  className={`${btnPrimary} w-full`}
                >
                  <Ticket size={18} aria-hidden />
                  Raise a request with this chat
                  <ArrowRight size={16} aria-hidden />
                </Link>
              )}
              {isLast && r.quickReplies.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1" aria-label="Suggested replies">
                  {r.quickReplies.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={busy}
                      onClick={() => void send(q)}
                      className="inline-flex min-h-12 items-center rounded-full border border-brand-ink bg-white px-4 text-sm font-medium text-brand-ink hover:bg-brand-ink hover:text-white disabled:opacity-60"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <p className="text-sm text-brand-ink-soft" aria-live="off">
            <span className="inline-flex gap-1" aria-hidden>
              <span className="h-2 w-2 rounded-full bg-neutral-400 motion-safe:animate-bounce" />
              <span className="h-2 w-2 rounded-full bg-neutral-400 motion-safe:animate-bounce [animation-delay:120ms]" />
              <span className="h-2 w-2 rounded-full bg-neutral-400 motion-safe:animate-bounce [animation-delay:240ms]" />
            </span>
            <span className="sr-only">The support menu is answering…</span>
          </p>
        )}
      </div>

      {/* ── Composer ─────────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-center gap-2 border-t border-brand-line p-3"
      >
        <label htmlFor="chat-input" className="sr-only">
          Type your message
        </label>
        <input
          ref={inputRef}
          id="chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={MAX_TEXT}
          autoComplete="off"
          enterKeyHint="send"
          placeholder="Type a question or your order ID…"
          className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-brand-line px-4 text-base text-brand-ink placeholder:text-brand-ink-soft/50 focus:border-brand-red focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send message"
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-red text-white hover:bg-brand-red-hover disabled:opacity-50"
        >
          <Send size={18} aria-hidden />
        </button>
      </form>

      <p className="flex items-start gap-2 border-t border-brand-line px-4 py-3 text-xs text-brand-ink-soft">
        {verifiedAs ? (
          <>
            <BadgeCheck size={14} aria-hidden className="mt-0.5 shrink-0 text-tone-pos" />
            <span>
              Verified as {verifiedAs}. If the menu passes you to our team, it raises the ticket for you with this chat
              attached.
            </span>
          </>
        ) : (
          <span>
            This is an automated menu, not a person. Order details stay private until you{" "}
            <Link href="/support/order" className="font-semibold text-brand-ink underline underline-offset-4">
              verify your order
            </Link>
            .
          </span>
        )}
      </p>
    </div>
  );
}

function ChatCard({ card }: { card: AssistantCard }) {
  switch (card.kind) {
    case "tracking":
      return (
        <div className="rounded-2xl border border-brand-line bg-white p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 font-mono font-bold text-brand-ink break-all">
              <Truck size={16} aria-hidden className="shrink-0 text-brand-red" />
              {card.orderId}
            </p>
          </div>
          <dl className="mt-2 space-y-1">
            <div className="flex justify-between gap-3">
              <dt className="text-brand-ink-soft">Status</dt>
              <dd className="text-right font-semibold text-brand-ink">{card.status}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-brand-ink-soft">Delivery</dt>
              <dd className="text-right text-brand-ink">{card.estimate}</dd>
            </div>
            {card.lastCourierUpdateAt && (
              <div className="flex justify-between gap-3">
                <dt className="text-brand-ink-soft">Last courier update</dt>
                <dd className="text-right font-mono text-xs text-brand-ink">{fmtDateTime(card.lastCourierUpdateAt)}</dd>
              </div>
            )}
            {card.lastCheckedAt && (
              <div className="flex justify-between gap-3">
                <dt className="text-brand-ink-soft">Checked</dt>
                <dd className="text-right font-mono text-xs text-brand-ink">{fmtDateTime(card.lastCheckedAt)}</dd>
              </div>
            )}
          </dl>
          {card.delay && <p className="mt-2 rounded-lg bg-tone-warn-bg p-2 text-xs text-tone-warn">{card.delay}</p>}
          <Link
            href={`/support/track?id=${encodeURIComponent(card.orderId)}`}
            className="mt-3 inline-flex min-h-12 items-center gap-1 font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
          >
            Open tracking
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      );
    case "article":
      return (
        <Link
          href={`/support/help/${card.slug}`}
          className="flex items-start gap-3 rounded-2xl border border-brand-line bg-white p-3 text-sm hover:border-brand-ink"
        >
          <BookOpen size={18} aria-hidden className="mt-0.5 shrink-0 text-brand-red" />
          <span className="min-w-0">
            <span className="block font-semibold text-brand-ink break-words">{card.title}</span>
            {card.summary && <span className="block text-brand-ink-soft break-words">{card.summary}</span>}
          </span>
        </Link>
      );
    case "ticket":
      return (
        <Link
          href={`/support/tickets/${card.number}`}
          className="flex min-h-12 items-center gap-3 rounded-2xl border border-tone-pos/30 bg-tone-pos-bg p-3 text-sm font-semibold text-tone-pos"
        >
          <Ticket size={18} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1">Ticket {card.number} — open it</span>
          <ArrowRight size={16} aria-hidden className="shrink-0" />
        </Link>
      );
    case "link": {
      const internal = card.href.startsWith("/");
      const cls =
        "inline-flex min-h-12 items-center gap-2 rounded-xl border border-brand-ink bg-white px-4 text-sm font-semibold text-brand-ink hover:bg-brand-ink hover:text-white";
      return internal ? (
        <Link href={card.href} className={cls}>
          {card.label}
          <ArrowRight size={14} aria-hidden />
        </Link>
      ) : (
        <a href={card.href} target="_blank" rel="noopener noreferrer" className={cls}>
          {card.label}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      );
    }
  }
}

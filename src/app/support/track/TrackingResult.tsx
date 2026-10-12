"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Info,
  RefreshCw,
  Truck,
  XCircle,
} from "lucide-react";
import type { JourneyStep, PublicTrackingView, Tone } from "@/lib/tracking/view";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { waLink } from "@/lib/config";

/* ── IST formatting (all view timestamps are ISO strings) ───────────────── */

const IST_DATE_TIME: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
};
const IST_DATE: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata", day: "numeric", month: "short" };

function fmtIst(iso: string | null, opts: Intl.DateTimeFormatOptions = IST_DATE_TIME): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("en-IN", opts);
}

/* ── Status tone → colour + icon (never colour alone) ──────────────────── */

const TONE_CLASS: Record<Tone, string> = {
  positive: "bg-tone-pos-bg text-tone-pos border-tone-pos/30",
  info: "bg-tone-info-bg text-tone-info border-tone-info/30",
  attention: "bg-tone-warn-bg text-tone-warn border-tone-warn/30",
  negative: "bg-tone-neg-bg text-tone-neg border-tone-neg/30",
  neutral: "bg-tone-neutral-bg text-tone-neutral border-tone-neutral/30",
};

function StatusIcon({ view, size, className }: { view: PublicTrackingView; size: number; className?: string }) {
  const p = { size, className, "aria-hidden": true } as const;
  if (view.orderState === "PAYMENT_PENDING" || view.orderState === "AWAITING_CONFIRMATION") return <Clock {...p} />;
  switch (view.headline.tone) {
    case "positive":
      return <CheckCircle2 {...p} />;
    case "attention":
      return <AlertTriangle {...p} />;
    case "negative":
      return <XCircle {...p} />;
    case "info":
      return <Truck {...p} />;
    default:
      return <Info {...p} />;
  }
}

const STATE_MESSAGE: Partial<Record<PublicTrackingView["orderState"], string>> = {
  PAYMENT_PENDING:
    "We haven't received the payment for this order yet. If you've just paid, it can take a minute to confirm — tap Refresh. If money left your account and this doesn't change, WhatsApp us with the order ID.",
  AWAITING_CONFIRMATION:
    "This is a cash-on-delivery order. Our team will call you to confirm it before we pack it — please keep your phone reachable.",
};

const VISIBLE_EVENTS = 8;

type Props = {
  view: PublicTrackingView;
  refreshing: boolean;
  refreshError: string | null;
  onRefresh: () => void;
};

export default function TrackingResult({ view, refreshing, refreshError, onRefresh }: Props) {
  const [showAllEvents, setShowAllEvents] = useState(false);
  const { facts, courier, orderState } = view;
  const tracked = orderState === "ACTIVE" || orderState === "DELIVERED";
  const hasTracking = !!courier || !!facts.lastCheckedAt || view.sync.pending;
  const events = showAllEvents ? view.events : view.events.slice(0, VISIBLE_EVENTS);
  const syncSince = fmtIst(facts.lastCheckedAt ?? view.sync.failingSince);
  const stateMessage =
    orderState === "CLOSED"
      ? `${view.closedReason ?? "This order is closed."} If you think this is wrong, WhatsApp us.`
      : STATE_MESSAGE[orderState];

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-brand-ink">Order status</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="min-h-12 inline-flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-semibold text-brand-ink hover:bg-neutral-50 disabled:opacity-60 transition-colors"
        >
          <RefreshCw size={16} aria-hidden className={refreshing ? "motion-safe:animate-spin" : undefined} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {refreshError && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-brand-red font-medium">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
          Couldn&apos;t refresh: {refreshError} Showing the previous result.
        </p>
      )}

      {/* ── Order card ─────────────────────────────────────────────────── */}
      <section
        aria-label={`Order ${view.orderId}`}
        className="rounded-2xl border border-brand-line bg-brand-cream p-4 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-brand-line pb-3">
          <div className="min-w-0">
            <p className="text-[11px] font-mono uppercase tracking-widest text-neutral-600">Order ID</p>
            <p className="font-mono text-base sm:text-lg font-bold text-brand-ink break-all">{view.orderId}</p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[view.headline.tone]}`}
          >
            <StatusIcon view={view} size={14} />
            {view.headline.label}
          </span>
        </div>

        {view.sync.pending ? (
          <Notice>Fetching the first courier update…</Notice>
        ) : !view.sync.healthy ? (
          <Notice>
            We couldn&apos;t get a fresh update from the courier{syncSince ? ` since ${syncSince}` : " recently"}.
            Showing the last verified information.
          </Notice>
        ) : null}

        {view.delay && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-amber-700" />
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-bold text-amber-900 leading-snug">{view.delay.headline}</p>
              {view.delay.details.length > 0 && (
                <ul className="space-y-1 text-amber-900 leading-normal">
                  {view.delay.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {stateMessage && <p className="text-sm text-brand-ink-soft leading-relaxed">{stateMessage}</p>}

        {tracked && <JourneyStrip steps={view.journey} />}

        <dl className="divide-y divide-brand-line border-t border-brand-line text-sm">
          <FactRow label="Current status">
            <span className="inline-flex items-center justify-end gap-1.5">
              <StatusIcon view={view} size={15} className="shrink-0" />
              {facts.currentStatus}
            </span>
          </FactRow>

          {tracked && (
            <FactRow label="Last courier update">
              {facts.lastCourierUpdateAt ? (
                <>
                  <time dateTime={facts.lastCourierUpdateAt} className="font-mono">
                    {fmtIst(facts.lastCourierUpdateAt)}
                  </time>
                  {facts.lastCourierUpdateText && (
                    <span className="mt-0.5 block text-xs font-normal text-neutral-600 break-words">
                      {facts.lastCourierUpdateText}
                    </span>
                  )}
                </>
              ) : (
                <span className="font-normal text-neutral-600">
                  {orderState === "DELIVERED" ? "Not available" : courier ? "Waiting for first courier scan" : "Not shipped yet"}
                </span>
              )}
            </FactRow>
          )}

          {tracked && hasTracking && (
            <FactRow label="Last tracking check" caption="Checked automatically">
              {facts.lastCheckedAt ? (
                <time dateTime={facts.lastCheckedAt} className="font-mono">
                  {fmtIst(facts.lastCheckedAt)}
                </time>
              ) : (
                <span className="font-normal text-neutral-600">Not checked yet</span>
              )}
            </FactRow>
          )}

          {tracked && facts.estimate.state !== "NONE" && (
            <FactRow label="Estimated delivery">
              <EstimateValue estimate={facts.estimate} />
            </FactRow>
          )}

          {courier && (
            <FactRow label="Courier">
              <span className="block">{courier.name ?? "Assigned"}</span>
              {courier.awb && (
                <span className="mt-0.5 flex items-center justify-end gap-1">
                  <span className="font-mono text-xs break-all">AWB {courier.awb}</span>
                  <CopyAwb awb={courier.awb} />
                </span>
              )}
            </FactRow>
          )}

          <FactRow label="Payment">
            <span className="font-normal">{view.payment}</span>
          </FactRow>
          <FactRow label="Order placed">
            <time dateTime={view.placedAt} className="font-mono font-normal">
              {fmtIst(view.placedAt)}
            </time>
          </FactRow>
        </dl>
      </section>

      {/* ── Courier timeline ───────────────────────────────────────────── */}
      {(view.events.length > 0 || orderState === "ACTIVE") && (
        <section
          aria-labelledby="courier-updates-heading"
          className="rounded-2xl border border-brand-line bg-white p-4 sm:p-6"
        >
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-brand-red">Activity log</p>
              <h2 id="courier-updates-heading" className="font-display text-lg font-bold text-brand-ink">
                Courier updates
              </h2>
            </div>
            {view.events.length > 1 && <span className="text-xs text-neutral-600">Newest first</span>}
          </div>

          {view.events.length === 0 ? (
            <p className="mt-3 text-sm text-brand-ink-soft leading-relaxed">
              No courier scans yet. Updates appear here once the courier picks up your parcel.
            </p>
          ) : (
            <>
              <ol className="relative mt-4 space-y-4 pl-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-line">
                {events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="relative">
                    <span
                      aria-hidden
                      className={`absolute -left-6 top-1 flex h-4 w-4 items-center justify-center rounded-full ${
                        i === 0 ? "bg-brand-red ring-4 ring-brand-red-soft" : "bg-neutral-300"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    </span>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <p className="text-sm font-bold text-brand-ink">
                        {e.label}
                        {i === 0 && <span className="sr-only"> (latest)</span>}
                      </p>
                      <time dateTime={e.at} className="shrink-0 font-mono text-xs text-neutral-600">
                        {fmtIst(e.at) ?? e.atText}
                      </time>
                    </div>
                    {(e.activity || e.location) && (
                      <p className="mt-0.5 text-sm text-brand-ink-soft break-words">
                        {[e.activity, e.location].filter(Boolean).join(" — ")}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
              {view.events.length > VISIBLE_EVENTS && (
                <button
                  type="button"
                  onClick={() => setShowAllEvents((v) => !v)}
                  aria-expanded={showAllEvents}
                  className="mt-3 min-h-12 text-sm font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
                >
                  {showAllEvents ? "Show fewer updates" : `Show all ${view.events.length} updates`}
                </button>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {tracked && (
          <Link
            href={`/support/new?order=${encodeURIComponent(view.orderId)}${orderState === "ACTIVE" ? "&category=DELIVERY_DELAYED" : ""}`}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-ink px-4 text-sm font-semibold text-white hover:bg-brand-ink-soft transition-colors"
          >
            <AlertTriangle size={18} aria-hidden />
            Report a delivery problem
          </Link>
        )}
        {courier?.trackingUrl && (
          <a
            href={courier.trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-semibold text-brand-ink hover:bg-neutral-50 transition-colors"
          >
            Track on courier site
            <ExternalLink size={16} aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        <a
          href={waLink(`Hi, I need an update on my order ${view.orderId}.`)}
          target="_blank"
          rel="noopener"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-tone-pos/30 bg-tone-pos-bg px-4 text-sm font-semibold text-tone-pos hover:bg-tone-pos/10 transition-colors"
        >
          <WhatsAppIcon size={18} aria-hidden />
          WhatsApp us about this order
          <span className="sr-only">(opens WhatsApp)</span>
        </a>
      </div>
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-brand-line bg-white p-3 text-sm text-brand-ink-soft">
      <Info size={18} aria-hidden className="mt-0.5 shrink-0 text-neutral-500" />
      <p className="min-w-0 leading-relaxed">{children}</p>
    </div>
  );
}

function FactRow({ label, caption, children }: { label: string; caption?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="shrink-0 text-neutral-600">
        {label}
        {caption && <span className="block text-xs text-neutral-500">{caption}</span>}
      </dt>
      <dd className="min-w-0 text-right font-semibold text-brand-ink">{children}</dd>
    </div>
  );
}

function EstimateValue({ estimate }: { estimate: PublicTrackingView["facts"]["estimate"] }) {
  switch (estimate.state) {
    case "COURIER": {
      const line = `${estimate.dateText ?? "Date pending"} · courier estimate`;
      return estimate.arrivingToday ? (
        <>
          <span className="block text-tone-pos">Arriving today</span>
          <span className="block text-xs font-normal text-neutral-600">{line}</span>
        </>
      ) : (
        <>{line}</>
      );
    }
    case "STORE_ESTIMATE":
      return <>{estimate.dateText ? `By ${estimate.dateText} (PRC estimate)` : "PRC estimate pending"}</>;
    case "EXPIRED":
      return (
        <>
          <span className="flex items-center justify-end gap-1 text-amber-700">
            <Clock size={14} aria-hidden className="shrink-0" />
            Awaiting updated courier estimate
          </span>
          {estimate.expiredDateText && (
            <span className="block text-xs font-normal text-neutral-500">
              <span className="sr-only">Previous estimate, no longer valid: </span>
              <del>was {estimate.expiredDateText}</del>
            </span>
          )}
        </>
      );
    case "UNAVAILABLE":
      return <span className="font-normal text-neutral-600">Updated estimate not available yet</span>;
    case "DELIVERED":
      return <>Delivered</>;
    default:
      return null;
  }
}

const STEP_STATE_TEXT: Record<JourneyStep["state"], string> = {
  done: "done",
  current: "current step",
  upcoming: "not yet",
  problem: "needs attention",
};

function JourneyStrip({ steps }: { steps: JourneyStep[] }) {
  const reached = steps.reduce((acc, s, i) => (s.state === "upcoming" ? acc : i), 0);
  const fill = steps.length > 1 ? (reached / (steps.length - 1)) * 100 : 0;
  return (
    <div className="relative pt-1">
      {/* Track runs centre-of-first to centre-of-last column. */}
      <div aria-hidden className="absolute left-[10%] right-[10%] top-[16px] h-0.5 bg-neutral-200" />
      <div
        aria-hidden
        className="absolute left-[10%] top-[16px] h-0.5 bg-brand-ink"
        style={{ width: `${fill * 0.8}%` }}
      />
      <ol aria-label="Order progress" className="relative grid grid-cols-5">
        {steps.map((s) => {
          const date = s.state !== "upcoming" ? fmtIst(s.at, IST_DATE) : null;
          return (
            <li key={s.key} className="flex min-w-0 flex-col items-center px-0.5 text-center">
              <StepDot state={s.state} />
              <span
                className={`mt-1 text-[11px] leading-tight break-words ${
                  s.state === "current"
                    ? "font-bold text-brand-red"
                    : s.state === "problem"
                      ? "font-bold text-amber-800"
                      : s.state === "done"
                        ? "font-medium text-brand-ink"
                        : "font-medium text-neutral-500"
                }`}
              >
                {s.label}
                <span className="sr-only"> ({STEP_STATE_TEXT[s.state]})</span>
              </span>
              {date && <span className="mt-0.5 font-mono text-[10px] text-neutral-500">{date}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepDot({ state }: { state: JourneyStep["state"] }) {
  const base = "flex h-6 w-6 items-center justify-center rounded-full";
  if (state === "done")
    return (
      <span aria-hidden className={`${base} bg-brand-ink text-white`}>
        <Check size={14} strokeWidth={3} />
      </span>
    );
  if (state === "current")
    return (
      <span aria-hidden className={`${base} bg-brand-red ring-4 ring-brand-red-soft`}>
        <span className="h-2 w-2 rounded-full bg-white" />
      </span>
    );
  if (state === "problem")
    return (
      <span aria-hidden className={`${base} bg-amber-500 text-white ring-4 ring-amber-100`}>
        <AlertTriangle size={13} strokeWidth={2.5} />
      </span>
    );
  return (
    <span aria-hidden className={`${base} border-2 border-neutral-300 bg-white`}>
      <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" />
    </span>
  );
}

function CopyAwb({ awb }: { awb: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(awb);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), 2500);
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy AWB ${awb}`}
        className="-my-3 -mr-2 inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-neutral-700 hover:bg-white hover:text-brand-ink transition-colors"
      >
        {status === "copied" ? (
          <Check size={16} aria-hidden className="text-tone-pos" />
        ) : (
          <Copy size={16} aria-hidden />
        )}
        <span aria-hidden>{status === "copied" ? "Copied" : status === "failed" ? "Failed" : "Copy"}</span>
      </button>
      <span aria-live="polite" className="sr-only">
        {status === "copied" ? "AWB copied" : status === "failed" ? "Couldn't copy the AWB" : ""}
      </span>
    </>
  );
}

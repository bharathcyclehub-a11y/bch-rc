"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Lock, MailCheck, ShieldCheck } from "lucide-react";
import { verifyOrderAction, type VerifyNext, type VerifyState } from "./actions";
import { btnOutline, btnPrimary, inputClass } from "../_components/ui";

const RESEND_AFTER_SEC = 45;

export default function VerifyFlow({ initialOrderId, next }: { initialOrderId: string; next: VerifyNext }) {
  const initial: VerifyState = {
    step: "details",
    orderId: initialOrderId,
    contact: "",
    next,
    challengeId: null,
    destination: null,
    sentCount: 0,
    error: null,
    errorCode: null,
    notice: null,
  };
  const [state, formAction, pending] = useActionState(verifyOrderAction, initial);

  // "Use different details" goes back to step 1 locally; any new server
  // answer takes over again.
  const [editing, setEditing] = useState(false);
  const [seenState, setSeenState] = useState(state);
  // Resend countdown restarts whenever a new code is sent.
  const [remaining, setRemaining] = useState(RESEND_AFTER_SEC);
  const [seenCount, setSeenCount] = useState(state.sentCount);
  if (state !== seenState) {
    setSeenState(state);
    setEditing(false);
  }
  if (state.sentCount !== seenCount) {
    setSeenCount(state.sentCount);
    setRemaining(RESEND_AFTER_SEC);
  }

  const showCode = state.step === "code" && !editing && !!state.challengeId;
  const ticking = showCode && remaining > 0;
  useEffect(() => {
    if (!ticking) return;
    const t = window.setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => window.clearInterval(t);
  }, [ticking]);

  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showCode) codeRef.current?.focus();
  }, [showCode, state.sentCount]);

  const codeDead = state.errorCode === "LOCKED" || state.errorCode === "EXPIRED";

  return (
    <div className="mt-6 space-y-4">
      {/* ── Step 1 ───────────────────────────────────────────────────── */}
      <section aria-labelledby="verify-step-1" className="rounded-2xl border border-brand-line bg-white p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="verify-step-1" className="font-display text-lg font-bold text-brand-ink">
            1. Find your order
          </h2>
          {showCode && (
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-tone-pos">
              <CheckCircle2 size={20} aria-hidden />
              Done
            </span>
          )}
        </div>

        {showCode ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="min-w-0 text-brand-ink-soft">
              Order <span className="font-mono font-semibold text-brand-ink">{state.orderId}</span>
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-12 px-2 font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
            >
              Use different details
            </button>
          </div>
        ) : (
          <form action={formAction} noValidate className="mt-4 space-y-4">
            <input type="hidden" name="next" value={next} />
            <div>
              <label htmlFor="verify-order-id" className="block text-sm font-semibold text-brand-ink">
                Order ID
              </label>
              <input
                id="verify-order-id"
                name="orderId"
                type="text"
                defaultValue={state.orderId}
                key={`oid-${state.orderId}`}
                placeholder="PRC-XXXXXXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={20}
                aria-describedby="verify-order-id-hint"
                className={`${inputClass} mt-1.5 font-mono uppercase tracking-widest`}
              />
              <p id="verify-order-id-hint" className="mt-1.5 text-xs text-brand-ink-soft">
                In your order confirmation email, SMS or WhatsApp.
              </p>
            </div>
            <div>
              <label htmlFor="verify-contact" className="block text-sm font-semibold text-brand-ink">
                Phone number or email used at checkout
              </label>
              <input
                id="verify-contact"
                name="contact"
                type="text"
                defaultValue={state.contact}
                key={`c-${state.contact}`}
                placeholder="98765 43210 or you@example.com"
                autoComplete="email"
                spellCheck={false}
                maxLength={120}
                className={`${inputClass} mt-1.5`}
              />
            </div>

            {state.error && state.step === "details" && <ErrorLine message={state.error} />}
            {state.errorCode === "NO_EMAIL" && (
              <Link href="/support/new?category=GENERAL" className={`${btnOutline} w-full`}>
                Raise a ticket instead
              </Link>
            )}

            <button type="submit" name="intent" value="start" disabled={pending} className={`${btnPrimary} w-full`}>
              {pending ? "Sending code…" : "Send verification code"}
              {!pending && <ArrowRight size={18} aria-hidden />}
            </button>
            <p className="text-xs text-brand-ink-soft leading-relaxed">
              We&apos;ll send a 6-digit code to the email on this order. Codes expire in 10 minutes.
            </p>
            <p className="flex items-start gap-2 text-xs text-brand-ink-soft">
              <Lock size={14} aria-hidden className="mt-0.5 shrink-0" />
              We never show order details without verification.
            </p>
          </form>
        )}
      </section>

      {/* ── Step 2 ───────────────────────────────────────────────────── */}
      <section
        aria-labelledby="verify-step-2"
        className={`rounded-2xl border p-4 sm:p-6 ${showCode ? "border-brand-ink bg-white" : "border-brand-line bg-brand-cream"}`}
      >
        <h2 id="verify-step-2" className="font-display text-lg font-bold text-brand-ink">
          2. Enter verification code
        </h2>
        {!showCode ? (
          <p className="mt-2 text-sm text-brand-ink-soft">Send the code first — it arrives by email within a minute.</p>
        ) : (
          <form action={formAction} noValidate className="mt-4 space-y-4">
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="orderId" value={state.orderId} />
            <input type="hidden" name="contact" value={state.contact} />
            <input type="hidden" name="challengeId" value={state.challengeId ?? ""} />
            <input type="hidden" name="destination" value={state.destination ?? ""} />

            <p className="flex items-start gap-2 rounded-xl bg-brand-cream p-3 text-sm text-brand-ink" role="status">
              <MailCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-tone-pos" />
              <span className="min-w-0 break-words">
                {state.notice ? `${state.notice} ` : ""}Code sent to{" "}
                <strong className="font-semibold">{state.destination ?? "the email on this order"}</strong>. Check spam
                if you can&apos;t see it.
              </span>
            </p>

            <div>
              <label htmlFor="verify-code" className="block text-sm font-semibold text-brand-ink">
                6-digit code
              </label>
              <input
                ref={codeRef}
                id="verify-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="••••••"
                aria-invalid={state.error ? true : undefined}
                aria-describedby={state.error ? "verify-code-error" : undefined}
                key={`code-${state.sentCount}`}
                className={`${inputClass} mt-1.5 text-center font-mono text-2xl tracking-[0.5em]`}
              />
            </div>

            {state.error && <ErrorLine id="verify-code-error" message={state.error} />}

            <button
              type="submit"
              name="intent"
              value="confirm"
              disabled={pending || codeDead}
              className={`${btnPrimary} w-full`}
            >
              <ShieldCheck size={18} aria-hidden />
              {pending ? "Checking…" : "Verify and view order"}
            </button>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              {remaining > 0 && !codeDead ? (
                <p className="flex min-h-12 items-center gap-2 text-sm text-brand-ink-soft" aria-live="off">
                  <Clock size={16} aria-hidden />
                  Resend in 0:{String(remaining).padStart(2, "0")}
                </p>
              ) : (
                <button
                  type="submit"
                  name="intent"
                  value="resend"
                  formNoValidate
                  disabled={pending}
                  className={`${btnOutline}`}
                >
                  Send a new code
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="min-h-12 px-2 text-sm font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
              >
                Use a different method
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function ErrorLine({ message, id }: { message: string; id?: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-brand-red">
      <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

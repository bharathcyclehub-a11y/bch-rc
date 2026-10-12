"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Headset, Ticket, X } from "lucide-react";
import { WhatsAppButton, btnOutline, btnPrimary } from "../../_components/ui";
import { writePrefill } from "../../_lib/prefill";

type Step = { title: string; text: string; image?: string };

/**
 * Guided fix: one step at a time. "This worked" records helpful feedback and
 * stops; "Still not working" reveals the next step, and after the last one
 * offers a ticket with the steps already tried copied in (sessionStorage).
 */
export default function GuidedSteps({
  slug,
  title,
  steps,
  ticketCategory,
}: {
  slug: string;
  title: string;
  steps: Step[];
  ticketCategory: string;
}) {
  const [revealed, setRevealed] = useState(1);
  const [outcome, setOutcome] = useState<"fixed" | "stuck" | null>(null);
  const [sentFeedback, setSentFeedback] = useState(false);
  const total = steps.length;

  function feedback(helpful: boolean) {
    if (sentFeedback) return;
    setSentFeedback(true);
    void fetch("/api/support/help/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, helpful }),
      keepalive: true,
    }).catch(() => {});
  }

  function focusStep(i: number) {
    requestAnimationFrame(() => document.getElementById(`step-${i}-title`)?.focus());
  }

  function worked() {
    setOutcome("fixed");
    feedback(true);
    requestAnimationFrame(() => document.getElementById("guide-outcome")?.focus());
  }

  function notWorking(i: number) {
    if (i + 1 < total) {
      setRevealed(Math.max(revealed, i + 2));
      focusStep(i + 1);
    } else {
      setOutcome("stuck");
      feedback(false);
      requestAnimationFrame(() => document.getElementById("guide-outcome")?.focus());
    }
  }

  const tried = steps.slice(0, revealed).map((s, i) => `${i + 1}. ${s.title}`);

  function raiseTicket() {
    const text = `I followed the guide "${title}" and it's still not working.\n\nSteps I tried:\n${tried.join("\n")}\n\nWhat happens now: `;
    writePrefill({
      text: text.slice(0, 1000),
      category: ticketCategory,
      source: "guide",
      context: { article: slug, stepsTried: tried.slice(0, 20) },
    });
  }

  if (total === 0) return null;

  return (
    <div className="space-y-4">
      <ol className="space-y-4" aria-label="Steps">
        {steps.slice(0, revealed).map((s, i) => {
          const current = i === revealed - 1 && !outcome;
          return (
            <li
              key={i}
              className={`rounded-2xl border p-4 sm:p-6 ${current ? "border-brand-ink bg-white" : "border-brand-line bg-brand-cream"}`}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${
                    current ? "bg-brand-red text-white" : "bg-brand-ink text-white"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <h2
                    id={`step-${i}-title`}
                    tabIndex={-1}
                    className="font-display text-lg font-bold text-brand-ink outline-none break-words"
                  >
                    <span className="sr-only">Step {i + 1} of {total}: </span>
                    {s.title}
                  </h2>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-brand-ink break-words">{s.text}</p>
                  {s.image && (
                    // Guide images can come from any host staff paste in; keep them as plain <img>.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.image} alt="" loading="lazy" className="mt-3 w-full max-w-md rounded-xl border border-brand-line" />
                  )}
                  {!current && i < revealed - 1 && (
                    <p className="mt-2 text-xs font-semibold text-brand-ink-soft">Tried — didn&apos;t fix it</p>
                  )}
                </div>
              </div>

              {current && (
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <button type="button" onClick={worked} className={`${btnOutline} flex-1 border-tone-pos/40 text-tone-pos`}>
                    <CheckCircle2 size={18} aria-hidden />
                    This worked
                  </button>
                  <button type="button" onClick={() => notWorking(i)} className={`${btnOutline} flex-1`}>
                    {i + 1 < total ? (
                      <>
                        Still not working — next step
                        <ArrowRight size={16} aria-hidden />
                      </>
                    ) : (
                      <>
                        <X size={16} aria-hidden />
                        Still not working
                      </>
                    )}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {revealed < total && !outcome && (
        <button
          type="button"
          onClick={() => setRevealed(total)}
          className="min-h-12 text-sm font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-red"
        >
          Show all {total} steps
        </button>
      )}

      <div id="guide-outcome" tabIndex={-1} className="outline-none" aria-live="polite">
        {outcome === "fixed" && (
          <div className="rounded-2xl border border-tone-pos/30 bg-tone-pos-bg p-4 sm:p-6">
            <p className="flex items-center gap-2 font-display text-lg font-bold text-tone-pos">
              <CheckCircle2 size={20} aria-hidden />
              Great — glad that sorted it!
            </p>
            <p className="mt-1 text-sm text-brand-ink">Thanks for letting us know. It helps us improve these guides.</p>
            <Link href="/support" className={`${btnOutline} mt-4`}>
              Back to Support
            </Link>
          </div>
        )}

        {outcome === "stuck" && <StillStuck category={ticketCategory} triedCount={tried.length} onRaise={raiseTicket} />}
      </div>

      {revealed === total && !outcome && (
        <StillStuck category={ticketCategory} triedCount={tried.length} onRaise={raiseTicket} subtle />
      )}
    </div>
  );
}

function StillStuck({
  category,
  triedCount,
  onRaise,
  subtle,
}: {
  category: string;
  triedCount: number;
  onRaise: () => void;
  subtle?: boolean;
}) {
  return (
    <section
      aria-labelledby={subtle ? undefined : "still-stuck"}
      className={`rounded-2xl p-4 sm:p-6 ${subtle ? "border border-brand-line" : "bg-brand-ink text-white"}`}
    >
      <h2
        id={subtle ? undefined : "still-stuck"}
        className={`flex items-center gap-2 font-display text-lg font-bold ${subtle ? "text-brand-ink" : "text-white"}`}
      >
        <Headset size={20} aria-hidden />
        Still not fixed?
      </h2>
      <p className={`mt-1 text-sm ${subtle ? "text-brand-ink-soft" : "text-white/80"}`}>
        Raise a ticket — we&apos;ll include the {triedCount} step{triedCount === 1 ? "" : "s"} you tried, so you
        don&apos;t have to repeat yourself.
      </p>
      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <Link href={`/support/new?category=${category}`} onClick={onRaise} className={`${btnPrimary} flex-1`}>
          <Ticket size={18} aria-hidden />
          Raise a ticket
        </Link>
        <WhatsAppButton message="Hi, I tried the help guide but my car still isn't working." />
      </div>
    </section>
  );
}

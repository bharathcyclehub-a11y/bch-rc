"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, RotateCcw } from "lucide-react";
import { btnDark, btnOutline, inputClass } from "../../_components/ui";
import { closeTicketAction, reopenTicketAction } from "../actions";

/** "Problem solved? Close" and "Reopen" for the customer ticket page. */
export default function TicketControls({
  number,
  token,
  canClose,
  canReopen,
  reopenDays,
}: {
  number: string;
  token: string | null;
  canClose: boolean;
  canReopen: boolean;
  reopenDays: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  function run(kind: "close" | "reopen") {
    const fd = new FormData();
    fd.set("number", number);
    if (token) fd.set("k", token);
    if (kind === "reopen") fd.set("reason", reason);
    setError(null);
    startTransition(async () => {
      try {
        const res = kind === "close" ? await closeTicketAction(fd) : await reopenTicketAction(fd);
        if (!res.ok) setError(res.error);
        else {
          setConfirming(false);
          setReason("");
        }
      } catch {
        setError("That didn't go through. Check your connection and try again.");
      }
    });
  }

  if (!canClose && !canReopen) return null;

  return (
    <div className="space-y-3">
      {canClose &&
        (confirming ? (
          <div className="rounded-xl border border-brand-line p-4">
            <p className="text-sm text-brand-ink">
              Mark this request as solved? You can reopen it within {reopenDays} days if anything comes up.
            </p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <button type="button" disabled={pending} onClick={() => run("close")} className={`${btnDark} flex-1`}>
                <CheckCircle2 size={16} aria-hidden />
                {pending ? "Closing…" : "Yes, it's solved"}
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={`${btnOutline} flex-1`}>
                Not yet
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={`${btnOutline} w-full`}>
            <CheckCircle2 size={16} aria-hidden />
            Problem solved? Close this request
          </button>
        ))}

      {canReopen && (
        <div className="rounded-xl border border-brand-line p-4">
          <label htmlFor="reopen-reason" className="block text-sm font-semibold text-brand-ink">
            Still not sorted? Reopen this request
          </label>
          <textarea
            id="reopen-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="What's still wrong?"
            className={`${inputClass} mt-2 resize-y`}
          />
          <button type="button" disabled={pending} onClick={() => run("reopen")} className={`${btnDark} mt-3 w-full`}>
            <RotateCcw size={16} aria-hidden />
            {pending ? "Reopening…" : "Reopen request"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-brand-red">
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

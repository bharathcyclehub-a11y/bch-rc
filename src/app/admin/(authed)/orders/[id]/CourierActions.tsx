"use client";

import { useState, useTransition } from "react";
import { FileDown, RefreshCw, Truck } from "lucide-react";
import { Button } from "@/components/admin/Button";
import { cn } from "@/lib/utils";
import {
  bookWithProviderAction,
  courierLabelAction,
  recheckCourierRoutingAction,
  recordCourierBilledAction,
  type CourierActionResult,
} from "./courier-actions";

type Props = {
  orderId: string;
  canBook: boolean;
  canCosts: boolean;
  /** Providers staff may choose now (before an AWB), with their labels. */
  bookable: Array<{ provider: string; label: string; recommended: boolean }>;
  hasAwb: boolean;
  billedInr: number | null;
};

/** Recheck / book-with / label / billed-cost controls for one order. */
export function CourierActions({ orderId, canBook, canCosts, bookable, hasAwb, billedInr }: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [billed, setBilled] = useState(billedInr != null ? String(billedInr) : "");

  const run = (fn: () => Promise<CourierActionResult>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      setResult(null);
      const r = await fn();
      if (r.ok && r.url) window.open(r.url, "_blank", "noopener");
      setResult(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {canBook && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            icon={<RefreshCw size={14} aria-hidden />}
            onClick={() => run(() => recheckCourierRoutingAction(orderId))}
          >
            Recheck couriers
          </Button>
        )}
        {canBook &&
          !hasAwb &&
          bookable.map((b) => (
            <Button
              key={b.provider}
              size="sm"
              variant={b.recommended ? "primary" : "secondary"}
              disabled={pending}
              icon={<Truck size={14} aria-hidden />}
              onClick={() =>
                run(
                  () => bookWithProviderAction(orderId, b.provider),
                  `Book this order with ${b.label}? If it is on Shiprocket without an AWB, that Shiprocket order is cancelled first.`,
                )
              }
            >
              Book with {b.label}
            </Button>
          ))}
        {canBook && hasAwb && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            icon={<FileDown size={14} aria-hidden />}
            onClick={() => run(() => courierLabelAction(orderId))}
          >
            Label
          </Button>
        )}
      </div>

      {canCosts && hasAwb && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => recordCourierBilledAction(orderId, Number(billed)));
          }}
        >
          <label className="text-xs text-admin-muted" htmlFor={`billed-${orderId}`}>
            Billed (₹, from invoice)
          </label>
          <input
            id={`billed-${orderId}`}
            inputMode="decimal"
            value={billed}
            onChange={(e) => setBilled(e.target.value)}
            className="w-24 rounded-md border border-admin-line bg-white px-2 py-1 text-sm"
          />
          <Button size="sm" variant="ghost" type="submit" disabled={pending || !billed}>
            Save
          </Button>
        </form>
      )}

      {result && (
        <p role="status" className={cn("text-xs leading-4", result.ok ? "text-tone-pos" : "text-tone-neg")}>
          {result.text}
        </p>
      )}
    </div>
  );
}

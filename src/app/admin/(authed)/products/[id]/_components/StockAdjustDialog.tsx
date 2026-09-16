"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/admin/Dialog";
import { Button } from "@/components/admin/Button";
import { SegmentedControl } from "@/components/admin/SegmentedControl";
import { Stepper } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import { STOCK_META, stockStateOf, TONE_TEXT } from "@/lib/admin/status";

export type AdjustTarget = { slug: string; name: string; stock: number | null };
type Mode = "add" | "remove" | "set";

/**
 * Stock change for one variant through the audited inventory API
 * (/api/admin/inventory: `set` = absolute count, `adjust` = ± delta clamped at
 * 0). Add is the default — a carton arriving is the common case.
 */
export function StockAdjustDialog({
  productId,
  productName,
  target,
  lowThreshold,
  onClose,
}: {
  productId: string;
  productName: string;
  target: AdjustTarget | null;
  lowThreshold: number;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      variant="sheet"
      title={target ? `Adjust stock · ${target.name}` : "Adjust stock"}
      description={productName}
    >
      {target && (
        <AdjustBody productId={productId} target={target} lowThreshold={lowThreshold} onClose={onClose} />
      )}
    </Dialog>
  );
}

function AdjustBody({
  productId,
  target,
  lowThreshold,
  onClose,
}: {
  productId: string;
  target: AdjustTarget;
  lowThreshold: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const current = target.stock ?? 0;
  const [mode, setMode] = useState<Mode>("add");
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);

  const next = mode === "set" ? amount : mode === "add" ? current + amount : Math.max(0, current - amount);
  const unchanged = target.stock !== null && next === current;
  const nextState = STOCK_META[stockStateOf(next, lowThreshold)];

  async function save() {
    setBusy(true);
    const body =
      mode === "set"
        ? { skuId: productId, variantSlug: target.slug, mode: "set", value: amount }
        : { skuId: productId, variantSlug: target.slug, mode: "adjust", value: mode === "add" ? amount : -amount };
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { before?: number | null; after?: number; error?: string };
      if (!res.ok) {
        toast({ title: "Stock not changed", description: data.error ?? "Try again.", tone: "error" });
        setBusy(false);
        return;
      }
      toast({
        title: "Stock updated",
        description: `${target.name}: ${data.before ?? "—"} → ${data.after ?? next}`,
        tone: "success",
      });
      onClose();
      router.refresh();
    } catch {
      toast({ title: "Stock not changed", description: "Check your connection and try again.", tone: "error" });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg bg-admin-subtle px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">Now</p>
          <p className="text-2xl font-semibold tabular-nums">{target.stock === null ? "—" : current}</p>
        </div>
        <ArrowRight size={18} aria-hidden className="text-admin-muted" />
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">After</p>
          <p className={cn("text-2xl font-semibold tabular-nums", TONE_TEXT[nextState.tone])}>{next}</p>
        </div>
      </div>

      <SegmentedControl
        ariaLabel="Adjustment type"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setAmount(m === "set" ? current : 1);
        }}
        className="flex w-full [&>button]:flex-1"
        options={[
          { value: "add", label: "Add" },
          { value: "remove", label: "Remove" },
          { value: "set", label: "Set count" },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Stepper value={amount} onChange={setAmount} min={0} label={mode === "set" ? "New stock count" : "Units"} />
        {mode !== "set" && (
          <div className="flex gap-1.5">
            {[5, 10, 25].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(n)}
                className="h-9 rounded-full border border-admin-line px-3 text-[13px] font-medium text-brand-ink-soft hover:border-admin-line-strong hover:text-brand-ink max-md:h-10"
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-admin-muted">
        {mode === "set"
          ? "Use after a physical count. Every change is logged with your name."
          : "Orders in flight are unaffected — they already reserved their units. Every change is logged with your name."}
      </p>

      <div className="-mx-4 -mb-4 flex gap-2 border-t border-admin-line px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 sm:-mx-5 sm:px-5">
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" className="flex-[2]" onClick={save} loading={busy} disabled={unchanged || (mode !== "set" && amount === 0)}>
          Save stock
        </Button>
      </div>
    </div>
  );
}

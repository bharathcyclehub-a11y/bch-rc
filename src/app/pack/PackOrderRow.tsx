"use client";

import { useState, useTransition } from "react";
import {
  Printer,
  FileText,
  Check,
  Loader2,
  MapPin,
  AlertCircle,
  Package,
  Truck,
  ClipboardList,
  X,
} from "lucide-react";
import {
  printLabelAction,
  markDispatchedAction,
  cancelOrderFromPackAction,
  generateAwbAction,
  printManifestForOrderAction,
  schedulePickupForOrderAction,
} from "./actions";

type Props = {
  orderId: string;
  status: string;
  awbCode: string | null;
  courierName: string | null;
  /** "shiprocket" | "delhivery" — the platform the order is booked on. */
  courierProvider?: string;
  invoiceNumber: string | null;
  placedAt: Date | string | null;
  shippingAddress: {
    fullName: string;
    phone: string;
    city: string;
    state: string;
    pincode: string;
    email?: string;
  };
  items: Array<{
    name: string;
    qty: number;
    image?: string | null;
    skuId?: string;
    variantSlug?: string | null;
  }>;
  paymentMethod: string;
  totalInr: number;
  confirmationFeeInr: number;
  manifestedAt: Date | string | null;
  manifestUrl: string | null;
  pickupScheduledAt: Date | string | null;
  packedAt: Date | string | null;
  shippedAt: Date | string | null;
  showActions: boolean;
};

function formatTime(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  // PIN the timezone to IST. Without an explicit timeZone, the server renders
  // in UTC and the browser in the user's local zone → different text → React
  // hydration mismatch (#418) which kills all interactivity on /pack (the
  // "Generate AWB" button silently did nothing). Fixed by rendering IST on
  // both sides so server HTML === client HTML.
  return date.toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

export function PackOrderRow({
  orderId,
  status,
  awbCode,
  courierName,
  courierProvider = "shiprocket",
  invoiceNumber,
  placedAt,
  shippingAddress,
  items,
  paymentMethod,
  totalInr,
  confirmationFeeInr,
  manifestedAt,
  manifestUrl,
  pickupScheduledAt,
  packedAt,
  shippedAt,
  showActions,
}: Props) {
  const [busy, startTransition] = useTransition();
  const [busyKind, setBusyKind] = useState<
    "label" | "invoice" | "dispatch" | "cancel" | "awb" | "manifest" | "pickup" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  function handleGenerateAwb() {
    setError(null);
    setBusyKind("awb");
    startTransition(async () => {
      const result = await generateAwbAction(orderId);
      setBusyKind(null);
      if (!result.ok) setError(result.error);
      // On success the action revalidates and the row moves to Ready to Ship.
    });
  }

  function handleManifest() {
    setError(null);
    setBusyKind("manifest");
    startTransition(async () => {
      const result = await printManifestForOrderAction(orderId);
      setBusyKind(null);
      if (result.ok) {
        // Delhivery has no manifest sheet (url null) — nothing to open.
        if (result.manifestUrl) window.open(result.manifestUrl, "_blank", "noopener");
        // Action revalidates → row moves to Pickups & Manifests.
      } else {
        setError(result.error);
      }
    });
  }

  function handleSchedulePickup() {
    setError(null);
    setBusyKind("pickup");
    startTransition(async () => {
      const result = await schedulePickupForOrderAction(orderId);
      setBusyKind(null);
      if (!result.ok) setError(result.error);
    });
  }

  function handlePrintLabel() {
    setError(null);
    setBusyKind("label");
    startTransition(async () => {
      const result = await printLabelAction(orderId);
      setBusyKind(null);
      if (result.ok) {
        window.open(result.labelUrl, "_blank", "noopener");
      } else {
        setError(result.error);
      }
    });
  }

  // Branded PRC GST tax invoice (boAt-style) — replaces Shiprocket's generic
  // invoice. Opens our own print-ready page; no server round-trip needed.
  // The legacy Shiprocket invoice (printInvoiceAction) is kept in actions.ts
  // as a fallback but no longer wired to a button.
  function handlePrintInvoice() {
    setError(null);
    window.open(`/pack/invoice/${orderId}`, "_blank", "noopener");
  }

  function handleMarkDispatched() {
    setError(null);
    setBusyKind("dispatch");
    startTransition(async () => {
      const result = await markDispatchedAction(orderId);
      setBusyKind(null);
      if (!result.ok) setError(result.error);
      // On success, revalidatePath in the action will refresh the list
      // and this row will move to the "Dispatched" tab automatically.
    });
  }

  function handleCancel() {
    // Browser confirm avoids accidental cancels — packing employee may
    // tap this by mistake in a busy queue.
    const reason = window.prompt(
      `Cancel order ${orderId}?\n\nType a short reason (e.g. "test order", "wrong address"). Cancelling here also cancels the ${courierProvider === "delhivery" ? "Delhivery" : "Shiprocket"} shipment.`,
      "test order",
    );
    if (!reason || reason.trim().length < 2) return;
    setError(null);
    setBusyKind("cancel");
    startTransition(async () => {
      const result = await cancelOrderFromPackAction(orderId, reason.trim());
      setBusyKind(null);
      if (!result.ok) setError(result.error);
    });
  }

  const isCod = paymentMethod === "COD";
  const itemCount = items.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="bg-white rounded-xl border border-brand-line text-brand-ink p-3 sm:p-4 shadow-sm">
      {/* Top row — order id + status + amount */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold">{orderId}</span>
            <StatusBadge status={status} hasAwb={!!awbCode} />
            {isCod && (
              <span className="text-[10px] font-mono uppercase tracking-widest font-bold bg-warning/15 text-warning px-1.5 py-0.5 rounded">
                COD
              </span>
            )}
          </div>
          <p className="text-xs text-brand-ink-soft mt-0.5 font-mono">
            Ordered {formatTime(placedAt)}
            {status === "SHIPPED" && shippedAt
              ? ` · Dispatched ${formatTime(shippedAt)}`
              : packedAt
                ? ` · Packed ${formatTime(packedAt)}`
                : ""}
          </p>
          {invoiceNumber && (
            <p className="text-[11px] text-brand-ink-soft mt-0.5 font-mono">
              <span className="uppercase tracking-widest">Invoice</span>{" "}
              <span className="font-semibold text-brand-ink">
                {invoiceNumber}
              </span>
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold tabular-nums">₹{totalInr.toLocaleString("en-IN")}</div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-brand-ink-soft">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </div>
          {/* Partial-prepaid COD: show what's already paid vs collected at the
              door so the packer knows the exact cash to expect. */}
          {isCod && confirmationFeeInr > 0 && (
            <div className="mt-1 text-[10px] font-mono text-brand-ink-soft leading-tight">
              <div>
                paid{" "}
                <span className="text-success font-semibold">
                  ₹{confirmationFeeInr.toLocaleString("en-IN")}
                </span>
              </div>
              <div>
                collect{" "}
                <span className="text-brand-red font-semibold">
                  ₹{(totalInr - confirmationFeeInr).toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Customer + items */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
        <div className="space-y-2">
          {items.map((it, idx) => (
            <PackOrderItem key={idx} item={it} />
          ))}
        </div>

        {/* Address column */}
        <div className="text-xs text-brand-ink-soft sm:text-right sm:max-w-[200px]">
          <div className="font-semibold text-brand-ink">
            {shippingAddress.fullName}
          </div>
          <div className="font-mono mt-0.5">{shippingAddress.phone}</div>
          <div className="flex items-center gap-1 mt-1 sm:justify-end">
            <MapPin size={11} className="shrink-0" />
            <span>
              {shippingAddress.city} · {shippingAddress.pincode}
            </span>
          </div>
        </div>
      </div>

      {/* AWB strip */}
      {awbCode && (
        <div className="mt-3 bg-brand-cream rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
          <div className="font-mono text-xs">
            <span className="text-brand-ink-soft uppercase tracking-widest mr-1.5">
              AWB
            </span>
            <span className="font-semibold">{awbCode}</span>
          </div>
          {courierName && (
            <span className="text-[10px] font-mono uppercase tracking-widest text-brand-ink-soft">
              via {courierName}
            </span>
          )}
        </div>
      )}

      {/* Manifest / pickup state strip — shows once the order has moved into
          the Pickups & Manifests stage. */}
      {(manifestedAt || pickupScheduledAt) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-brand-ink-soft">
          {manifestedAt && (
            <span className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-success" />
              Manifested {formatTime(manifestedAt)}
              {manifestUrl && (
                <a
                  href={manifestUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-brand-ink"
                >
                  view
                </a>
              )}
            </span>
          )}
          {pickupScheduledAt && (
            <span className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-success" />
              Pickup scheduled {formatTime(pickupScheduledAt)}
            </span>
          )}
        </div>
      )}

      {/* Actions
          Cancel is available whenever the order is still cancellable
          (PAID or PACKED, AWB or not), so the packer can kill a test
          order that's stuck in AWB-pending. Print label / Invoice /
          Mark dispatched only appear after the AWB lands, since they
          all need the Shiprocket shipment_id. The whole block is gated
          on showActions which the page sets to false on Dispatched. */}
      {showActions && (
        <div className="mt-3 flex flex-wrap gap-2">
          {awbCode && (
            <>
              <button
                onClick={handlePrintLabel}
                disabled={busy}
                className="inline-flex items-center gap-1.5 bg-brand-ink hover:bg-brand-ink-soft text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
              >
                {busyKind === "label" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Printer size={13} />
                )}
                Print label
              </button>
              <button
                onClick={handlePrintInvoice}
                disabled={busy}
                className="inline-flex items-center gap-1.5 bg-white border border-brand-line hover:border-brand-ink text-brand-ink text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
              >
                {busyKind === "invoice" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <FileText size={13} />
                )}
                Invoice
              </button>
              {/* Per-order manifest — generates THIS order's manifest and
                  moves it into Pickups & Manifests. Hidden once manifested. */}
              {!manifestedAt && (
                <button
                  onClick={handleManifest}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 bg-white border border-brand-line hover:border-brand-ink text-brand-ink text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {busyKind === "manifest" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <ClipboardList size={13} />
                  )}
                  {/* Delhivery manifests at booking — this only moves the row on. */}
                  {courierProvider === "delhivery" ? "Ready for pickup" : "Manifest"}
                </button>
              )}
              {/* Schedule pickup — appears after manifesting, hidden once done. */}
              {manifestedAt && !pickupScheduledAt && (
                <button
                  onClick={handleSchedulePickup}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 bg-white border border-brand-line hover:border-brand-ink text-brand-ink text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {busyKind === "pickup" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Truck size={13} />
                  )}
                  Schedule pickup
                </button>
              )}
            </>
          )}
          <button
            onClick={handleCancel}
            disabled={busy}
            title="Cancel order (test / wrong address)"
            className="inline-flex items-center gap-1.5 bg-white border border-brand-line hover:border-brand-red hover:text-brand-red text-brand-ink-soft text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            {busyKind === "cancel" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <X size={13} />
            )}
            Cancel
          </button>
          {awbCode && (
            <button
              onClick={handleMarkDispatched}
              disabled={busy}
              className="inline-flex items-center gap-1.5 bg-success hover:bg-success/90 text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 transition-colors ml-auto"
            >
              {busyKind === "dispatch" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Check size={13} />
              )}
              Mark dispatched
            </button>
          )}
        </div>
      )}

      {/* AWB pending — auto-assign normally lands in ~30 sec. The Generate
          AWB button is the manual backup for when the auto-job stalled. */}
      {!awbCode && status !== "SHIPPED" && showActions && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-brand-ink-soft inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            Auto-assigning AWB… ~30 sec.
          </span>
          <button
            onClick={handleGenerateAwb}
            disabled={busy}
            title="Manually generate the AWB if it didn't auto-assign"
            className="inline-flex items-center gap-1.5 bg-brand-ink hover:bg-brand-ink-soft text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50 transition-colors ml-auto"
          >
            {busyKind === "awb" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Truck size={13} />
            )}
            Generate AWB
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-brand-red font-medium">
          <AlertCircle size={12} />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One line-item row inside an order card. Bigger 56x56 thumbnail than the
 * old 36x36 so the packer can identify the SKU/colour at a glance from
 * across the table.
 *
 * Uses a plain <img> instead of next/image: the items snapshot's image
 * field is sometimes null (older orders) or a path that the Next image
 * optimizer chokes on; the optimizer failure was the bug Syed saw. The
 * onError fallback swaps in a Package icon so a broken-image glyph never
 * appears in the packing list.
 */
function PackOrderItem({
  item,
}: {
  item: { name: string; qty: number; image?: string | null };
}) {
  const [failed, setFailed] = useState(false);
  const showImg = !!item.image && !failed;
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-14 h-14 rounded-md bg-brand-cream overflow-hidden shrink-0 flex items-center justify-center">
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image ?? ""}
            alt={item.name}
            className="w-full h-full object-contain p-1"
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <Package size={22} className="text-brand-ink-soft" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-tight">{item.name}</div>
        <div className="text-[11px] text-brand-ink-soft font-mono uppercase tracking-widest mt-0.5">
          Qty {item.qty}
        </div>
      </div>
    </div>
  );
}

/**
 * Status badge using Shiprocket's vocabulary so the operator reads the same
 * stage names in /pack and the Shiprocket dashboard. PACKED splits on AWB:
 * with an AWB it's "Ready to Ship", without it's still "New".
 */
function StatusBadge({ status, hasAwb }: { status: string; hasAwb: boolean }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PAID: { bg: "bg-blue-100", fg: "text-blue-800", label: "New" },
    PACKED: hasAwb
      ? { bg: "bg-violet-100", fg: "text-violet-800", label: "Ready to Ship" }
      : { bg: "bg-blue-100", fg: "text-blue-800", label: "New" },
    SHIPPED: { bg: "bg-amber-100", fg: "text-amber-800", label: "In Transit" },
    DELIVERED: { bg: "bg-success/15", fg: "text-success", label: "Delivered" },
    RETURNED: { bg: "bg-red-100", fg: "text-red-700", label: "RTO" },
    CANCELLED: { bg: "bg-brand-line/40", fg: "text-brand-ink-soft", label: "Cancelled" },
    REFUNDED: { bg: "bg-brand-line/40", fg: "text-brand-ink-soft", label: "Refunded" },
  };
  const s = map[status] ?? {
    bg: "bg-brand-line/40",
    fg: "text-brand-ink-soft",
    label: status,
  };
  return (
    <span
      className={`text-[10px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${s.bg} ${s.fg}`}
    >
      {s.label}
    </span>
  );
}

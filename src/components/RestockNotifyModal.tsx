"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Bell, CheckCircle2, Mail, MessageCircle, X, ArrowRight } from "lucide-react";
import type { Sku } from "@/lib/products";
import { formatINR } from "@/lib/utils";
import { trackFunnel } from "@/lib/funnel-client";

export interface RestockNotifyProps {
  sku: Sku;
  variantSlug?: string | null;
  variantName?: string | null;
  alternatives?: Sku[];
  inline?: boolean;
  onClose?: () => void;
}

export function RestockNotifyForm({
  sku,
  variantSlug,
  variantName,
  alternatives = [],
  inline = false,
  onClose,
}: RestockNotifyProps) {
  const [channel, setChannel] = useState<"email" | "whatsapp">("whatsapp");
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ deduplicated?: boolean } | null>(null);

  const colorObj = sku.colors?.find((c) => c.slug === variantSlug);
  const variantLabel = variantName ?? (colorObj ? colorObj.name : null);

  // Reset form when variant changes
  useEffect(() => {
    setDone(null);
    setError(null);
  }, [sku.id, variantSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!consent) {
      setError("Please tick the box to consent to a one-time restock alert.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/restock/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skuId: sku.id,
          variantSlug: variantSlug ?? "",
          channel,
          contact: contact.trim(),
          consent,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        deduplicated?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not save alert. Please check your details.");
        return;
      }
      setDone({ deduplicated: data.deduplicated });
      trackFunnel("restock_request", {
        skuId: sku.id,
        variantSlug: variantSlug ?? "",
        channel,
      });
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={
        inline
          ? "rounded-2xl border border-brand-line bg-white p-4 sm:p-5 space-y-3.5"
          : "space-y-4"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-red">
            <Bell size={13} aria-hidden />
            Back-in-stock alert
          </div>
          <h3 className="text-base font-bold text-brand-ink mt-0.5">
            Get notified when {sku.name}
            {variantLabel ? ` (${variantLabel})` : ""} returns
          </h3>
          <p className="text-xs text-brand-ink-soft mt-0.5">
            One-time alert only when verified warehouse stock arrives. No spam.
          </p>
        </div>
        {!inline && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notification modal"
            className="h-9 w-9 rounded-full flex items-center justify-center text-brand-ink-soft hover:text-brand-ink hover:bg-brand-cream"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {done ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl bg-success/10 border border-success/30 px-4 py-3 text-sm text-success flex items-start gap-2.5"
        >
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">
              {done.deduplicated
                ? "You're already on the restock list!"
                : "Restock alert confirmed!"}
            </div>
            <p className="text-xs text-brand-ink-soft mt-0.5">
              We&apos;ll message you on {channel === "whatsapp" ? "WhatsApp" : "email"}{" "}
              as soon as {sku.name}
              {variantLabel ? ` (${variantLabel})` : ""} is back in stock.
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setChannel("whatsapp");
                setError(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                channel === "whatsapp"
                  ? "border-brand-ink bg-brand-ink text-white"
                  : "border-brand-line bg-brand-cream/60 text-brand-ink hover:bg-brand-cream"
              }`}
            >
              <MessageCircle size={14} aria-hidden />
              WhatsApp
            </button>
            <button
              type="button"
              onClick={() => {
                setChannel("email");
                setError(null);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                channel === "email"
                  ? "border-brand-ink bg-brand-ink text-white"
                  : "border-brand-line bg-brand-cream/60 text-brand-ink hover:bg-brand-cream"
              }`}
            >
              <Mail size={14} aria-hidden />
              Email
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type={channel === "email" ? "email" : "tel"}
              inputMode={channel === "email" ? "email" : "numeric"}
              required
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={
                channel === "email"
                  ? "you@example.com"
                  : "10-digit WhatsApp number"
              }
              aria-label={
                channel === "email" ? "Email address" : "WhatsApp phone number"
              }
              className="flex-1 px-3.5 py-2.5 rounded-lg border border-brand-line text-sm text-brand-ink focus:outline-none focus:border-brand-red bg-white"
            />
            <button
              type="submit"
              disabled={busy || !contact.trim()}
              className="px-4 py-2.5 rounded-lg bg-brand-red hover:bg-brand-red-hover text-white text-sm font-semibold disabled:opacity-50 shrink-0 transition-colors cursor-pointer"
            >
              {busy ? "Saving…" : "Notify Me"}
            </button>
          </div>

          <label className="flex items-start gap-2 text-[11px] text-brand-ink-soft cursor-pointer select-none">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 accent-brand-red"
            />
            <span>
              I agree to receive a one-time {channel === "whatsapp" ? "WhatsApp" : "email"}{" "}
              notification when this product is restocked. You can unsubscribe anytime.
            </span>
          </label>

          {error && (
            <p role="alert" className="text-xs text-brand-red font-medium">
              {error}
            </p>
          )}
        </form>
      )}

      {alternatives.length > 0 && (
        <div className="pt-3 border-t border-brand-line">
          <div className="text-[11px] font-mono uppercase tracking-wider text-brand-ink-soft mb-2">
            In-stock alternatives ready to ship today
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {alternatives.slice(0, 2).map((alt) => (
              <Link
                key={alt.id}
                href={`/product/${alt.slug}`}
                onClick={() => {
                  trackFunnel("alternative_click", {
                    skuId: sku.id,
                    targetSkuId: alt.id,
                    placement: inline ? "pdp_restock" : "card_restock_modal",
                  });
                  onClose?.();
                }}
                className="flex items-center gap-2.5 p-2 rounded-xl border border-brand-line hover:border-brand-ink/40 bg-brand-cream/40 transition-colors group"
              >
                <div className="relative w-11 h-11 rounded-lg bg-white border border-brand-line overflow-hidden shrink-0">
                  <Image
                    src={alt.heroImage}
                    alt={alt.name}
                    fill
                    sizes="44px"
                    className="object-contain p-1"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-brand-ink truncate group-hover:text-brand-red transition-colors">
                    {alt.name}
                  </div>
                  <div className="text-[11px] text-brand-ink-soft font-medium">
                    {formatINR(alt.retailINR - 100)} online · {alt.scale}
                  </div>
                </div>
                <ArrowRight
                  size={14}
                  className="text-brand-ink-soft group-hover:text-brand-red shrink-0"
                  aria-hidden
                />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RestockNotifyModal({
  open,
  sku,
  variantSlug,
  alternatives = [],
  onClose,
}: RestockNotifyProps & { open: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Restock alert for ${sku.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white border border-brand-line shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <RestockNotifyForm
          sku={sku}
          variantSlug={variantSlug}
          alternatives={alternatives}
          inline={false}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

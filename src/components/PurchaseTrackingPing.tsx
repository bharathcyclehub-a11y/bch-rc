"use client";

/**
 * Fires the GA4 + Meta Pixel + CAPI `Purchase` event exactly once per order
 * when the order success page mounts.
 *
 * Idempotency: persists an order flag across visits. Reopening an old order
 * is another page view, never another purchase. Meta also receives a stable
 * order-based event ID; GA receives the order as its transaction ID.
 *
 * Lives in its own component so the order success page can stay a server
 * component (and read DB straight). This tiny client island is the only
 * piece that needs to run in the browser.
 */

import { useEffect } from "react";
import { consentGranted, trackPurchase } from "@/lib/analytics-client";
import { trackFunnel } from "@/lib/funnel-client";

const firedInMemory = new Set<string>();

type Props = {
  orderId: string;
  totalInr: number;
  itemCount: number;
  paymentMethod: "UPI" | "CARD" | "NETBANKING" | "WALLET" | "COD";
  /** Customer email + phone if available — hashed server-side before going
   *  to Meta. Used as advanced-matching identifiers so CAPI links to the
   *  buyer profile even when the Pixel cookie wasn't there. */
  email?: string | null;
  phone?: string | null;
  contents?: Array<{
    sku: string;
    quantity: number;
    item_price: number;
    name?: string;
  }>;
};

export default function PurchaseTrackingPing(props: Props) {
  useEffect(() => {
    const once = (channel: string, send: () => void) => {
      const key = `prc:fired:purchase:${props.orderId}:${channel}`;
      if (firedInMemory.has(key)) return;
      try {
        if (window.localStorage.getItem(key)) return;
      } catch { /* Storage may be unavailable; retain in-memory deduplication. */ }
      send();
      firedInMemory.add(key);
      try { window.localStorage.setItem(key, "1"); } catch { /* Best effort. */ }
    };
    const input = {
      orderId: props.orderId, totalInr: props.totalInr, itemCount: props.itemCount,
      paymentMethod: props.paymentMethod, email: props.email ?? null,
      phone: props.phone ?? null, contents: props.contents,
    };
    once("funnel", () => trackFunnel(
      "purchase",
      { totalInr: props.totalInr, itemCount: props.itemCount, paymentMethod: props.paymentMethod },
      { orderId: props.orderId, immediate: true },
    ));
    const sendReady = () => {
      if (window.gtag) once("ga", () => trackPurchase(input, { ga: true, meta: false }));
      if (window.fbq && consentGranted()) once("meta", () => trackPurchase(input, { ga: false, meta: true }));
    };
    sendReady();
    window.addEventListener("prc:analytics-ready", sendReady);
    window.addEventListener("prc:consent", sendReady);
    return () => {
      window.removeEventListener("prc:analytics-ready", sendReady);
      window.removeEventListener("prc:consent", sendReady);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.orderId]);

  return null;
}

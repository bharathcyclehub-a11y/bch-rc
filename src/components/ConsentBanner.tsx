"use client";

/**
 * DPDP-compliant consent banner.
 *
 * Shows on first visit. Stores the decision in localStorage under prc_consent
 * = "accepted" | "declined". The <Analytics /> sibling component reads the
 * same key and only loads GA4 / Meta Pixel when it's "accepted".
 *
 * Notes on why this is here:
 *  - India's DPDP Act (2023) requires explicit, informed consent for
 *    behavioural tracking. Our server-side first-party analytics
 *    (analytics_sessions) is fine without consent — it's business-essential,
 *    no PII, no third party sees it. But GA4 + Meta Pixel + CAPI all share
 *    data with foreign processors, so they need opt-in.
 *  - The banner is intentionally a single positive action ("Allow") with a
 *    less-prominent "Decline" so we don't tank consent rates with a wall of
 *    text. Compliant; not coercive.
 *  - We DON'T render the banner if consent already exists (either direction).
 *    A returning user shouldn't see it.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

const CONSENT_KEY = "prc_consent";

export default function ConsentBanner() {
  const [show, setShow] = useState(false);
  // Shopper-facing only: the admin is an internal tool, and on phones the
  // banner covered admin lists and save bars.
  const internal = usePathname()?.startsWith("/admin") ?? false;

  useEffect(() => {
    // Defer the decision-read so SSR + first client render match (banner
    // always renders as hidden on the server). Avoids a hydration flash.
    const stored = window.localStorage?.getItem(CONSENT_KEY);
    if (!stored) setShow(true);
  }, []);

  function decide(value: "accepted" | "declined") {
    try {
      window.localStorage?.setItem(CONSENT_KEY, value);
      // Tell the rest of the app (Analytics, anything else listening) so it
      // can mount scripts immediately instead of waiting for a navigation.
      window.dispatchEvent(new CustomEvent("prc:consent", { detail: value }));
    } catch {
      // localStorage can throw in private-mode Safari etc. Fail silently;
      // the banner just won't remember the decision next visit.
    }
    setShow(false);
  }

  if (!show || internal) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md bg-brand-ink text-white rounded-xl shadow-2xl border border-white/10 p-4"
    >
      <button
        type="button"
        onClick={() => decide("declined")}
        aria-label="Decline and close"
        className="absolute top-2 right-2 text-white/60 hover:text-white p-1 rounded-full"
      >
        <X size={16} />
      </button>
      <p className="text-sm leading-snug pr-6">
        We use cookies to measure which ads send buyers and to improve the
        site. No spam, ever. See{" "}
        <a
          href="/policies/privacy"
          className="underline hover:text-brand-red"
        >
          Privacy
        </a>
        .
      </p>
      <div className="mt-3 flex gap-2 items-center">
        <button
          type="button"
          onClick={() => decide("accepted")}
          className="bg-brand-red hover:bg-brand-red-hover text-white px-4 py-2 rounded-full text-sm font-semibold"
        >
          Allow analytics
        </button>
        <button
          type="button"
          onClick={() => decide("declined")}
          className="text-white/70 hover:text-white px-3 py-2 text-xs"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

"use client";

/**
 * Analytics script loader — GA4 (gtag.js) + Meta Pixel (fbq), with Google
 * Consent Mode v2.
 *
 * Two different privacy postures, on purpose:
 *
 *  - GA4 loads on EVERY page for EVERY visitor. Before it can write cookies
 *    it is put into Consent Mode "denied" by default, which makes gtag send
 *    cookieless, aggregated pings instead of identifying hits. Google uses
 *    those to model traffic + conversions, so GA fills with data immediately
 *    (the dashboard stops saying "No data received") without dropping a
 *    tracking cookie on a non-consenting user. When the visitor taps "Allow
 *    analytics" we upgrade consent to "granted" and the same session becomes
 *    fully measured. This is an advanced Consent Mode configuration; it is not proof of compliance.
 *
 *  - Meta Pixel (fbq) still loads ONLY after explicit consent, because Meta
 *    has no equivalent cookieless mode and the Pixel + our CAPI relay share
 *    identifying data with a foreign processor. That stays strictly opt-in.
 *
 * The default consent state is read from localStorage inside the inline init
 * script itself (not via React state) so it is correct on the very first
 * hit for returning consenters AND ordered before gtag('config') in the
 * dataLayer — order matters for Consent Mode.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import { consentGranted, trackPageView } from "@/lib/analytics-client";
import { shouldTrackPath } from "@/lib/analytics";
import { trackFunnel } from "@/lib/funnel-client";

const CONSENT_KEY = "prc_consent";

export default function Analytics() {
  // Sanitize analytics IDs from env. A stray newline/space in an env value
  // (common when it's piped in from a shell) corrupts the gtag script URL, and
  // next/script then builds an invalid `querySelector` from it and throws —
  // which is the "not a valid selector" crash. Strip all whitespace, and for GA
  // require a clean measurement-ID shape; anything unexpected is treated as
  // unset so a bad value can never take down the page.
  const strip = (v: string | undefined) => v?.replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g, "") || undefined;
  const rawGa = strip(process.env.NEXT_PUBLIC_GA_ID);
  const gaId = rawGa && /^G-[A-Z0-9]+$/.test(rawGa) ? rawGa : undefined;
  const rawPixel = strip(process.env.NEXT_PUBLIC_META_PIXEL_ID);
  const pixelId = rawPixel && /^\d+$/.test(rawPixel) ? rawPixel : undefined;
  const rawClarity = strip(process.env.NEXT_PUBLIC_CLARITY_ID);
  const clarityId = rawClarity && /^[a-z0-9]+$/i.test(rawClarity) ? rawClarity : undefined;
  const pathname = usePathname();
  const sp = useSearchParams();

  const trackable = shouldTrackPath(pathname ?? "");
  const routeKey = `${pathname ?? "/"}?${sp?.toString() ?? ""}`;
  const [granted, setGranted] = useState(false);
  const [gaReady, setGaReady] = useState(false);
  const [pixelReady, setPixelReady] = useState(false);
  const gaPage = useRef<string | null>(null);
  const metaPage = useRef<string | null>(null);
  const funnelPage = useRef<string | null>(null);

  useEffect(() => {
    const apply = (accepted: boolean) => {
      setGranted(accepted);
      const state = accepted ? "granted" : "denied";
      window.gtag?.("consent", "update", {
        ad_storage: state, analytics_storage: state,
        ad_user_data: state, ad_personalization: state,
      });
      (window.fbq as ((...args: unknown[]) => void) | undefined)?.("consent", accepted ? "grant" : "revoke");
      window.clarity?.("consentv2", { ad_Storage: state, analytics_Storage: state });
    };
    apply(consentGranted());
    const onConsent = (e: Event) => apply((e as CustomEvent<string>).detail === "accepted");
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY) apply(e.newValue === "accepted");
    };
    window.addEventListener("prc:consent", onConsent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("prc:consent", onConsent);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Each integration has one page-view owner. Readiness callbacks cover slow
  // script loads without racing a fixed timer or firing another initial hit.
  useEffect(() => {
    if (!trackable) {
      gaPage.current = metaPage.current = funnelPage.current = null;
      return;
    }
    const ga = gaReady && gaPage.current !== routeKey;
    const meta = granted && pixelReady && metaPage.current !== routeKey;
    if (ga || meta) trackPageView(pathname ?? "/", { ga, meta });
    if (ga) gaPage.current = routeKey;
    if (meta) metaPage.current = routeKey;
    if (funnelPage.current !== routeKey) {
      trackFunnel("page_view", {}, { path: pathname ?? "/" });
      funnelPage.current = routeKey;
    }
  }, [trackable, routeKey, pathname, gaReady, pixelReady, granted]);

  if (!trackable) return null;

  return (
    <>
      {/* Google Analytics 4 (gtag.js) + Consent Mode v2 — loads for everyone
          when NEXT_PUBLIC_GA_ID is set. The consent default is read from
          localStorage so returning consenters start "granted"; everyone else
          starts "denied" (cookieless modeled data). */}
      {gaId && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            strategy="afterInteractive"
          />
          <Script id="gtag-init" strategy="afterInteractive" onReady={() => { setGaReady(true); window.dispatchEvent(new Event("prc:analytics-ready")); }}>
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              var __g = 'denied';
              try { if (localStorage.getItem('${CONSENT_KEY}') === 'accepted') __g = 'granted'; } catch(e) {}
              gtag('consent', 'default', {
                ad_storage: __g,
                analytics_storage: __g,
                ad_user_data: __g,
                ad_personalization: __g,
                functionality_storage: 'granted',
                security_storage: 'granted',
                wait_for_update: 500
              });
              gtag('js', new Date());
              gtag('config', '${gaId}', {
                send_page_view: false,
                anonymize_ip: true,
                cookie_flags: 'SameSite=Lax;Secure'
              });
            `}
          </Script>
        </>
      )}

      {/* Meta Pixel — opt-in only (loads after consent). PageView is emitted after readiness; subsequent events come from analytics-client (Pixel+CAPI,
          both consent-gated). */}
      {granted && pixelId && (
        <Script id="fbq-init" strategy="afterInteractive" onReady={() => { setPixelReady(true); window.dispatchEvent(new Event("prc:analytics-ready")); }}>
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${pixelId}');

          `}
        </Script>
      )}

      {/* Microsoft Clarity — heatmaps + session recordings + scroll/bounce.
          Records the session, so it's opt-in only (loads after consent), same
          posture as the Meta Pixel. Activates automatically once
          NEXT_PUBLIC_CLARITY_ID is set in the env — no code change needed. */}
      {granted && clarityId && (
        <Script id="clarity-init" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;
              t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${clarityId}");
            window.clarity("consentv2", { ad_Storage: "granted", analytics_Storage: "granted" });
          `}
        </Script>
      )}
    </>
  );
}

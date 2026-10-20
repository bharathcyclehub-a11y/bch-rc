import type { Metadata } from "next";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import Header from "@/components/Header";
import HubHero from "@/components/hub/HubHero";
import HubTrustBar from "@/components/hub/HubTrustBar";
import HubShop from "@/components/hub/HubShop";
import BundlePicker from "@/components/BundlePicker";
import HubClientUi from "@/components/hub/HubClientUi";
import HubPerfBanner from "@/components/hub/HubPerfBanner";
import HubBestSellers from "@/components/hub/HubBestSellers";
import HubDriftVideo from "@/components/hub/HubDriftVideo";
import HubWhyPrc from "@/components/hub/HubWhyPrc";
import HubBuildYourOwn from "@/components/hub/HubBuildYourOwn";
import InstaCommunity16 from "@/components/store16/InstaCommunity16";
import CustomerReviewsSlider from "@/components/CustomerReviewsSlider";
import Footer from "@/components/Footer";
import { getOverrideMap, type ProductOverride } from "@/lib/product-overrides";
import { getStockMap } from "@/lib/inventory";
// Spin-wheel discount popup hidden on request (2026-07-08). Re-enable by
// uncommenting this import and the <HubSpinWheel /> mount below.
// import HubSpinWheel from "@/components/hub/HubSpinWheel";

// The hub IS the homepage — the single storefront across every scale/category
// (mini 1:64, big 1:16, 1:20, construction, polo). Indexable: this is the main
// store page, not the old noindex preview.
export const metadata: Metadata = {
  title: {
    absolute:
      "Pocket RC Cars India — Mini 1:64, 1:16 Drift, Construction & Hobby Grade RC Cars",
  },
  description:
    "Shop Pocket RC Cars in India from ₹999 — 1:64 & 1:43 mini RC cars, 1:16 4WD smoke drift cars, RC excavators & 4WD hobby-grade rock crawlers. 24-hr Bangalore dispatch & Pan-India COD.",
  alternates: { canonical: "https://pocketrccars.com/" },
};

export const revalidate = 60;

function withSsrTimeout<T>(promise: Promise<T>, fallback: T, ms = 2500): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const homepageJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://pocketrccars.com/#organization",
      name: "Pocket RC Cars",
      alternateName: "PRC Cars",
      url: "https://pocketrccars.com/",
      logo: "https://pocketrccars.com/logo/prc-logo.png",
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer service",
        areaServed: "IN",
        availableLanguage: ["en", "hi"],
      },
      sameAs: [
        "https://www.instagram.com/pocketrccars",
        "https://www.youtube.com/@pocketrccars",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://pocketrccars.com/#website",
      url: "https://pocketrccars.com/",
      name: "Pocket RC Cars",
      publisher: { "@id": "https://pocketrccars.com/#organization" },
    },
  ],
};

export default async function Page() {
  const [overridesMapObj, stockMap] = await Promise.all([
    withSsrTimeout<Record<string, ProductOverride>>(
      getOverrideMap().then((m) => Object.fromEntries(m.entries())),
      {},
    ),
    withSsrTimeout(getStockMap(), null),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <main className="bg-white">
        <AnnouncementBar />
        {/* Shared header — transparent over the hero on the homepage. */}
        <Header />
        {/* Pull the hero up BEHIND the transparent header. The header's height
            is h-16 sm:h-18, so the negative margin matches it. The hero itself
            is sized to (100svh − announcement bar). */}
        <div className="-mt-16 sm:-mt-[4.5rem]">
          <HubHero />
        </div>

        {/* trust bar — slim genuine-signal strip right under the hero
            (rating · orders shipped · replacement · secure COD). */}
        <HubTrustBar />

        {/* SHOP — category tabs → shoppable grid of every model, one shared
            cart (mix scales, checkout once). */}
        <HubShop initialStockMap={stockMap} initialOverrides={overridesMapObj} />

        {/* BUNDLE — "Bundle & save" cards; % ladder off the shared cart. */}
        <BundlePicker />

        {/* best-sellers — one pick per range, each CTA opens that PDP */}
        <HubBestSellers />

        {/* pocket-performance promo banner (full-bleed) */}
        <HubPerfBanner />

        {/* drift video — clip + tagline */}
        <HubDriftVideo />

        {/* reviews — real-buyer-photo slider (compact cards on mobile) */}
        <CustomerReviewsSlider compact />

        {/* CTA band — social proof → shop */}
        <section className="bg-white pb-10 pt-2 text-center sm:pb-14">
          <a
            href="#hub-shop"
            className="inline-flex items-center gap-2 rounded-full bg-brand-red px-8 py-4 text-base font-bold text-white shadow-lg animate-heartbeat sm:text-lg"
          >
            Shop all models
            <span aria-hidden>→</span>
          </a>
        </section>

        {/* why buy PRC — differentiator strip */}
        <HubWhyPrc />

        {/* #PRC on Insta — scattered autoplaying UGC reels + Find-us CTA */}
        <InstaCommunity16 />

        {/* build your own PRC — model + colour configurator teaser */}
        <HubBuildYourOwn />

        {/* Final CTA band — last conversion push before the footer */}
        <section className="bg-brand-ink px-4 py-12 text-center text-white sm:py-16">
          <h2 className="font-display text-2xl font-extrabold uppercase tracking-wide sm:text-3xl">
            Ready to <span className="text-brand-red">drift</span>?
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/70 sm:text-base">
            Pan-India COD · 7-day replacement · ships in 24 hrs from Bangalore.
          </p>
          <a
            href="#hub-shop"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand-red px-8 py-4 text-base font-bold text-white shadow-lg animate-heartbeat sm:text-lg"
          >
            Grab yours today
            <span aria-hidden>→</span>
          </a>
        </section>
      </main>
      {/* footer */}
      <Footer />
      {/* Lead-capture spin-wheel popup — hidden on request 2026-07-08. */}
      {/* <HubSpinWheel /> */}
      {/* Shared cart drawer — opened by the header bag + product "Add to cart" */}
      <HubClientUi />
    </>
  );
}

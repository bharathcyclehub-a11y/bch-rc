import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import NavigationLoader from "@/components/NavigationLoader";
import Analytics from "@/components/Analytics";
import ConsentBanner from "@/components/ConsentBanner";
import BargainLauncher from "@/components/BargainLauncher";

export const metadata: Metadata = {
  metadataBase: new URL("https://pocketrccars.com"),
  title: {
    default:
      "Pocket RC Cars India — Mini 1:64, 1:16 Drift, Construction & Hobby Grade RC Cars",
    template: "%s | Pocket RC Cars",
  },
  description:
    "Buy RC cars online in India from ₹999 — 1:64 & 1:43 mini RC cars, 1:16 4WD smoke drift cars, RC construction vehicles & 4WD hobby-grade rock crawlers. Ships in 24 hrs from Bangalore.",
  keywords: [
    "RC car India",
    "mini RC drift car",
    "RC car gift",
    "drift car remote control",
    "pocket car",
    "pocket cars",
    "pocket RC cars",
    "rccar",
    "PRC Cars",
  ],
  openGraph: {
    title: "Mini RC Cars from ₹999 | PRC Cars",
    description:
      "1:64 RC drift cars · LED · drift wheels · gift-ready box. Mini RC cars shipped pan-India, dispatched in 24 hrs from Bangalore.",
    url: "https://pocketrccars.com",
    siteName: "PRC Cars",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "PRC Cars — Drift. Race. Pocket. Mini RC drift cars from ₹999.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mini RC Cars from ₹999 | PRC Cars",
    description:
      "Mini RC cars · 1:64 RC drift cars · LED · drift wheels. From ₹999 · COD pan-India.",
    images: ["/og-image.jpg"],
  },
  icons: {
    icon: [
      { url: "/logo/prc-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/logo/prc-favicon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/logo/prc-favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/logo/prc-favicon-192.png",
    shortcut: "/logo/prc-favicon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-IN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-white text-brand-ink">
        {/* Truck loader on every navigation — wrapped in Suspense because
            NavigationLoader uses useSearchParams() under the hood. */}
        <Suspense fallback={null}>
          <NavigationLoader />
        </Suspense>
        {children}
        {/* X03 — GA4 + Meta Pixel script loader. No-op until both consent is
            granted AND the relevant NEXT_PUBLIC_ env var is set, so merging
            this before Syed provides the IDs is safe. */}
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
        <ConsentBanner />
        {/* "Name your price" exit-intent haggle. Self-suppresses unless
            NEXT_PUBLIC_BARGAIN_ENABLED is on AND the 1:64 cart has an item worth
            rescuing — so it's inert everywhere by default. usePathname needs a
            Suspense boundary during static prerender. */}
        <Suspense fallback={null}>
          <BargainLauncher />
        </Suspense>
      </body>
    </html>
  );
}

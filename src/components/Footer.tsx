import Link from "next/link";
import Image from "next/image";
import { waLink } from "@/lib/config";
import { THEME } from "@/lib/theme";

const QUICK_LINKS = [
  { label: "Shop", href: "/#sku" },
  { label: "Track order", href: "/support/track" },
  { label: "Support centre", href: "/support" },
  { label: "Privacy", href: "/policies/privacy" },
  { label: "Terms", href: "/policies/terms" },
  { label: "Shipping", href: "/policies/shipping" },
] as const;

// Google Maps embed for Yelahanka 1st Stage HQ (Bharath Cycle Hub registered
// address). Iframe was replaced with a clickable card (no Maps embed) — the
// embed pulled ~1.5–2 MB of tiles + JS sitewide. Click opens Maps in a new tab.
const MAP_LINK = "https://maps.google.com/?q=" + encodeURIComponent(
  "HIG A Sector, Yelahanka 1st Stage, Bengaluru, Karnataka 560064"
);

export default function Footer() {
  return (
    <footer className="bg-brand-ink text-white pt-6 sm:pt-12 pb-5 sm:pb-6">
      <div className="max-w-6xl mx-auto px-4">
        {/* Top grid - tighter mobile spacing. Map block hides under lg so
            the mobile footer stays compact; the same info reappears as a
            single inline link inside Contact Us. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-5 sm:gap-y-10">
          {/* 1. Logo + pitch + socials */}
          <div className="col-span-2 lg:col-span-1 flex flex-col items-center text-center lg:items-start lg:text-left">
            <Link href="/" aria-label={`${THEME.brandName} home`}>
              <Image
                src={THEME.logoMain}
                alt={THEME.brandName}
                width={826}
                height={304}
                className="h-9 sm:h-14 w-auto"
              />
            </Link>
            <p className="text-xs sm:text-sm text-neutral-400 mt-2 sm:mt-4 leading-snug sm:leading-relaxed max-w-xs">
              <span className="sm:hidden">
                Mini 1:64 RC drift cars · Sold from Bangalore
              </span>
              <span className="hidden sm:inline">
                Gift-ready mini RC drift cars — 1:64 RC drift cars.
                Pan-India COD, ships in 24 hrs from Bangalore.
              </span>
            </p>
            <div className="flex items-center gap-3 mt-3 sm:mt-5">
              <a
                href={`https://instagram.com/${THEME.instagramHandle}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="hover:scale-110 transition-transform"
              >
                <Image
                  src="/icons/instagram.png"
                  alt="Instagram"
                  width={40}
                  height={40}
                  className="w-9 h-9 sm:w-10 sm:h-10"
                />
              </a>
              <a
                href={waLink()}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
                className="hover:scale-110 transition-transform"
              >
                <Image
                  src="/icons/whatsapp.png"
                  alt="WhatsApp"
                  width={40}
                  height={40}
                  className="w-9 h-9 sm:w-10 sm:h-10"
                />
              </a>
              <a
                href="https://youtube.com/@pocketrccars"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="YouTube"
                className="hover:scale-110 transition-transform"
              >
                <Image
                  src="/icons/youtube.png"
                  alt="YouTube"
                  width={40}
                  height={40}
                  className="w-9 h-9 sm:w-10 sm:h-10"
                />
              </a>
            </div>
          </div>

          {/* 2. Contact us */}
          <div>
            <h3 className="font-display font-bold tracking-wider text-white text-[11px] sm:text-sm uppercase mb-2 sm:mb-4">
              Contact
            </h3>
            <ul className="space-y-1.5 sm:space-y-3 text-xs sm:text-sm text-neutral-300">
              <li className="flex items-start gap-2 sm:gap-2.5">
                <Image
                  src="/icons/phone.png"
                  alt=""
                  width={16}
                  height={16}
                  className="w-4 h-4 shrink-0 mt-0.5"
                />
                <span className="leading-snug">
                  <a
                    href={`tel:+${THEME.whatsappNumber}`}
                    className="hover:text-white"
                  >
                    {THEME.phoneDisplay}
                  </a>
                  <span className="text-neutral-500"> · </span>
                  <a
                    href={waLink()}
                    target="_blank"
                    rel="noopener"
                    className="text-whatsapp-green hover:text-white"
                  >
                    WhatsApp
                  </a>
                </span>
              </li>
              <li className="flex items-start gap-2 sm:gap-2.5">
                <Image
                  src="/icons/gmail.png"
                  alt=""
                  width={16}
                  height={16}
                  className="w-4 h-4 shrink-0 mt-0.5"
                />
                <a
                  href={`mailto:${THEME.email}`}
                  className="hover:text-white break-all"
                >
                  {THEME.email}
                </a>
              </li>
              {/* Compact ships-from row - replaces the dedicated map block
                  on mobile so we save ~200 px of footer height. */}
              <li className="flex items-start gap-2 sm:gap-2.5 lg:hidden">
                <Image
                  src="/icons/location.png"
                  alt=""
                  width={16}
                  height={16}
                  className="w-4 h-4 shrink-0 mt-0.5"
                />
                <a
                  href={MAP_LINK}
                  target="_blank"
                  rel="noopener"
                  className="leading-snug hover:text-white"
                >
                  Yelahanka 1st Stage, Bengaluru
                </a>
              </li>
            </ul>
          </div>

          {/* 3. Quick links - 2-col grid on mobile to halve the height */}
          <div>
            <h3 className="font-display font-bold tracking-wider text-white text-[11px] sm:text-sm uppercase mb-2 sm:mb-4">
              Links
            </h3>
            <ul className="grid grid-cols-2 gap-y-1.5 gap-x-3 sm:grid-cols-1 sm:gap-y-2.5">
              {QUICK_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-xs sm:text-sm text-brand-red hover:text-white transition-colors"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 4. Ships from (Map) - DESKTOP ONLY. Mobile uses the compact
              MapPin link inside Contact Us above. */}
          <div className="hidden lg:block">
            <h3 className="font-display font-bold tracking-wider text-white text-sm uppercase mb-4">
              Ships From
            </h3>
            <a
              href={MAP_LINK}
              target="_blank"
              rel="noopener"
              className="relative block rounded-xl overflow-hidden border border-white/10 hover:border-brand-red transition-colors bg-gradient-to-br from-neutral-900 to-neutral-800 h-36"
              aria-label="Open warehouse address in Google Maps"
            >
              <span className="absolute top-2 left-2 bg-brand-red text-white text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full">
                Warehouse
              </span>
              <span className="absolute inset-0 flex items-center justify-center text-white text-sm font-semibold">
                <span className="inline-flex items-center gap-1.5 bg-black/40 backdrop-blur px-3 py-1.5 rounded-full">
                  <Image
                    src="/icons/location.png"
                    alt=""
                    width={14}
                    height={14}
                    className="w-3.5 h-3.5"
                  />
                  Open in Google Maps
                </span>
              </span>
            </a>
            <p className="text-xs text-neutral-400 mt-2 leading-snug">
              Yelahanka 1st Stage, Bengaluru
              <br />
              <span className="text-brand-red font-semibold">
                Flagship store · Coming soon
              </span>
            </p>
          </div>
        </div>

        {/* Bottom strip - condensed to 2 lines on mobile. */}
        <div className="mt-5 pt-4 sm:mt-10 sm:pt-6 border-t border-white/10 text-center">
          <p className="text-[11px] sm:text-sm text-neutral-300">
            © 2026 {THEME.brandName}
            <span className="text-neutral-600"> · </span>
            <span className="font-mono">GSTIN {THEME.legal.gstin}</span>
          </p>
          <p className="text-[10px] sm:text-[11px] text-neutral-500 mt-1 sm:mt-2">
            Yelahanka, Bengaluru
            <span className="text-neutral-700"> · </span>
            Open Mon–Sun 10AM – 8:30PM
          </p>
        </div>
      </div>
    </footer>
  );
}

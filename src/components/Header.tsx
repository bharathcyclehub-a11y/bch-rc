"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShoppingBag, Menu, X, ChevronLeft } from "lucide-react";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { THEME, waLink } from "@/lib/theme";
import { useCart, getCartCount } from "@/lib/cart-store";
import { trackFunnel } from "@/lib/funnel-client";
import { cn } from "@/lib/utils";

// Top nav. The hub is the SINGLE storefront now, so Shop/Bundles anchor into
// the homepage's own sections. The old "Shop by size" menu — which pointed at
// the retired 1:64 / 1:16 split stores — has been removed.
const NAV_BEFORE = [
  { label: "Shop", href: "/#hub-shop" },
  { label: "Bundles", href: "/#bundles" },
];
const NAV_AFTER = [{ label: "Track Order", href: "/track" }];

export default function Header() {
  const items = useCart((s) => s.items);
  const openCart = useCart((s) => s.open);
  const hasHydrated = useCart((s) => s.hasHydrated);
  // Only trust the count once the persisted cart has rehydrated — keeps the
  // server-rendered markup (no badge) identical to the first client render.
  const cartCount = hasHydrated ? getCartCount(items) : 0;
  const pathname = usePathname();
  const router = useRouter();
  // The homepage ("/") is the hub — a dark full-bleed hero sits behind the
  // header, so it's transparent at the top (and hides the back button).
  // Everywhere else (PDP, checkout, policy pages) keeps the solid-bg style so
  // the white logo + nav stay visible.
  const isHomePage = pathname === "/";

  // Back button — shown on every non-home page so the buyer always has a
  // visible escape hatch alongside the browser back gesture. Tries
  // router.back() first (preserves Next.js state/scroll); falls back to
  // pushing "/" (the hub) when there's no in-app history (e.g. deep-link
  // landings, Razorpay return URLs that opened a fresh tab).
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Treat any non-home route as "scrolled" so the dark logo + dark nav
  // always render against the solid white header bg.
  // Also force solid style when the mobile menu is open — otherwise the
  // white logo / hamburger / cart icon are invisible against the open
  // white drawer, and the user has no way to close the menu.
  const useSolidStyle = !isHomePage || scrolled || mobileOpen;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-all duration-300",
        useSolidStyle
          ? "bg-white/95 backdrop-blur-md border-b border-brand-line shadow-sm text-brand-ink"
          : "bg-transparent text-white"
      )}
    >
      <div className="w-full px-3 sm:px-5 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-18">
          {/* Back button — non-home pages only */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {!isHomePage && (
              <button
                type="button"
                onClick={handleBack}
                aria-label="Go back"
                className={cn(
                  "inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-full transition-colors",
                  useSolidStyle
                    ? "hover:bg-brand-cream text-brand-ink"
                    : "hover:bg-white/10 text-white"
                )}
              >
                <ChevronLeft size={20} strokeWidth={2.5} />
              </button>
            )}
            {/* Logo */}
            <Link
              href="/"
              className="flex items-center gap-2 shrink-0"
              aria-label={`${THEME.brandName} home`}
            >
              <Image
                src={useSolidStyle ? THEME.logoDark : THEME.logoMain}
                alt={THEME.brandName}
                width={826}
                height={304}
                sizes="(min-width: 1024px) 153px, (min-width: 640px) 131px, 109px"
                className="h-10 sm:h-12 lg:h-14 w-auto"
                priority
              />
            </Link>
          </div>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-8">
            {[...NAV_BEFORE, ...NAV_AFTER].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-sm font-medium transition-colors",
                  useSolidStyle
                    ? "text-brand-ink-soft hover:text-brand-red"
                    : "text-white/80 hover:text-white"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right cluster: WhatsApp + cart + mobile menu */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* WhatsApp pill - mobile shows icon-only to save thumb-zone real
                estate, sm+ adds the "Chat" label. Was previously hidden below
                sm, leaving ~80% of (mobile) traffic without a header CTA to
                contact us. The persistent FAB stays - this pill is the
                always-visible-at-top backup. Prefill is Hinglish so a DM
                lands qualified instead of generic. */}
            <a
              href={waLink("Hi! Mujhe ye Pocket RC drift car chahiye — price aur COD details bhej do?")}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackFunnel("whatsapp_click", { placement: "header" })}
              className="inline-flex items-center gap-1.5 sm:gap-2 bg-whatsapp-green hover:bg-whatsapp-green-hover text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-sm font-semibold transition-colors"
              aria-label="Chat on WhatsApp"
            >
              <WhatsAppIcon size={16} />
              <span className="hidden sm:inline">Chat</span>
            </a>

            <button
              type="button"
              onClick={openCart}
              aria-label={`Cart (${cartCount} items)`}
              className={cn(
                "relative p-2.5 rounded-full transition-colors",
                useSolidStyle
                  ? "hover:bg-brand-cream text-brand-ink"
                  : "hover:bg-white/10 text-white"
              )}
            >
              <ShoppingBag size={20} />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-brand-red text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className={cn(
                "lg:hidden p-2.5 rounded-full transition-colors",
                useSolidStyle
                  ? "hover:bg-brand-cream text-brand-ink"
                  : "hover:bg-white/10 text-white"
              )}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu drawer */}
      {mobileOpen && (
        <div className="lg:hidden bg-white border-t border-brand-line shadow-lg">
          <nav className="px-4 py-3 flex flex-col">
            {[...NAV_BEFORE, ...NAV_AFTER].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="py-3 text-base font-medium text-brand-ink hover:text-brand-red border-b border-brand-line last:border-b-0"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

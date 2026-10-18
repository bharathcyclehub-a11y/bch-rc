"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShoppingBag, Menu, X, ChevronLeft, ChevronDown } from "lucide-react";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { THEME, waLink } from "@/lib/theme";
import { useCart, getCartCount } from "@/lib/cart-store";
import { trackFunnel } from "@/lib/funnel-client";
import { cn } from "@/lib/utils";

// Four approved categories inside the Shop dropdown
const SHOP_CATEGORIES = [
  {
    label: "Mini RC Cars",
    sub: "1:64 & 1:43 Scale",
    badge: "1:64",
    href: "/collections/mini-rc-cars",
  },
  {
    label: "Drift & Racing RC",
    sub: "1:16 & 1:20 Drift & Track",
    badge: "1:16",
    href: "/collections/drift-racing",
  },
  {
    label: "Construction RC",
    sub: "Excavators & Trucks",
    badge: "RC",
    href: "/collections/construction-rc",
  },
  {
    label: "Hobby Grade RC",
    sub: "4WD Rock Crawlers & Off-Road",
    badge: "4WD",
    href: "/collections/hobby-grade",
  },
];

// Top nav links: exactly Shop | Bundles | Track Order | Support
const NAV_LINKS = [
  { label: "Bundles", href: "/#bundles" },
  { label: "Track Order", href: "/track" },
  { label: "Support", href: "/support" },
];

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
  // pushing "/" (the hub) when there's no in-app history.
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileShopOpen, setMobileShopOpen] = useState(false);

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
  // white drawer.
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
                  "inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded-full transition-colors",
                  useSolidStyle
                    ? "hover:bg-brand-cream text-brand-ink"
                    : "hover:bg-white/10 text-white"
                )}
              >
                <ChevronLeft size={19} strokeWidth={2.5} />
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

          {/* Desktop nav: Shop | Bundles | Track Order | Support */}
          <nav className="hidden lg:flex items-center gap-8">
            {/* Shop dropdown */}
            <div className="relative group">
              <Link
                href="/#hub-shop"
                className={cn(
                  "inline-flex items-center gap-1 text-sm font-medium transition-colors",
                  useSolidStyle
                    ? "text-brand-ink-soft hover:text-brand-red"
                    : "text-white/80 hover:text-white"
                )}
                aria-haspopup="true"
              >
                Shop
                <ChevronDown
                  size={15}
                  className="transition-transform duration-200 group-hover:rotate-180"
                />
              </Link>

              {/* Dropdown panel */}
              <div className="invisible absolute left-0 top-full z-50 w-72 pt-3 opacity-0 transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <div className="overflow-hidden rounded-2xl border border-brand-line bg-white text-brand-ink shadow-xl">
                  <div className="p-1.5 space-y-1">
                    {SHOP_CATEGORIES.map((cat) => (
                      <Link
                        key={cat.href}
                        href={cat.href}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-brand-cream group/item"
                      >
                        <span className="grid h-9 w-11 shrink-0 place-items-center rounded-lg font-mono text-xs font-bold bg-brand-red text-white group-hover/item:scale-105 transition-transform">
                          {cat.badge}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="block truncate text-sm font-semibold text-brand-ink group-hover/item:text-brand-red transition-colors">
                            {cat.label}
                          </span>
                          <span className="block truncate text-[11px] text-brand-ink-soft">
                            {cat.sub}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>

                  <Link
                    href="/collections"
                    className="flex items-center justify-between border-t border-brand-line bg-brand-cream px-4 py-2.5 text-xs font-semibold text-brand-red hover:bg-brand-cream/80 transition-colors"
                  >
                    <span>View All Categories</span>
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            </div>

            {/* Bundles | Track Order | Support */}
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "text-sm font-medium transition-colors",
                    useSolidStyle
                      ? isActive
                        ? "font-bold text-brand-red"
                        : "text-brand-ink-soft hover:text-brand-red"
                      : "text-white/80 hover:text-white"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Right cluster: WhatsApp + cart + mobile menu */}
          <div className="flex items-center gap-2 sm:gap-3">
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
            {/* Shop Accordion */}
            <div className="border-b border-brand-line">
              <button
                type="button"
                onClick={() => setMobileShopOpen((v) => !v)}
                aria-expanded={mobileShopOpen}
                className="flex w-full items-center justify-between py-3 text-base font-semibold text-brand-ink hover:text-brand-red"
              >
                <span>Shop</span>
                <ChevronDown
                  size={18}
                  className={cn(
                    "transition-transform duration-200 text-brand-ink-soft",
                    mobileShopOpen && "rotate-180"
                  )}
                />
              </button>

              {mobileShopOpen && (
                <div className="pb-3 pl-2 pr-1 space-y-1">
                  {SHOP_CATEGORIES.map((cat) => (
                    <Link
                      key={cat.href}
                      href={cat.href}
                      onClick={() => {
                        setMobileOpen(false);
                        setMobileShopOpen(false);
                      }}
                      className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-brand-cream transition-colors"
                    >
                      <span className="grid h-7 w-9 shrink-0 place-items-center rounded bg-brand-red text-white font-mono text-[10px] font-bold">
                        {cat.badge}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-brand-ink">
                          {cat.label}
                        </span>
                        <span className="block text-[11px] text-brand-ink-soft">
                          {cat.sub}
                        </span>
                      </div>
                    </Link>
                  ))}
                  <Link
                    href="/collections"
                    onClick={() => {
                      setMobileOpen(false);
                      setMobileShopOpen(false);
                    }}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-brand-red hover:bg-brand-cream transition-colors"
                  >
                    <span>View All Categories</span>
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              )}
            </div>

            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => {
                  setMobileOpen(false);
                  setMobileShopOpen(false);
                }}
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

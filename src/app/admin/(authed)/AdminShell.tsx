"use client";

/**
 * Responsive admin shell ("Pit Lane" design system — docs/admin-redesign):
 *  - ≥1280px  240px white sidebar (grouped nav, red active bar, live badges)
 *  - 768–1279 72px icon rail; the rail's toggle opens the full nav as a drawer
 *  - <768px   top bar (menu · brand · search) + bottom tabs on top-level pages;
 *             detail/editor routes hide the tabs so their sticky save bars own
 *             the bottom edge.
 * ⌘K / Ctrl K opens the command palette everywhere. The server layout stays a
 * server component (auth + counts); icons live client-side because component
 * refs can't cross the server→client boundary.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Ellipsis, House, Menu, Package, PanelLeft, Search, ShoppingBag, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/admin/Button";
import { Dialog } from "@/components/admin/Dialog";
import { ToastProvider } from "@/components/admin/Toast";
import { AdminSignOut } from "./AdminSignOut";
import { CommandPalette } from "./CommandPalette";
import { ADMIN_NAV, activeNavItem, isNavActive, type AdminCounts } from "./nav";

export type { AdminCounts } from "./nav";

type ShellProps = {
  email: string;
  role: string;
  brandName: string;
  logo: string;
  counts: AdminCounts;
  children: React.ReactNode;
};

export function AdminShell({ email, role, brandName, logo, counts, children }: ShellProps) {
  const pathname = usePathname() ?? "/admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const section = activeNavItem(pathname)?.label ?? "Admin";
  // Tabs only on top-level pages (/admin, /admin/orders …); deeper routes are
  // detail/editor pages whose sticky action bars need the bottom edge.
  const showTabs = pathname.split("/").filter(Boolean).length <= 2;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <div className="admin-shell backend-ui min-h-screen" data-tabbar={showTabs ? "true" : undefined}>
      <ToastProvider>
        <a
          href="#admin-main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg"
        >
          Skip to content
        </a>

        {/* ≥1280px — full sidebar */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-admin-line bg-white xl:flex">
          <Link href="/admin" className="flex h-14 shrink-0 items-center gap-2.5 border-b border-admin-line px-5">
            <Image src={logo} alt={brandName} width={826} height={304} className="h-6 w-auto" priority />
            <span className="rounded bg-brand-red px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-white">
              Admin
            </span>
          </Link>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <NavList pathname={pathname} counts={counts} />
          </div>
          <Profile email={email} role={role} />
        </aside>

        {/* 768–1279px — icon rail */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col items-center border-r border-admin-line bg-white md:flex xl:hidden">
          <Link href="/admin" aria-label={`${brandName} admin home`} className="mt-2.5 grid h-11 w-11 place-items-center rounded-xl">
            <span className="relative grid h-9 w-9 place-items-center rounded-lg bg-brand-ink text-[11px] font-extrabold tracking-tight text-white">
              PRC
              <span aria-hidden className="absolute inset-x-2.5 bottom-1.5 h-0.5 rounded-full bg-brand-red" />
            </span>
          </Link>
          <IconButton label="Expand navigation" onClick={() => setDrawerOpen(true)} className="mt-1">
            <PanelLeft size={18} aria-hidden />
          </IconButton>
          <RailNav pathname={pathname} counts={counts} />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Account and navigation"
            title={email}
            className="mb-3 mt-2 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-ink text-sm font-semibold uppercase text-white"
          >
            {email.charAt(0)}
          </button>
        </aside>

        {/* Phone menu + tablet "expand" */}
        <Dialog
          open={drawerOpen}
          onClose={closeDrawer}
          variant="drawer"
          title={
            <span className="flex items-center gap-2">
              <Image src={logo} alt={brandName} width={826} height={304} className="h-5 w-auto" />
              <span className="rounded bg-brand-red px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-white">
                Admin
              </span>
            </span>
          }
          bodyClassName="px-3 sm:px-3"
          footer={
            <div className="-mx-4 -mb-1 w-full sm:-mx-5">
              <Profile email={email} role={role} flush />
            </div>
          }
        >
          <NavList pathname={pathname} counts={counts} onNavigate={closeDrawer} />
        </Dialog>

        <div className="md:pl-[72px] xl:pl-60">
          <TopBar
            section={section}
            logo={logo}
            brandName={brandName}
            onMenu={() => setDrawerOpen(true)}
            onSearch={() => setPaletteOpen(true)}
          />
          <main
            id="admin-main"
            className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-4 md:px-6 md:pt-6 xl:px-8 xl:pt-7 max-md:pb-[calc(var(--admin-bottom-offset)+24px)]"
          >
            {children}
          </main>
        </div>

        {showTabs && <BottomTabs pathname={pathname} counts={counts} onMore={() => setDrawerOpen(true)} />}

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </ToastProvider>
    </div>
  );
}

function NavList({ pathname, counts, onNavigate }: { pathname: string; counts: AdminCounts; onNavigate?: () => void }) {
  return (
    <nav aria-label="Admin" className="space-y-5">
      {ADMIN_NAV.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">{group.label}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isNavActive(pathname, item.href);
              const count = item.countKey ? (counts[item.countKey] ?? 0) : 0;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors max-xl:h-11 max-xl:text-sm",
                      active
                        ? "bg-admin-subtle font-semibold text-brand-ink"
                        : "text-brand-ink-soft hover:bg-admin-subtle/70 hover:text-brand-ink",
                    )}
                  >
                    {active && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-brand-red" />}
                    <Icon
                      size={16}
                      aria-hidden
                      className={active ? "text-brand-red" : "text-admin-muted group-hover:text-brand-ink"}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {count > 0 && (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-red px-1.5 text-[11px] font-semibold tabular-nums text-white">
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function RailNav({ pathname, counts }: { pathname: string; counts: AdminCounts }) {
  return (
    <nav aria-label="Admin" className="mt-1 flex w-full flex-1 flex-col items-center overflow-y-auto no-scrollbar py-2">
      {ADMIN_NAV.map((group, gi) => (
        <div
          key={group.label}
          className={cn("flex flex-col items-center gap-1", gi > 0 && "mt-2 border-t border-admin-line pt-2")}
        >
          {group.items.map((item) => {
            const active = isNavActive(pathname, item.href);
            const count = item.countKey ? (counts[item.countKey] ?? 0) : 0;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={count > 0 ? `${item.label} (${count})` : item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative grid h-11 w-11 place-items-center rounded-xl transition-colors",
                  active ? "bg-admin-subtle text-brand-red" : "text-admin-muted hover:bg-admin-subtle/70 hover:text-brand-ink",
                )}
              >
                <Icon size={18} aria-hidden />
                {count > 0 && (
                  <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-red ring-2 ring-white" />
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Profile({ email, role, flush }: { email: string; role: string; flush?: boolean }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-3 border-t border-admin-line px-4 py-3", flush && "border-t-0 px-5")}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-ink text-sm font-semibold uppercase text-white">
        {email.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-brand-ink">{email}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted">{role}</p>
      </div>
      <AdminSignOut />
    </div>
  );
}

const subscribeNoop = () => () => {};

function TopBar({
  section,
  logo,
  brandName,
  onMenu,
  onSearch,
}: {
  section: string;
  logo: string;
  brandName: string;
  onMenu: () => void;
  onSearch: () => void;
}) {
  // Read the platform without an effect: the server snapshot renders "Ctrl K".
  const isMac = useSyncExternalStore(
    subscribeNoop,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
  return (
    <header className="sticky top-0 z-20 border-b border-admin-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-2 md:gap-4 md:px-6 xl:px-8">
        <IconButton label="Open menu" onClick={onMenu} className="md:hidden">
          <Menu size={20} aria-hidden />
        </IconButton>
        <Link href="/admin" className="flex items-center gap-2 md:hidden" aria-label={`${brandName} admin home`}>
          <Image src={logo} alt="" width={826} height={304} className="h-5 w-auto" priority />
        </Link>

        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-sm md:flex">
          <span className="whitespace-nowrap text-admin-muted">Pocket RC Hub</span>
          <span aria-hidden className="text-admin-line-strong">
            /
          </span>
          <span className="truncate font-semibold text-brand-ink">{section}</span>
        </nav>

        <button
          type="button"
          onClick={onSearch}
          className="ml-auto hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-admin-line bg-admin-subtle/60 px-3 text-left text-[13px] text-admin-muted transition-colors hover:border-admin-line-strong hover:bg-white md:flex"
        >
          <Search size={15} aria-hidden />
          <span className="flex-1 truncate">Search orders, products, customers</span>
          <kbd className="rounded border border-admin-line bg-white px-1.5 font-sans text-[11px] text-admin-muted">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
        <IconButton label="Search" onClick={onSearch} className="ml-auto md:hidden">
          <Search size={19} aria-hidden />
        </IconButton>

        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden items-center gap-1 whitespace-nowrap text-[13px] font-medium text-brand-ink-soft hover:text-brand-ink lg:inline-flex"
        >
          View store <ArrowUpRight size={14} aria-hidden />
        </a>
      </div>
    </header>
  );
}

const TABS = [
  { label: "Home", href: "/admin", icon: House },
  { label: "Orders", href: "/admin/orders", icon: Package, countKey: "orders" as const },
  { label: "Products", href: "/admin/products", icon: ShoppingBag },
  { label: "Customers", href: "/admin/customers", icon: Users },
];

function BottomTabs({ pathname, counts, onMore }: { pathname: string; counts: AdminCounts; onMore: () => void }) {
  const onTab = TABS.some((t) => isNavActive(pathname, t.href));
  const itemCls = "relative flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium";
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-admin-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {TABS.map((t) => {
          const active = isNavActive(pathname, t.href);
          const count = t.countKey ? (counts[t.countKey] ?? 0) : 0;
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(itemCls, active ? "text-brand-ink" : "text-admin-muted")}
              >
                {active && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-red" />}
                <span className="relative">
                  <Icon size={20} aria-hidden />
                  {count > 0 && (
                    <span className="absolute -right-3 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-red px-1 text-[10px] font-semibold tabular-nums text-white">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={onMore} className={cn(itemCls, onTab ? "text-admin-muted" : "text-brand-ink")}>
            {!onTab && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-brand-red" />}
            <Ellipsis size={20} aria-hidden />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

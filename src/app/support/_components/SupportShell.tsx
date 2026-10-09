import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WhatsAppFab from "@/components/WhatsAppFab";
import CartDrawer from "@/components/CartDrawer";

export type Crumb = { label: string; href?: string };

/**
 * Storefront chrome for every customer Support Centre page: announcement bar,
 * header, a breadcrumb that always leads back to /support, footer, WhatsApp
 * button and the cart drawer. No client code of its own, so it also works
 * inside loading.tsx / error.tsx.
 */
export default function SupportShell({
  crumbs = [],
  fab = true,
  children,
}: {
  /** Trail after "Support"; the last crumb is the current page. */
  crumbs?: Crumb[];
  fab?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <AnnouncementBar />
      <Header />
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="border-b border-brand-line bg-white">
          <ol className="max-w-6xl mx-auto px-4 flex items-center gap-1 text-sm min-w-0">
            <li className="shrink-0">
              <Link
                href="/support"
                className="inline-flex items-center gap-1 min-h-12 text-brand-ink-soft hover:text-brand-ink"
              >
                <ChevronLeft size={16} aria-hidden />
                Support
              </Link>
            </li>
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={`${c.label}-${i}`} className={`flex items-center gap-1 min-w-0 ${last ? "" : "shrink-0"}`}>
                  <span aria-hidden className="text-neutral-400">
                    /
                  </span>
                  {last || !c.href ? (
                    <span
                      aria-current={last ? "page" : undefined}
                      className={`truncate ${last ? "font-semibold text-brand-ink" : "text-brand-ink-soft"}`}
                    >
                      {c.label}
                    </span>
                  ) : (
                    <Link
                      href={c.href}
                      className="inline-flex items-center min-h-12 text-brand-ink-soft hover:text-brand-ink"
                    >
                      {c.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <main className="flex-1 bg-white">{children}</main>
      <Footer />
      {fab && <WhatsAppFab />}
      <CartDrawer />
    </>
  );
}

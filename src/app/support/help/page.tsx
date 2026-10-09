import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { ARTICLE_CATEGORIES, listArticles, productsForArticle } from "@/lib/support/kb";
import SupportShell from "../_components/SupportShell";
import { Eyebrow, Notice, WhatsAppButton, btnDark, btnOutline, inputClass } from "../_components/ui";
import AutoSubmitSelect from "./AutoSubmitSelect";

export const metadata: Metadata = {
  title: { absolute: "Help guides — PRC Support" },
  description: "Step-by-step help for Pocket RC Cars: charging, pairing the remote, a car that won't move, delivery and refunds.",
  alternates: { canonical: "/support/help" },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
type Cat = keyof typeof ARTICLE_CATEGORIES;

function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `/support/help?${s}` : "/support/help";
}

export default async function HelpIndexPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = first(sp.q).trim().slice(0, 80);
  const rawCat = first(sp.category);
  const category = rawCat in ARTICLE_CATEGORIES ? (rawCat as Cat) : undefined;
  const products = productsForArticle({ skuIds: [] });
  const rawProduct = first(sp.product);
  const product = products.find((p) => p.id === rawProduct);

  const rows = await listArticles({ q, category, skuId: product?.id }).catch(() => null);
  const filtered = !!(q || category || product);

  return (
    <SupportShell crumbs={[{ label: "Help guides" }]}>
      <section className="border-b border-brand-line bg-brand-cream">
        <div className="max-w-4xl mx-auto px-4 py-8 sm:py-10">
          <Eyebrow>Help guides</Eyebrow>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-brand-ink">Fix it yourself, step by step</h1>

          <form action="/support/help" method="get" role="search" className="mt-5 space-y-3">
            {category && <input type="hidden" name="category" value={category} />}
            <div className="flex gap-2">
              <label htmlFor="help-q" className="sr-only">
                Search help guides
              </label>
              <div className="relative min-w-0 flex-1">
                <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-brand-ink-soft" />
                <input
                  id="help-q"
                  name="q"
                  type="search"
                  defaultValue={q}
                  maxLength={80}
                  enterKeyHint="search"
                  placeholder="Search: charging, remote, refund…"
                  className={`${inputClass} pl-11`}
                />
              </div>
              <button type="submit" className={`${btnDark} shrink-0`}>
                Search
              </button>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label htmlFor="help-product" className="shrink-0 text-sm font-semibold text-brand-ink">
                Your car
              </label>
              <AutoSubmitSelect
                id="help-product"
                name="product"
                defaultValue={product?.id ?? ""}
                placeholder="All products"
                options={products.map((p) => ({ value: p.id, label: p.name }))}
                className="sm:max-w-sm"
              />
            </div>
          </form>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <nav aria-label="Guide categories">
          <ul className="flex flex-wrap gap-2">
            <li>
              <TabLink href={qs({ q, product: product?.id })} active={!category}>
                All
              </TabLink>
            </li>
            {(Object.keys(ARTICLE_CATEGORIES) as Cat[]).map((c) => (
              <li key={c}>
                <TabLink href={qs({ q, category: c, product: product?.id })} active={category === c}>
                  {ARTICLE_CATEGORIES[c]}
                </TabLink>
              </li>
            ))}
          </ul>
        </nav>

        {rows === null ? (
          <Notice tone="error" role="alert" title="Help guides can't be loaded right now">
            Please try again shortly, or{" "}
            <Link href="/support/chat" className="font-semibold underline">
              use the support menu
            </Link>
            .
          </Notice>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-brand-line p-5 sm:p-6">
            <h2 className="font-display text-lg font-bold text-brand-ink">
              {filtered ? "No guides match that" : "Guides are on their way"}
            </h2>
            <p className="mt-1 text-sm text-brand-ink-soft">
              {filtered ? "Try fewer or different words — or ask us directly." : "Meanwhile, ask us directly."}
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              {filtered && (
                <Link href="/support/help" className={btnOutline}>
                  Show all guides
                </Link>
              )}
              <Link href="/support/new" className={btnOutline}>
                Raise a ticket
              </Link>
              <WhatsAppButton message="Hi, I need help with my RC car." />
            </div>
          </div>
        ) : (
          <section aria-label="Guides">
            <p className="text-sm text-brand-ink-soft" aria-live="polite">
              {rows.length} guide{rows.length === 1 ? "" : "s"}
              {product ? ` for ${product.name}` : ""}
              {q ? ` matching “${q}”` : ""}
            </p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {rows.map((a) => (
                <li key={a.slug} className="min-w-0">
                  <Link
                    href={`/support/help/${a.slug}${product ? `?product=${encodeURIComponent(product.id)}` : ""}`}
                    className="flex h-full items-start gap-3 rounded-2xl border border-brand-line bg-white p-4 hover:border-brand-ink"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-mono font-bold uppercase tracking-widest text-brand-red">
                        {ARTICLE_CATEGORIES[a.category as Cat] ?? "Help"}
                      </span>
                      <span className="mt-1 block font-semibold text-brand-ink break-words">{a.title}</span>
                      {a.summary && <span className="mt-1 block text-sm text-brand-ink-soft break-words">{a.summary}</span>}
                    </span>
                    <ChevronRight size={18} aria-hidden className="mt-1 shrink-0 text-brand-ink-soft" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </SupportShell>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-12 items-center rounded-full border px-4 text-sm font-medium ${
        active ? "border-brand-ink bg-brand-ink text-white" : "border-brand-line bg-white text-brand-ink hover:border-brand-ink"
      }`}
    >
      {children}
    </Link>
  );
}

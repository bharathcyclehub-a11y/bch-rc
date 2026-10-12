import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, CirclePlay, MessageCircle } from "lucide-react";
import {
  ARTICLE_CATEGORIES,
  getArticle,
  productFacts,
  productsForArticle,
  type ArticleBody,
} from "@/lib/support/kb";
import { getPublishedArticlesBySlugs } from "@/lib/support/customer-queries";
import SupportShell from "../../_components/SupportShell";
import { Eyebrow, Notice, btnOutline, cardClass, fmtDate } from "../../_components/ui";
import AutoSubmitSelect from "../AutoSubmitSelect";
import GuidedSteps from "./GuidedSteps";

type SP = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
type Cat = keyof typeof ARTICLE_CATEGORIES;

const loadArticle = cache(async (slug: string) => (SLUG_RE.test(slug) ? getArticle(slug) : null));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = await loadArticle(slug).catch(() => null);
  if (!a) return { title: { absolute: "Help guide — PRC Support" }, robots: { index: false } };
  return {
    title: { absolute: `${a.title} — PRC Support` },
    description: a.summary || undefined,
    alternates: { canonical: `/support/help/${a.slug}` },
  };
}

function parseBody(raw: unknown): ArticleBody {
  const b = (raw ?? {}) as Partial<ArticleBody>;
  const steps = Array.isArray(b.steps)
    ? b.steps
        .filter((s) => s && typeof s.title === "string" && typeof s.text === "string")
        .map((s) => ({
          title: s.title,
          text: s.text,
          image: typeof s.image === "string" && /^(https:\/\/|\/)/.test(s.image) ? s.image : undefined,
        }))
    : [];
  return { steps, note: typeof b.note === "string" ? b.note : undefined };
}

/** Which ticket category "Still not fixed?" opens for this guide. */
function ticketCategoryFor(slug: string, category: string): string {
  if (/batter|charg/.test(slug)) return "BATTERY_CHARGING";
  if (/remote|pair/.test(slug)) return "REMOTE_CONNECTION";
  if (category === "ORDERS" || category === "POLICY") return "GENERAL";
  return "PRODUCT_NOT_WORKING";
}

const DIFFICULTY: Record<string, string> = { EASY: "Easy", MEDIUM: "Medium", ADVANCED: "Advanced" };

export default async function HelpArticlePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const article = await loadArticle(slug);
  if (!article) notFound();

  const body = parseBody(article.body);
  const products = productsForArticle(article);
  const chosen = products.find((p) => p.id === first(sp.product)) ?? (products.length === 1 ? products[0] : undefined);
  const facts = chosen ? productFacts(chosen.id) : null;
  const related = await getPublishedArticlesBySlugs(article.relatedSlugs).catch(() => []);
  const catLabel = ARTICLE_CATEGORIES[article.category as Cat] ?? "Help";
  const video = article.videoUrl && /^https:\/\//.test(article.videoUrl) ? article.videoUrl : null;

  return (
    <SupportShell crumbs={[{ label: "Help guides", href: "/support/help" }, { label: catLabel }]}>
      <article className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-6">
        <header>
          <Eyebrow>{catLabel} · Guided fix</Eyebrow>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-brand-ink text-balance break-words">
            {article.title}
          </h1>
          {article.summary && <p className="mt-3 text-base text-brand-ink-soft leading-relaxed">{article.summary}</p>}
          <p className="mt-3 flex flex-wrap gap-x-2 text-xs text-brand-ink-soft">
            <span>{DIFFICULTY[article.difficulty] ?? "Easy"}</span>
            <span aria-hidden>·</span>
            <span>
              {body.steps.length} step{body.steps.length === 1 ? "" : "s"}
            </span>
            {article.lastReviewedAt && (
              <>
                <span aria-hidden>·</span>
                <span>Reviewed {fmtDate(article.lastReviewedAt)}</span>
              </>
            )}
          </p>
        </header>

        {article.needsVerification && (
          <Notice tone="warn" role="status" title="Being reviewed">
            Some details in this guide are still being verified by our team.
          </Notice>
        )}

        {products.length > 1 && (
          <form method="get" className="flex flex-col sm:flex-row sm:items-center gap-2">
            <label htmlFor="article-product" className="shrink-0 text-sm font-semibold text-brand-ink">
              Your car
            </label>
            <AutoSubmitSelect
              id="article-product"
              name="product"
              defaultValue={chosen?.id ?? ""}
              placeholder="Choose your car to see its specs"
              options={products.map((p) => ({ value: p.id, label: p.name }))}
              className="sm:max-w-sm"
            />
            <noscript>
              <button type="submit" className={btnOutline}>
                Show
              </button>
            </noscript>
          </form>
        )}

        {facts && (
          <section aria-labelledby="facts-heading" className={`${cardClass} bg-brand-cream`}>
            <h2 id="facts-heading" className="font-display text-lg font-bold text-brand-ink">
              Product facts — {facts.name}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {facts.rows.map((r) => (
                <div key={r.label} className="min-w-0">
                  <dt className="text-brand-ink-soft">{r.label}</dt>
                  <dd className="font-semibold text-brand-ink break-words">{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-brand-ink-soft">From our product catalogue.</p>
          </section>
        )}

        {body.note && <Notice tone="info">{body.note}</Notice>}

        {body.steps.length > 0 ? (
          <GuidedSteps
            slug={article.slug}
            title={article.title}
            steps={body.steps}
            ticketCategory={ticketCategoryFor(article.slug, article.category)}
          />
        ) : (
          <p className="text-sm text-brand-ink-soft">This guide has no steps yet.</p>
        )}

        {video && (
          <a
            href={video}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btnOutline} w-full`}
          >
            <CirclePlay size={18} aria-hidden />
            Watch the video guide
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}

        {related.length > 0 && (
          <section aria-labelledby="related-heading">
            <h2 id="related-heading" className="font-display text-lg font-bold text-brand-ink">
              Related guides
            </h2>
            <ul className="mt-3 divide-y divide-brand-line rounded-2xl border border-brand-line">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/support/help/${r.slug}${chosen ? `?product=${encodeURIComponent(chosen.id)}` : ""}`}
                    className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-brand-cream"
                  >
                    <span className="min-w-0 flex-1 font-semibold text-brand-ink break-words">{r.title}</span>
                    <ChevronRight size={18} aria-hidden className="shrink-0 text-brand-ink-soft" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="flex items-center justify-center gap-2 text-center text-sm text-brand-ink-soft">
          <MessageCircle size={16} aria-hidden />
          <span>
            Prefer to ask?{" "}
            <Link href="/support/chat" className="font-semibold text-brand-ink underline underline-offset-4">
              Open the support menu
            </Link>
          </span>
        </p>
      </article>
    </SupportShell>
  );
}

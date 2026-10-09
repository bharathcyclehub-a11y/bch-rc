/**
 * Help articles (knowledge base). Product association is by code-catalogue
 * SKU id (`sku_ids`); an empty list means the article applies to every
 * product. The article page shows the chosen product's real catalogue specs
 * (src/lib/products.ts) — articles never restate product numbers.
 */

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { helpArticles, type HelpArticleRow } from "@/db/schema";
import { PRODUCTS, pdpSpecRows, type Sku } from "@/lib/products";
import { SEED_ARTICLES } from "./kb-seed";

export const ARTICLE_CATEGORIES = {
  GETTING_STARTED: "Getting started",
  TROUBLESHOOTING: "Troubleshooting",
  MAINTENANCE: "Maintenance",
  ORDERS: "Orders & delivery",
  POLICY: "Returns & refunds",
} as const;
export type ArticleCategory = keyof typeof ARTICLE_CATEGORIES;

export type ArticleBody = { steps: Array<{ title: string; text: string; image?: string }>; note?: string; sources?: string[] };

export async function listArticles(opts: { q?: string; category?: string; skuId?: string; includeDrafts?: boolean } = {}) {
  const conds = [];
  if (!opts.includeDrafts) conds.push(eq(helpArticles.status, "PUBLISHED"));
  if (opts.category && opts.category in ARTICLE_CATEGORIES) conds.push(eq(helpArticles.category, opts.category));
  if (opts.skuId) conds.push(or(sql`cardinality(${helpArticles.skuIds}) = 0`, sql`${opts.skuId} = ANY(${helpArticles.skuIds})`));
  const q = opts.q?.trim().slice(0, 80);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(helpArticles.title, like), ilike(helpArticles.summary, like), sql`${helpArticles.body}::text ILIKE ${like}`));
  }
  return db
    .select()
    .from(helpArticles)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(helpArticles.category, desc(helpArticles.helpfulYes), helpArticles.title)
    .limit(100);
}

export async function getArticle(slug: string, opts: { includeDrafts?: boolean } = {}): Promise<HelpArticleRow | null> {
  const [a] = await db.select().from(helpArticles).where(eq(helpArticles.slug, slug));
  if (!a || (!opts.includeDrafts && a.status !== "PUBLISHED")) return null;
  return a;
}

export async function recordArticleFeedback(slug: string, helpful: boolean) {
  await db
    .update(helpArticles)
    .set(helpful ? { helpfulYes: sql`${helpArticles.helpfulYes} + 1` } : { helpfulNo: sql`${helpArticles.helpfulNo} + 1` })
    .where(and(eq(helpArticles.slug, slug), eq(helpArticles.status, "PUBLISHED")));
}

/** Catalogue products an article applies to (for the product picker). */
export function productsForArticle(a: Pick<HelpArticleRow, "skuIds">): Sku[] {
  const visible = PRODUCTS.filter((p) => !p.hidden && !p.internal);
  return a.skuIds.length ? visible.filter((p) => a.skuIds.includes(p.id)) : visible;
}

/** Verified product facts straight from the catalogue. */
export function productFacts(skuId: string): { name: string; rows: Array<{ label: string; value: string }> } | null {
  const p = PRODUCTS.find((x) => x.id === skuId);
  if (!p) return null;
  return { name: p.name, rows: pdpSpecRows(p).map((r) => ({ label: r.label, value: String(r.value) })) };
}

export type ArticleInput = {
  slug: string;
  title: string;
  summary: string;
  category: ArticleCategory;
  difficulty: "EASY" | "MEDIUM" | "ADVANCED";
  body: ArticleBody;
  skuIds: string[];
  relatedSlugs: string[];
  videoUrl: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  needsVerification: boolean;
};

export async function saveArticle(id: string | null, input: ArticleInput, staffEmail: string): Promise<string> {
  const now = new Date();
  const values = {
    ...input,
    lastReviewedAt: now,
    updatedBy: staffEmail,
    updatedAt: now,
    verifiedBy: input.needsVerification ? null : staffEmail,
  };
  if (id) {
    await db.update(helpArticles).set(values).where(eq(helpArticles.id, id));
    return id;
  }
  const [row] = await db.insert(helpArticles).values({ ...values, createdBy: staffEmail }).returning({ id: helpArticles.id });
  return row.id;
}

/** Insert the starter articles that don't exist yet. Never overwrites. */
export async function loadStarterArticles(staffEmail: string): Promise<number> {
  const catalogue = PRODUCTS.filter((p) => !p.hidden && !p.internal);
  const rows = SEED_ARTICLES.map((s) => ({
    slug: s.slug,
    title: s.title,
    summary: s.summary,
    category: s.category,
    difficulty: s.difficulty,
    body: { steps: s.steps, note: s.note, sources: s.sources } satisfies ArticleBody,
    skuIds: s.productCategories.length ? catalogue.filter((p) => s.productCategories.includes(p.category ?? "")).map((p) => p.id) : [],
    relatedSlugs: s.related,
    status: "PUBLISHED",
    needsVerification: s.needsVerification,
    lastReviewedAt: new Date(),
    createdBy: staffEmail,
    updatedBy: staffEmail,
  }));
  const inserted = await db.insert(helpArticles).values(rows).onConflictDoNothing().returning({ id: helpArticles.id });
  return inserted.length;
}

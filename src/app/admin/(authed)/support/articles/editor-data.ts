/**
 * Server-side props for the article editor: categories, the visible catalogue
 * (hidden / internal SKUs excluded) and the other articles for "related".
 */

import type { HelpArticleRow } from "@/db/schema";
import { PRODUCTS } from "@/lib/products";
import { listArticleOptions } from "@/lib/support/admin-queries";
import { ARTICLE_CATEGORIES, type ArticleBody } from "@/lib/support/kb";
import type { ArticleEditorValue } from "./ArticleEditor";

export const ARTICLE_STATUS = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export const ARTICLE_DIFFICULTY = ["EASY", "MEDIUM", "ADVANCED"] as const;

export async function editorProps() {
  const articles = await listArticleOptions();
  return {
    categories: Object.entries(ARTICLE_CATEGORIES).map(([value, label]) => ({ value, label })),
    products: PRODUCTS.filter((p) => !p.hidden && !p.internal).map((p) => ({
      id: p.id,
      name: p.name,
      group: p.category ? p.category.charAt(0).toUpperCase() + p.category.slice(1) : p.scale,
    })),
    articles: articles.map((a) => ({ slug: a.slug, title: a.title })),
  };
}

export const EMPTY_ARTICLE: ArticleEditorValue = {
  title: "",
  slug: "",
  summary: "",
  category: "TROUBLESHOOTING",
  difficulty: "EASY",
  steps: [],
  note: "",
  videoUrl: "",
  skuIds: [],
  relatedSlugs: [],
  status: "DRAFT",
  needsVerification: true,
};

const pick = <T extends string>(allowed: readonly T[], v: string, fallback: T): T => ((allowed as readonly string[]).includes(v) ? (v as T) : fallback);

export function editorValueOf(a: HelpArticleRow): ArticleEditorValue {
  const body = (a.body ?? {}) as Partial<ArticleBody>;
  return {
    title: a.title,
    slug: a.slug,
    summary: a.summary,
    category: pick(Object.keys(ARTICLE_CATEGORIES) as Array<keyof typeof ARTICLE_CATEGORIES>, a.category, "TROUBLESHOOTING"),
    difficulty: pick(ARTICLE_DIFFICULTY, a.difficulty, "EASY"),
    steps: (Array.isArray(body.steps) ? body.steps : []).map((s) => ({ title: s.title ?? "", text: s.text ?? "", image: s.image ?? "" })),
    note: body.note ?? "",
    videoUrl: a.videoUrl ?? "",
    skuIds: a.skuIds,
    relatedSlugs: a.relatedSlugs,
    status: pick(ARTICLE_STATUS, a.status, "DRAFT"),
    needsVerification: a.needsVerification,
  };
}

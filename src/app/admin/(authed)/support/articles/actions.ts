"use server";

/**
 * Help-article editing (articles.edit — owner, manager, support supervisor).
 * Input is validated with zod here; slugs must be unique; SKU ids must be
 * visible catalogue products; related slugs must be existing articles.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { logError } from "@/lib/logger";
import { PRODUCTS } from "@/lib/products";
import { articleSlugTaken, getArticleById, isMissingTableError, listArticleOptions } from "@/lib/support/admin-queries";
import { ARTICLE_CATEGORIES, loadStarterArticles, saveArticle, type ArticleBody, type ArticleCategory } from "@/lib/support/kb";

export type ArticleResult = { ok: true; id: string; message?: string } | { ok: false; error: string };
export type StarterResult = { ok: true; count: number } | { ok: false; error: string };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY_KEYS = Object.keys(ARTICLE_CATEGORIES) as [ArticleCategory, ...ArticleCategory[]];
const httpsUrl = (v: string) => v === "" || /^https:\/\/[^\s]+$/i.test(v);
const imageRef = (v: string) => httpsUrl(v) || /^\/[^\s/][^\s]*$/.test(v);

const articleSchema = z.object({
  title: z.string().trim().min(3, "Title needs at least 3 characters").max(140, "Title is too long"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Slug needs at least 3 characters")
    .max(80, "Slug is too long")
    .regex(SLUG, "Slug: lowercase letters, numbers and single hyphens only"),
  summary: z.string().trim().max(300, "Summary is too long (300 max)"),
  category: z.enum(CATEGORY_KEYS),
  difficulty: z.enum(["EASY", "MEDIUM", "ADVANCED"]),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(1, "Every step needs a title").max(120, "Step title is too long"),
        text: z.string().trim().min(1, "Every step needs text").max(2000, "Step text is too long"),
        image: z.string().trim().max(500).refine(imageRef, "Step image must be an https:// URL or a /path on this site"),
      }),
    )
    .min(1, "Add at least one step")
    .max(30, "At most 30 steps"),
  note: z.string().trim().max(2000, "Note is too long"),
  videoUrl: z.string().trim().max(500).refine(httpsUrl, "Video URL must start with https://"),
  skuIds: z.array(z.string().max(80)).max(200),
  relatedSlugs: z.array(z.string().regex(SLUG)).max(10, "At most 10 related articles"),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  needsVerification: z.boolean(),
});

export type ArticleFormInput = z.input<typeof articleSchema>;

function refresh(id?: string) {
  revalidatePath("/admin/support/articles");
  if (id) revalidatePath(`/admin/support/articles/${id}`);
  // Customer help pages (/support, /support/help/…).
  revalidatePath("/support", "layout");
}

export async function saveArticleAction(id: string | null, input: ArticleFormInput): Promise<ArticleResult> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "articles.edit")) return { ok: false, error: "Your role can't edit help articles." };

  const parsed = articleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;

  try {
    const existing = id ? await getArticleById(id) : null;
    if (id && !existing) return { ok: false, error: "That article no longer exists." };
    if (await articleSlugTaken(v.slug, id)) return { ok: false, error: `Another article already uses the slug “${v.slug}”.` };

    const catalogue = new Set(PRODUCTS.filter((p) => !p.hidden && !p.internal).map((p) => p.id));
    const unknownSku = v.skuIds.find((s) => !catalogue.has(s));
    if (unknownSku) return { ok: false, error: `Unknown product ${unknownSku}.` };
    const known = new Set((await listArticleOptions()).map((a) => a.slug));
    const relatedSlugs = [...new Set(v.relatedSlugs)].filter((s) => s !== v.slug && known.has(s));

    const previous = (existing?.body ?? {}) as Partial<ArticleBody>;
    const body: ArticleBody = {
      steps: v.steps.map((s) => (s.image ? { title: s.title, text: s.text, image: s.image } : { title: s.title, text: s.text })),
      ...(v.note ? { note: v.note } : {}),
      // Provenance from the starter set is kept across edits.
      ...(Array.isArray(previous.sources) && previous.sources.length ? { sources: previous.sources } : {}),
    };

    const savedId = await saveArticle(
      id,
      {
        slug: v.slug,
        title: v.title,
        summary: v.summary,
        category: v.category,
        difficulty: v.difficulty,
        body,
        skuIds: [...new Set(v.skuIds)],
        relatedSlugs,
        videoUrl: v.videoUrl || null,
        status: v.status,
        needsVerification: v.needsVerification,
      },
      ctx.email,
    );
    refresh(savedId);
    return { ok: true, id: savedId, message: v.status === "PUBLISHED" ? "Saved and live on the help centre" : "Saved" };
  } catch (err) {
    if (isMissingTableError(err)) return { ok: false, error: "The support centre isn't set up yet — apply the support migration." };
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e?.code ?? e?.cause?.code) === "23505") return { ok: false, error: `Another article already uses the slug “${v.slug}”.` };
    logError("admin:support:article-save", err, { id });
    return { ok: false, error: "Couldn't save the article — try again." };
  }
}

export async function loadStarterArticlesAction(): Promise<StarterResult> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "articles.edit")) return { ok: false, error: "Your role can't edit help articles." };
  try {
    const count = await loadStarterArticles(ctx.email);
    refresh();
    return { ok: true, count };
  } catch (err) {
    if (isMissingTableError(err)) return { ok: false, error: "The support centre isn't set up yet — apply the support migration." };
    logError("admin:support:starter-articles", err);
    return { ok: false, error: "Couldn't load the starter articles — try again." };
  }
}

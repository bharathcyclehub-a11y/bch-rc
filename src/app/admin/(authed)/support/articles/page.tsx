import Link from "next/link";
import { BookOpen, ChevronRight, Plus, SearchX } from "lucide-react";
import type { HelpArticleRow } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { formatRelative, requestTime } from "@/lib/admin/format";
import { can } from "@/lib/admin/permissions";
import { isMissingTableError } from "@/lib/support/admin-queries";
import { ARTICLE_CATEGORIES, listArticles, type ArticleCategory } from "@/lib/support/kb";
import { Badge, Tag } from "@/components/admin/Badge";
import { ButtonLink } from "@/components/admin/Button";
import { EmptyState } from "@/components/admin/EmptyState";
import { UrlFilters, type FilterDef } from "@/components/admin/Filters";
import { PageHeader } from "@/components/admin/PageHeader";
import { Panel } from "@/components/admin/Panel";
import { SearchForm } from "@/components/admin/SearchForm";
import { RowLink, Table, TBody, TD, TH, THead, TR } from "@/components/admin/Table";
import { NoAccessNotice, shortEmail, SupportSetupNotice } from "../ticket-ui";
import { ARTICLE_STATUS } from "./editor-data";
import { LoadStarterButton } from "./LoadStarterButton";

type SearchParams = Record<string, string | string[] | undefined>;

const STATUS_META: Record<string, { label: string; tone: "positive" | "neutral" | "attention" }> = {
  PUBLISHED: { label: "Published", tone: "positive" },
  DRAFT: { label: "Draft", tone: "neutral" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

const FILTERS: FilterDef[] = [
  {
    key: "category",
    label: "Category",
    options: [{ value: "", label: "All" }, ...Object.entries(ARTICLE_CATEGORIES).map(([value, label]) => ({ value, label }))],
  },
  {
    key: "status",
    label: "Status",
    options: [{ value: "", label: "All" }, ...ARTICLE_STATUS.map((s) => ({ value: s, label: STATUS_META[s].label })), { value: "verify", label: "Needs verification" }],
  },
];

export default async function HelpArticlesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "support.view")) return <NoAccessNotice title="Help articles" />;
  const params = await searchParams;
  const q = first(params.q).trim().slice(0, 80);
  const category = first(params.category) in ARTICLE_CATEGORIES ? (first(params.category) as ArticleCategory) : "";
  const statusRaw = first(params.status);
  const status = (ARTICLE_STATUS as readonly string[]).includes(statusRaw) || statusRaw === "verify" ? statusRaw : "";
  const canEdit = can(ctx.role, "articles.edit");
  const now = requestTime();

  let all: HelpArticleRow[];
  let fetched: HelpArticleRow[];
  try {
    all = await listArticles({ includeDrafts: true });
    fetched = q || category ? await listArticles({ q, category: category || undefined, includeDrafts: true }) : all;
  } catch (err) {
    if (isMissingTableError(err)) return <SupportSetupNotice title="Help articles" />;
    throw err;
  }
  const rows = fetched.filter((a) => (status === "verify" ? a.needsVerification && a.status !== "ARCHIVED" : !status || a.status === status));
  const published = all.filter((a) => a.status === "PUBLISHED").length;
  const drafts = all.filter((a) => a.status === "DRAFT").length;
  const toVerify = all.filter((a) => a.needsVerification && a.status !== "ARCHIVED").length;
  const filtered = Boolean(q || category || status);

  return (
    <>
      <PageHeader
        title="Help articles"
        description={<span className="block truncate">{published} published · {drafts} draft{drafts === 1 ? "" : "s"} · {toVerify} need verification</span>}
        actions={
          canEdit ? (
            <>
              <LoadStarterButton />
              <ButtonLink href="/admin/support/articles/new" variant="primary" icon={<Plus size={15} aria-hidden />} className="max-sm:w-11 max-sm:px-0">
                <span className="max-sm:sr-only">New article</span>
              </ButtonLink>
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <SearchForm
          action="/admin/support/articles"
          defaultValue={q}
          placeholder="Search title, summary or steps"
          keep={{ category: category || undefined, status: status || undefined }}
          clearHref={href({ category, status })}
          className="max-md:flex-none md:max-w-md"
        />
        <UrlFilters filters={FILTERS} />
      </div>

      <Panel className="mt-4">
        {rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title={q ? `No articles match “${q}”` : "No articles match these filters"}
              action={<ButtonLink href="/admin/support/articles" size="sm">Clear search and filters</ButtonLink>}
            />
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No help articles yet"
              description="Start from the starter set — written from copy already on the site — then verify each one."
              action={canEdit ? <LoadStarterButton variant="primary" /> : undefined}
            />
          )
        ) : (
          <>
            <Table className="max-md:hidden">
              <THead>
                <TH className="pl-4 pr-3">Article</TH>
                <TH className="px-3">Category</TH>
                <TH className="px-3">Status</TH>
                <TH className="hidden px-3 lg:table-cell">Products</TH>
                <TH align="right" className="px-3">Helpful</TH>
                <TH align="right" className="pl-3 pr-4">Last reviewed</TH>
              </THead>
              <TBody>
                {rows.map((a) => (
                  <TR key={a.id}>
                    <TD className="w-[40%] max-w-0 pl-4 pr-3">
                      <RowLink href={`/admin/support/articles/${a.id}`} className="block truncate">{a.title}</RowLink>
                      <div className="truncate font-mono text-xs text-admin-muted">{a.slug}</div>
                    </TD>
                    <TD nowrap className="px-3 text-brand-ink-soft">{ARTICLE_CATEGORIES[a.category as ArticleCategory] ?? a.category}</TD>
                    <TD className="px-3">
                      <ArticleBadges a={a} />
                    </TD>
                    <TD nowrap className="hidden px-3 text-brand-ink-soft lg:table-cell">{a.skuIds.length ? `${a.skuIds.length} product${a.skuIds.length === 1 ? "" : "s"}` : "All"}</TD>
                    <TD align="right" nowrap className="px-3 text-brand-ink-soft">
                      <span className="text-tone-pos">{a.helpfulYes}</span> yes · <span className="text-tone-neg">{a.helpfulNo}</span> no
                    </TD>
                    <TD align="right" nowrap className="pl-3 pr-4 text-xs text-admin-muted">
                      {a.lastReviewedAt ? formatRelative(a.lastReviewedAt, now) : "Never"}
                      {a.updatedBy && <div className="truncate">by {shortEmail(a.updatedBy)}</div>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <ul className="divide-y divide-admin-line md:hidden">
              {rows.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/support/articles/${a.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-admin-subtle">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-brand-ink">{a.title}</p>
                      <p className="mt-0.5 truncate text-xs text-admin-muted">{ARTICLE_CATEGORIES[a.category as ArticleCategory] ?? a.category}</p>
                      <div className="mt-1.5">
                        <ArticleBadges a={a} />
                      </div>
                      <p className="mt-1.5 text-xs text-admin-muted">
                        {a.helpfulYes} yes · {a.helpfulNo} no · reviewed {a.lastReviewedAt ? formatRelative(a.lastReviewedAt, now).toLowerCase() : "never"}
                      </p>
                    </div>
                    <ChevronRight size={16} aria-hidden className="shrink-0 text-admin-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="border-t border-admin-line px-4 py-3 text-xs tabular-nums text-admin-muted sm:px-5">
              Showing {rows.length} article{rows.length === 1 ? "" : "s"}
              {fetched.length >= 100 ? " (first 100 — narrow with search)" : ""}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

function ArticleBadges({ a }: { a: HelpArticleRow }) {
  const m = STATUS_META[a.status] ?? { label: a.status, tone: "neutral" as const };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={m.tone}>{m.label}</Badge>
      {a.needsVerification && a.status !== "ARCHIVED" && <Badge tone="attention">Needs verification</Badge>}
      {a.videoUrl && <Tag>Video</Tag>}
    </span>
  );
}

function href(s: { category?: string; status?: string }): string {
  const sp = new URLSearchParams();
  if (s.category) sp.set("category", s.category);
  if (s.status) sp.set("status", s.status);
  const qs = sp.toString();
  return qs ? `/admin/support/articles?${qs}` : "/admin/support/articles";
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

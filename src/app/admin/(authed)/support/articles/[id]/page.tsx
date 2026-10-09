import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { formatDateTimeShort } from "@/lib/admin/format";
import { can } from "@/lib/admin/permissions";
import { getArticleById, isMissingTableError, isUuid } from "@/lib/support/admin-queries";
import { getArticle } from "@/lib/support/kb";
import type { HelpArticleRow } from "@/db/schema";
import { Badge } from "@/components/admin/Badge";
import { ButtonLink } from "@/components/admin/Button";
import { PageHeader } from "@/components/admin/PageHeader";
import { NoAccessNotice, shortEmail, SupportSetupNotice } from "../../ticket-ui";
import { ArticleEditor } from "../ArticleEditor";
import { editorProps, editorValueOf } from "../editor-data";

export default async function EditHelpArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "support.view")) return <NoAccessNotice title="Help article" />;
  const { id } = await params;

  let article: HelpArticleRow | null;
  let props: Awaited<ReturnType<typeof editorProps>>;
  try {
    // Ids are uuids; a slug also works so links from the help centre resolve.
    [article, props] = await Promise.all([
      isUuid(id) ? getArticleById(id) : getArticle(decodeURIComponent(id), { includeDrafts: true }),
      editorProps(),
    ]);
  } catch (err) {
    if (isMissingTableError(err)) return <SupportSetupNotice title="Help article" />;
    throw err;
  }
  if (!article) notFound();
  const canEdit = can(ctx.role, "articles.edit");

  const meta = [
    article.updatedBy ? `Updated by ${shortEmail(article.updatedBy)} · ${formatDateTimeShort(article.updatedAt)}` : null,
    article.verifiedBy && !article.needsVerification ? `verified by ${shortEmail(article.verifiedBy)}` : null,
    `${article.helpfulYes} found it helpful · ${article.helpfulNo} didn't`,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/support/articles", label: "Help articles" }}
        title={article.title}
        badges={article.needsVerification && article.status !== "ARCHIVED" ? <Badge tone="attention">Needs verification</Badge> : undefined}
        description={meta.join(" · ")}
        actions={
          article.status === "PUBLISHED" ? (
            <ButtonLink href={`/support/help/${article.slug}`} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={15} aria-hidden />}>
              View on help centre
            </ButtonLink>
          ) : undefined
        }
      />
      {!canEdit && (
        <p className="mb-4 rounded-lg border border-admin-line bg-admin-subtle px-3 py-2 text-[13px] text-brand-ink-soft">
          Read-only — your role can view help articles but not edit them.
        </p>
      )}
      <ArticleEditor key={article.updatedAt.toISOString()} id={article.id} initial={editorValueOf(article)} canEdit={canEdit} {...props} />
    </>
  );
}

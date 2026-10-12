import { requireAdmin } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { isMissingTableError } from "@/lib/support/admin-queries";
import { PageHeader } from "@/components/admin/PageHeader";
import { NoAccessNotice, SupportSetupNotice } from "../../ticket-ui";
import { ArticleEditor } from "../ArticleEditor";
import { EMPTY_ARTICLE, editorProps } from "../editor-data";

export default async function NewHelpArticlePage() {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "articles.edit")) return <NoAccessNotice title="New article" what="the article editor" />;

  let props: Awaited<ReturnType<typeof editorProps>>;
  try {
    props = await editorProps();
  } catch (err) {
    if (isMissingTableError(err)) return <SupportSetupNotice title="New article" />;
    throw err;
  }

  return (
    <>
      <PageHeader
        back={{ href: "/admin/support/articles", label: "Help articles" }}
        title="New article"
        description="Saved as a draft until you publish it."
      />
      <ArticleEditor id={null} initial={EMPTY_ARTICLE} canEdit {...props} />
    </>
  );
}

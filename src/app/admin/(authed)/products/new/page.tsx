import { Database, Lock } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { draftsAvailable, PRODUCT_CATEGORIES, reservedProductSlugs } from "@/lib/admin/catalog";
import { can } from "@/lib/admin/permissions";
import { LOW_STOCK_THRESHOLD } from "@/lib/stock-threshold";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ButtonLink } from "@/components/admin/Button";
import { Panel } from "@/components/admin/Panel";
import { ProductEditor } from "../_editor/ProductEditor";
import { emptyEditorValues } from "../_editor/values";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const ctx = await requireAdmin();

  if (!can(ctx.role, "products.create"))
    return (
      <Panel>
        <EmptyState
          icon={Lock}
          title="You can't add products"
          description="Your admin role can't create products. Ask an owner if you need access."
          action={<ButtonLink href="/admin/products">Back to products</ButtonLink>}
        />
      </Panel>
    );

  if (!(await draftsAvailable()))
    return (
      <>
        <PageHeader back={{ href: "/admin/products", label: "Products" }} title="New product" />
        <Panel>
          <EmptyState
            icon={Database}
            title="Product drafts need a one-time database update"
            description={
              <>
                Apply <code className="font-mono text-xs">src/db/migrations/manual/2026-09-15_admin_product_drafts.sql</code> in the
                Supabase SQL editor, then reload. It only adds columns; existing data and the storefront are untouched.
              </>
            }
            action={<ButtonLink href="/admin/products">Back to products</ButtonLink>}
          />
        </Panel>
      </>
    );

  return (
    <ProductEditor
      mode="create"
      productId={null}
      productName="New product"
      initial={emptyEditorValues(PRODUCT_CATEGORIES[0]?.key ?? "mini64")}
      base={null}
      categories={PRODUCT_CATEGORIES.map(({ key, label }) => ({ key, label }))}
      reservedSlugs={reservedProductSlugs()}
      lowThreshold={LOW_STOCK_THRESHOLD}
      storefrontPath={null}
    />
  );
}

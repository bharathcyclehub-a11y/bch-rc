import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { loadProductDetail, PRODUCT_CATEGORIES, reservedProductSlugs } from "@/lib/admin/catalog";
import { can } from "@/lib/admin/permissions";
import { EmptyState } from "@/components/admin/EmptyState";
import { ButtonLink } from "@/components/admin/Button";
import { Panel } from "@/components/admin/Panel";
import { ProductEditor } from "../../_editor/ProductEditor";
import { toEditorValues } from "../../_editor/values";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  const { id } = await params;
  const product = await loadProductDetail(decodeURIComponent(id), ctx.siteIds);
  if (!product) notFound();

  if (!can(ctx.role, "products.edit"))
    return (
      <Panel>
        <EmptyState
          icon={Lock}
          title="You can't edit products"
          description="Your admin role can view products but not change them. Ask an owner if you need access."
          action={<ButtonLink href={`/admin/products/${product.id}`}>Back to product</ButtonLink>}
        />
      </Panel>
    );

  // Remount the editor whenever the saved data changes (after Save & continue).
  const version = [product.updatedAt, ...product.variants.map((v) => v.stock)].join("|");

  return (
    <ProductEditor
      key={version}
      mode={product.source === "draft" ? "draft" : "catalogue"}
      productId={product.id}
      productName={product.name}
      initial={toEditorValues(product)}
      base={product.base}
      categories={PRODUCT_CATEGORIES.map(({ key, label }) => ({ key, label }))}
      reservedSlugs={reservedProductSlugs()}
      lowThreshold={product.lowThreshold}
      storefrontPath={product.storefrontPath}
    />
  );
}

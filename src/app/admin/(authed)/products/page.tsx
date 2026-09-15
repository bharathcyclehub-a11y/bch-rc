import { requireAdmin } from "@/lib/admin-auth";
import { loadAdminProducts, PRODUCT_CATEGORIES } from "@/lib/admin/catalog";
import { permissionsFor } from "@/lib/admin/permissions";
import { ProductsView } from "./ProductsView";

export const dynamic = "force-dynamic";

/**
 * Products list. One read model (src/lib/admin/catalog.ts) merges the code
 * catalogue + admin overrides + live inventory + admin drafts; filtering,
 * sorting and selection happen client-side in <ProductsView>.
 */
export default async function AdminProducts() {
  const ctx = await requireAdmin();
  const { products, draftsAvailable } = await loadAdminProducts(ctx.siteIds);
  return (
    <ProductsView
      products={products}
      categories={PRODUCT_CATEGORIES}
      draftsAvailable={draftsAvailable}
      permissions={permissionsFor(ctx.role)}
    />
  );
}

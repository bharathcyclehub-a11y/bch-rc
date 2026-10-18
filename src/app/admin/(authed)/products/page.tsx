import { requireAdmin } from "@/lib/admin-auth";
import { loadAdminProducts, loadStockFailures, PRODUCT_CATEGORIES } from "@/lib/admin/catalog";
import { permissionsFor } from "@/lib/admin/permissions";
import { getInventoryHealth } from "@/lib/inventory";
import { getRestockDemandSummary } from "@/lib/restock";
import { ProductsView } from "./ProductsView";

export const dynamic = "force-dynamic";

/**
 * Products list. One read model (src/lib/admin/catalog.ts) merges the code
 * catalogue + admin overrides + live inventory + admin drafts; filtering,
 * sorting and selection happen client-side in <ProductsView>.
 */
export default async function AdminProducts() {
  const ctx = await requireAdmin();
  const [{ products, draftsAvailable }, health, restockSummary, stockFailures] = await Promise.all([
    loadAdminProducts(ctx.siteIds),
    getInventoryHealth(ctx.siteIds).catch(() => null),
    getRestockDemandSummary().catch(() => ({ totalPending: 0, totalNotified: 0, bySkuVariant: [] })),
    loadStockFailures(ctx.siteIds, undefined, 10),
  ]);
  return (
    <ProductsView
      products={products}
      categories={PRODUCT_CATEGORIES}
      draftsAvailable={draftsAvailable}
      permissions={permissionsFor(ctx.role)}
      misconfiguredActive={health?.misconfiguredActive ?? []}
      restockSummary={restockSummary}
      stockFailures={stockFailures}
    />
  );
}

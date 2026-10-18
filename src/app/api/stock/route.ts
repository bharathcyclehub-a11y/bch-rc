/**
 * GET /api/stock[?skuIds=a,b,c]
 *
 * Public, read-only live stock map keyed `${skuId}:${variantSlug}` (variant ""
 * for colourless SKUs), plus active admin product overrides. This is how the
 * storefront (grid, PDP, cart, checkout, bundles) reflects the authoritative DB
 * inventory and status instead of static products.ts values.
 *
 * Fail-closed: on a DB error we return `{ ok: false, stock: null }` so clients
 * know stock is unknown and never default to in-stock.
 */

import { NextResponse } from "next/server";
import { getStockMap, INVENTORY_SITE_ID } from "@/lib/inventory";
import { getOverrideMap, type ProductOverride } from "@/lib/product-overrides";
import { logError } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = rateLimit(req, { scope: "stock", limit: 120 });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("skuIds");
  const skuIds = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  try {
    const [stock, overrideMap] = await Promise.all([
      getStockMap(skuIds),
      getOverrideMap([INVENTORY_SITE_ID]),
    ]);

    const overrides: Record<string, ProductOverride> = {};
    for (const [k, v] of overrideMap.entries()) {
      if (!skuIds || skuIds.includes(k)) {
        overrides[k] = v;
      }
    }

    return NextResponse.json(
      { ok: true, stock, overrides },
      {
        headers: {
          "Cache-Control":
            "public, max-age=5, s-maxage=5, stale-while-revalidate=15",
        },
      },
    );
  } catch (err) {
    logError("api:stock", err);
    return NextResponse.json(
      { ok: false, stock: null, overrides: {} },
      { status: 503 },
    );
  }
}

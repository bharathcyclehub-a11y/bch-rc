"use client";

import { useState } from "react";
import { Table, THead, TH, TBody, TR, TD } from "@/components/admin/Table";
import { Button } from "@/components/admin/Button";
import { StockBadge } from "@/components/admin/Badge";
import { formatINR } from "@/lib/utils";
import { stockStateOf } from "@/lib/admin/status";
import type { AdminVariant } from "@/lib/admin/catalog";
import { Swatch } from "../../product-ui";
import { StockAdjustDialog, type AdjustTarget } from "./StockAdjustDialog";

/**
 * Variants with stock. Catalogue products read live inventory and can be
 * adjusted in place; drafts show their planned opening stock (edited in the
 * product editor, applied when the product is published). Identifiers and
 * price overrides sit under the variant name so the table fits a half-width
 * panel at every breakpoint.
 */
export function VariantStock({
  productId,
  productName,
  source,
  variants,
  lowThreshold,
  canAdjust,
}: {
  productId: string;
  productName: string;
  source: "catalogue" | "draft";
  variants: AdminVariant[];
  lowThreshold: number;
  canAdjust: boolean;
}) {
  const [target, setTarget] = useState<AdjustTarget | null>(null);
  const live = source === "catalogue";
  const adjustable = live && canAdjust;
  const detail = (v: AdminVariant) =>
    [live ? v.slug || "default" : v.sku, v.priceInr != null ? `${formatINR(v.priceInr)} override` : null]
      .filter(Boolean)
      .join(" · ");
  const adjust = (v: AdminVariant) => setTarget({ slug: v.slug, name: v.name, stock: v.stock });

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <THead>
            <TH>Variant</TH>
            <TH align="right">Stock</TH>
            <TH>Status</TH>
            {adjustable && (
              <TH align="right">
                <span className="sr-only">Actions</span>
              </TH>
            )}
          </THead>
          <TBody>
            {variants.map((v) => (
              <TR key={v.slug || "default"}>
                <TD className="w-full max-w-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Swatch swatch={v.swatch} className="h-3.5 w-3.5" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{v.name}</p>
                      {detail(v) && <p className="truncate font-mono text-[11px] text-admin-muted">{detail(v)}</p>}
                    </div>
                  </div>
                </TD>
                <TD align="right" nowrap className="font-semibold">
                  {v.stock ?? "—"}
                </TD>
                <TD nowrap>
                  <StockBadge state={stockStateOf(v.stock, lowThreshold)} />
                </TD>
                {adjustable && (
                  <TD align="right" interactive>
                    <Button size="sm" onClick={() => adjust(v)}>
                      Adjust
                    </Button>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="divide-y divide-admin-line md:hidden">
        {variants.map((v) => (
          <li key={v.slug || "default"} className="flex items-center gap-3 px-4 py-3">
            <Swatch swatch={v.swatch} className="h-5 w-5" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-brand-ink">{v.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-admin-muted">
                <span className="font-semibold tabular-nums text-brand-ink">{v.stock ?? "—"}</span>
                <StockBadge state={stockStateOf(v.stock, lowThreshold)} />
                {detail(v) && <span className="truncate font-mono text-[11px]">{detail(v)}</span>}
              </p>
            </div>
            {adjustable && (
              <Button size="sm" onClick={() => adjust(v)}>
                Adjust
              </Button>
            )}
          </li>
        ))}
      </ul>

      <StockAdjustDialog
        productId={productId}
        productName={productName}
        target={target}
        lowThreshold={lowThreshold}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

"use client";

import { Table, THead, TH, TBody, TR, TD, RowLink } from "@/components/admin/Table";
import { Checkbox } from "@/components/admin/Field";
import { ProductStatusBadge, Tag } from "@/components/admin/Badge";
import type { AdminProduct } from "@/lib/admin/catalog";
import type { PermissionSet } from "@/lib/admin/permissions";
import { ProductRowActions } from "./ProductRowActions";
import type { ProductAction } from "./ProductActionDialog";
import { PriceText, ProductThumb, StockText, SwatchSummary } from "./product-ui";

/** Operations view (md+): dense rows, selection, whole-row click to the product. */
export function ProductTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  permissions,
  onAction,
}: {
  rows: AdminProduct[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  permissions: PermissionSet;
  onAction: (a: ProductAction) => void;
}) {
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const some = rows.some((r) => selected.has(r.id));
  return (
    <Table minWidth={640}>
      <THead>
        <TH className="w-10 pr-0">
          <Checkbox checked={all} indeterminate={some} onChange={onToggleAll} label="Select all shown products" />
        </TH>
        <TH>Product</TH>
        <TH>Status</TH>
        <TH className="hidden lg:table-cell">Category</TH>
        <TH>Price</TH>
        <TH className="hidden xl:table-cell">Variants</TH>
        <TH align="right">Stock</TH>
        <TH className="w-12">
          <span className="sr-only">Actions</span>
        </TH>
      </THead>
      <TBody>
        {rows.map((p) => {
          const isSelected = selected.has(p.id);
          return (
            <TR key={p.id} selected={isSelected}>
              <TD interactive className="w-10 pr-0">
                <Checkbox checked={isSelected} onChange={() => onToggle(p.id)} label={`Select ${p.name}`} />
              </TD>
              {/* 34% + max-w-0: flexible but capped, so wide screens spread the other columns. */}
              <TD className="w-[34%] max-w-0">
                <div className="flex min-w-48 items-center gap-3">
                  <ProductThumb src={p.image} alt="" className="h-10 w-10" sizes="40px" />
                  <div className="min-w-0">
                    <RowLink href={`/admin/products/${p.id}`} className="block truncate">
                      {p.name}
                    </RowLink>
                    <p className="truncate font-mono text-[11px] text-admin-muted">
                      {p.source === "draft" ? p.slug : p.id}
                      {p.internal && " · internal"}
                    </p>
                  </div>
                </div>
              </TD>
              <TD nowrap>
                <ProductStatusBadge status={p.status} />
              </TD>
              <TD nowrap className="hidden text-brand-ink-soft lg:table-cell">
                {p.categoryLabel}
                {!p.categoryLabel.includes(p.scale) && (
                  <Tag mono className="ml-1.5">
                    {p.scale}
                  </Tag>
                )}
              </TD>
              <TD nowrap>
                <PriceText price={p.priceInr} mrp={p.mrpInr} />
              </TD>
              <TD className="hidden xl:table-cell">
                <SwatchSummary variants={p.variants} />
              </TD>
              <TD align="right">
                <StockText product={p} />
              </TD>
              <TD interactive className="w-12 pl-0 text-right">
                <ProductRowActions product={p} permissions={permissions} onAction={onAction} />
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

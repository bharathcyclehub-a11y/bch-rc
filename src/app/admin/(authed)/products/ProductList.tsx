"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/admin/Field";
import { ProductStatusBadge } from "@/components/admin/Badge";
import type { AdminProduct } from "@/lib/admin/catalog";
import { PriceText, ProductThumb, StockText } from "./product-ui";

/** Phone list: one tap target per product; "Select" mode swaps navigation for selection. */
export function ProductList({
  rows,
  selected,
  selecting,
  onToggle,
}: {
  rows: AdminProduct[];
  selected: Set<string>;
  selecting: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-admin-line">
      {rows.map((p) => {
        const isSelected = selected.has(p.id);
        const nameCls = "line-clamp-2 text-left text-sm font-semibold leading-5 text-brand-ink after:absolute after:inset-0";
        return (
          <li key={p.id} className={cn("relative flex items-start gap-3 px-4 py-3", isSelected && "bg-brand-red-soft")}>
            {selecting && (
              <span className="relative z-10 grid h-14 w-6 shrink-0 place-items-center">
                <Checkbox checked={isSelected} onChange={() => onToggle(p.id)} label={`Select ${p.name}`} className="h-5 w-5" />
              </span>
            )}
            <ProductThumb src={p.image} alt="" className="h-14 w-14" sizes="56px" />
            <div className="min-w-0 flex-1">
              {selecting ? (
                <button type="button" onClick={() => onToggle(p.id)} className={nameCls}>
                  {p.name}
                </button>
              ) : (
                <Link href={`/admin/products/${p.id}`} className={nameCls}>
                  {p.name}
                </Link>
              )}
              <p className="truncate font-mono text-[11px] text-admin-muted">{p.source === "draft" ? p.slug : p.id}</p>
              <PriceText price={p.priceInr} mrp={p.mrpInr} className="mt-1 text-[13px]" />
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <ProductStatusBadge status={p.status} />
                <StockText product={p} className="text-xs" />
              </div>
            </div>
            {!selecting && <ChevronRight size={16} aria-hidden className="mt-5 shrink-0 text-admin-muted" />}
          </li>
        );
      })}
    </ul>
  );
}

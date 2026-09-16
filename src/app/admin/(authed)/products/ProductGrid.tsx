"use client";

import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/admin/Field";
import { ProductStatusBadge } from "@/components/admin/Badge";
import type { AdminProduct } from "@/lib/admin/catalog";
import type { PermissionSet } from "@/lib/admin/permissions";
import { ProductRowActions } from "./ProductRowActions";
import type { ProductAction } from "./ProductActionDialog";
import { PriceText, StockText, SwatchSummary } from "./product-ui";

/** Merchandising view: image-led tiles, 2 → 3 → 4 columns. */
export function ProductGrid({
  rows,
  selected,
  selecting,
  onToggle,
  permissions,
  onAction,
}: {
  rows: AdminProduct[];
  selected: Set<string>;
  selecting: boolean;
  onToggle: (id: string) => void;
  permissions: PermissionSet;
  onAction: (a: ProductAction) => void;
}) {
  const anySelected = selected.size > 0;
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
      {rows.map((p) => {
        const isSelected = selected.has(p.id);
        const showCheck = selecting || anySelected;
        return (
          <li
            key={p.id}
            className={cn(
              "group relative flex flex-col overflow-clip rounded-xl border bg-white transition-shadow hover:shadow-[0_4px_16px_rgba(10,10,10,0.07)]",
              isSelected ? "border-brand-ink ring-1 ring-brand-ink" : "border-admin-line",
            )}
          >
            <div className="relative aspect-[4/3] bg-admin-subtle">
              {p.image ? (
                <Image
                  src={p.image}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                  className="object-contain p-3 md:p-4"
                  unoptimized={/^https?:/.test(p.image)}
                />
              ) : (
                <span className="grid h-full place-items-center text-admin-muted">
                  <ImageOff size={20} aria-hidden />
                </span>
              )}
              <div className="absolute left-2 top-2">
                <ProductStatusBadge status={p.status} />
              </div>
              <label
                className={cn(
                  "absolute right-2 top-2 z-10 grid h-9 w-9 cursor-pointer place-items-center rounded-lg bg-white/95 ring-1 ring-admin-line transition-opacity",
                  showCheck ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-md:hidden",
                )}
              >
                <Checkbox checked={isSelected} onChange={() => onToggle(p.id)} label={`Select ${p.name}`} />
              </label>
            </div>
            <div className="flex flex-1 flex-col p-3 md:p-3.5">
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.04em] text-admin-muted">{p.categoryLabel}</p>
              {selecting ? (
                <button
                  type="button"
                  onClick={() => onToggle(p.id)}
                  className="mt-1 line-clamp-2 text-left text-[13px] font-semibold leading-5 text-brand-ink after:absolute after:inset-0"
                >
                  {p.name}
                </button>
              ) : (
                <Link
                  href={`/admin/products/${p.id}`}
                  className="mt-1 line-clamp-2 text-[13px] font-semibold leading-5 text-brand-ink after:absolute after:inset-0 hover:underline"
                >
                  {p.name}
                </Link>
              )}
              <PriceText price={p.priceInr} mrp={p.mrpInr} className="mt-1.5 text-[13px]" />
              <SwatchSummary variants={p.variants} className="mt-2" />
              <div className="mt-auto pt-3">
                <div className="flex items-center justify-between gap-2 border-t border-admin-line pt-2">
                  <StockText product={p} className="min-w-0 truncate text-xs" />
                  {!selecting && (
                    <div className="relative z-10 -mr-1.5">
                      <ProductRowActions product={p} permissions={permissions} onAction={onAction} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

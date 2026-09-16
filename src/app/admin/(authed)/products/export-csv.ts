import type { AdminProduct } from "@/lib/admin/catalog";
import { PRODUCT_STATUS_META } from "@/lib/admin/status";

function cell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Client-side CSV of the given products (current filter or selection). */
export function downloadProductsCsv(rows: AdminProduct[], filename = "pocketrc-products.csv") {
  const header = ["id", "name", "status", "source", "category", "scale", "price_inr", "mrp_inr", "stock", "stock_kind", "variants", "updated_at"];
  const lines = rows.map((p) =>
    [
      p.id,
      p.name,
      PRODUCT_STATUS_META[p.status].label,
      p.source,
      p.categoryLabel,
      p.scale,
      p.priceInr,
      p.mrpInr,
      p.stock ?? "",
      p.stockKind,
      p.variants.map((v) => `${v.name}: ${v.stock ?? "—"}`).join(" | "),
      p.updatedAt ?? "",
    ]
      .map(cell)
      .join(","),
  );
  const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "@/components/admin/Button";
import { Input, PrefixInput, Stepper } from "@/components/admin/Field";
import { StockBadge } from "@/components/admin/Badge";
import { MAX_VARIANTS } from "@/lib/admin/product-schema";
import { stockStateOf } from "@/lib/admin/status";
import { Swatch } from "../product-ui";
import { toInt, type EditorVariant } from "./values";

const HEX_RE = /^#[0-9a-f]{6}$/i;
let seq = 0;

/** Draft variants: colour, name, SKU, optional price override, opening stock. */
export function DraftVariantsEditor({
  variants,
  onChange,
  errors,
}: {
  variants: EditorVariant[];
  onChange: (next: EditorVariant[]) => void;
  errors: Record<string, string>;
}) {
  const update = (i: number, patch: Partial<EditorVariant>) =>
    onChange(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  return (
    <div className="space-y-3">
      {variants.length === 0 ? (
        <p className="rounded-lg bg-admin-subtle px-4 py-3 text-[13px] text-brand-ink-soft">
          No variants — the product is sold as a single item. Add colours or versions if it comes in more than one.
        </p>
      ) : (
        <ul className="divide-y divide-admin-line rounded-lg border border-admin-line">
          {variants.map((v, i) => {
            const nameError = errors[`variants.${i}.name`] ?? errors[`variants.${i}.slug`];
            return (
              <li key={v.key} className="flex flex-wrap items-start gap-2 p-3">
                <input
                  type="color"
                  value={HEX_RE.test(v.swatch) ? v.swatch : "#111827"}
                  onChange={(e) => update(i, { swatch: e.target.value })}
                  aria-label={`Colour for ${v.name || `variant ${i + 1}`}`}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-admin-line-strong bg-white p-1 max-md:h-11 max-md:w-11"
                />
                <div className="min-w-0 flex-1 max-md:basis-[calc(100%-6.5rem)]">
                  <Input
                    id={`field-variants.${i}.name`}
                    value={v.name}
                    invalid={!!nameError}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="Name, e.g. Racing Red"
                    aria-label={`Variant ${i + 1} name`}
                  />
                  {nameError && <p className="mt-1 text-xs text-tone-neg">{nameError}</p>}
                </div>
                <IconButton
                  label={`Remove ${v.name || `variant ${i + 1}`}`}
                  className="text-tone-neg md:order-last"
                  onClick={() => onChange(variants.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} aria-hidden />
                </IconButton>
                <Input
                  value={v.sku}
                  onChange={(e) => update(i, { sku: e.target.value.toUpperCase() })}
                  placeholder="SKU"
                  aria-label={`Variant ${i + 1} SKU`}
                  className="font-mono text-[13px] md:w-32"
                  maxLength={40}
                />
                <div className="max-md:flex-1 md:w-28">
                  <PrefixInput
                    value={v.priceInr}
                    onChange={(e) => update(i, { priceInr: e.target.value.replace(/[^\d]/g, "") })}
                    placeholder="Same"
                    aria-label={`Variant ${i + 1} price override`}
                    title="Leave empty to use the product price"
                  />
                </div>
                <Stepper
                  value={toInt(v.stock) ?? 0}
                  onChange={(n) => update(i, { stock: String(n) })}
                  label={`Opening stock for ${v.name || `variant ${i + 1}`}`}
                />
              </li>
            );
          })}
        </ul>
      )}
      <Button
        icon={<Plus size={15} aria-hidden />}
        disabled={variants.length >= MAX_VARIANTS}
        onClick={() =>
          onChange([
            ...variants,
            { key: `new-${++seq}`, name: "", slug: "", swatch: "#111827", sku: "", priceInr: "", stock: "0", image: "" },
          ])
        }
      >
        Add variant
      </Button>
    </div>
  );
}

/** Catalogue variants: names are code-defined; live stock is editable (saved via the inventory API). */
export function CatalogueStockEditor({
  variants,
  initial,
  onChange,
  lowThreshold,
}: {
  variants: EditorVariant[];
  initial: EditorVariant[];
  onChange: (next: EditorVariant[]) => void;
  lowThreshold: number;
}) {
  return (
    <ul className="divide-y divide-admin-line rounded-lg border border-admin-line">
      {variants.map((v, i) => {
        const before = initial[i]?.stock ?? "";
        const changed = v.stock !== before;
        const n = toInt(v.stock);
        return (
          <li key={v.key} className="flex flex-wrap items-center gap-3 p-3">
            <Swatch swatch={v.swatch || null} className="h-4 w-4" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-brand-ink">{v.name}</p>
              <p className="flex items-center gap-2 text-xs text-admin-muted">
                <span className="font-mono">{v.slug || "default"}</span>
                {changed && <span className={cn("font-medium", "text-tone-info")}>was {before === "" ? "—" : before}</span>}
              </p>
            </div>
            <StockBadge state={stockStateOf(n, lowThreshold)} className="max-sm:hidden" />
            <Stepper value={n ?? 0} onChange={(x) => onChange(variants.map((w, j) => (j === i ? { ...w, stock: String(x) } : w)))} label={`Stock for ${v.name}`} />
          </li>
        );
      })}
    </ul>
  );
}

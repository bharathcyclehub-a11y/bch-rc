import Image from "next/image";
import type { CSSProperties } from "react";
import { ImageOff } from "lucide-react";
import { cn, formatINR } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/admin/status";
import type { AdminProduct, AdminVariant } from "@/lib/admin/catalog";

/** ColorVariant.swatch is a solid hex or "gradient:c1,c2[,c3…]". */
export function swatchStyle(swatch: string | null): CSSProperties {
  if (!swatch) return { background: "#e5e2dc" };
  if (swatch.startsWith("gradient:")) {
    const stops = swatch
      .slice("gradient:".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { backgroundImage: `linear-gradient(135deg, ${stops.join(", ")})` };
  }
  return { backgroundColor: swatch };
}

export function Swatch({ swatch, className }: { swatch: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10", className)}
      style={swatchStyle(swatch)}
    />
  );
}

/** Overlapping swatch dots + "3 colours". Colourless products read "1 variant". */
export function SwatchSummary({ variants, className }: { variants: AdminVariant[]; className?: string }) {
  const coloured = variants.filter((v) => v.swatch);
  if (coloured.length === 0)
    return (
      <span className={cn("whitespace-nowrap text-xs text-admin-muted", className)}>
        {variants.length} variant{variants.length === 1 ? "" : "s"}
      </span>
    );
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)} title={coloured.map((v) => v.name).join(", ")}>
      <span className="flex -space-x-1">
        {coloured.slice(0, 4).map((v) => (
          <Swatch key={v.slug} swatch={v.swatch} className="ring-2 ring-white" />
        ))}
      </span>
      <span className="text-xs text-admin-muted">
        {coloured.length} colour{coloured.length === 1 ? "" : "s"}
      </span>
    </span>
  );
}

export function ProductThumb({ src, alt, className, sizes = "48px" }: { src: string | null; alt: string; className?: string; sizes?: string }) {
  return (
    <span className={cn("relative block shrink-0 overflow-hidden rounded-md border border-admin-line bg-admin-subtle", className)}>
      {src ? (
        <Image src={src} alt={alt} fill sizes={sizes} className="object-contain p-0.5" unoptimized={/^https?:/.test(src)} />
      ) : (
        <span className="grid h-full w-full place-items-center text-admin-muted">
          <ImageOff size={16} aria-hidden />
        </span>
      )}
    </span>
  );
}

export function PriceText({ price, mrp, className }: { price: number; mrp: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 whitespace-nowrap tabular-nums", className)}>
      <span className="font-semibold text-brand-ink">{formatINR(price)}</span>
      {mrp > price && <span className="text-xs text-admin-muted line-through">{formatINR(mrp)}</span>}
    </span>
  );
}

/**
 * Stock as an operator reads it: "69 in stock", "2 low", "Out of stock", plus a
 * variant alert ("· 1 variant out") when the total hides a sold-out colour.
 * Drafts show their planned opening stock, muted.
 */
export function StockText({ product, className }: { product: AdminProduct; className?: string }) {
  const { stock, stockKind, lowThreshold, outCount, lowCount } = product;
  if (stock === null) return <span className={cn("whitespace-nowrap text-admin-muted", className)}>—</span>;
  if (stockKind === "opening")
    return (
      <span className={cn("whitespace-nowrap tabular-nums text-admin-muted", className)}>
        {stock.toLocaleString("en-IN")} planned
      </span>
    );
  // The total keeps its own tone; a low or sold-out colour is called out
  // separately so "56 in stock" never turns amber without saying why.
  const tone = stock <= 0 ? "negative" : stock <= lowThreshold ? "attention" : "positive";
  const label = stock <= 0 ? "Out of stock" : stock <= lowThreshold ? `${stock} low` : `${stock.toLocaleString("en-IN")} in stock`;
  return (
    <span className={cn("whitespace-nowrap font-medium tabular-nums", TONE_TEXT[tone], className)}>
      {label}
      {stock > 0 && outCount > 0 && <span className="font-normal text-tone-neg"> · {outCount} out</span>}
      {stock > lowThreshold && lowCount > 0 && <span className="font-normal text-tone-warn"> · {lowCount} low</span>}
    </span>
  );
}

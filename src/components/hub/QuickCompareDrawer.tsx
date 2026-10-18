"use client";

import Image from "next/image";
import Link from "next/link";
import { Sku } from "@/lib/products";
import { formatINR } from "@/lib/utils";
import { getSkuUseCases, ProductAvailability, UseCaseTag } from "@/lib/availability";

const USE_CASE_LABELS: Record<UseCaseTag, string> = {
  drifting: "Drifting",
  "off-road": "Off-Road / Crawler",
  gifting: "Gifting",
  beginner: "Beginner Friendly",
};

function extractRuntime(sku: Sku): string {
  if (sku.specs.batteryMin) return `${sku.specs.batteryMin} mins`;
  const row = sku.specRows?.find((d) => /run\s*time|play\s*time|battery/i.test(d.label));
  if (row) return row.value;
  const bulletMatch = sku.bullets.find((b) => /\d+\s*(?:–|-|to)?\s*\d*\s*min/i.test(b));
  if (bulletMatch) {
    const m = bulletMatch.match(/(\d+(?:\s*(?:–|-|to)\s*\d+)?\s*min(?:utes?)?)/i);
    if (m) return m[1];
  }
  return "20–30 mins";
}

function extractSpeed(sku: Sku): string {
  if (sku.specs.topSpeedKmh) return `${sku.specs.topSpeedKmh} km/h`;
  const row = sku.specRows?.find((d) => /speed/i.test(d.label));
  if (row) return row.value;
  const bulletMatch = sku.bullets.find((b) => /\d+\s*km\/?h/i.test(b));
  if (bulletMatch) {
    const m = bulletMatch.match(/(\d+\s*km\/?h)/i);
    if (m) return m[1];
  }
  if (sku.scale === "1:16") return "18–25 km/h (Proportional Drift)";
  if (sku.category === "construction") return "High-Torque Work Drive";
  return "15 km/h (Tabletop Drift)";
}

function extractDrivetrain(sku: Sku): string {
  if (sku.specs.drive) return sku.specs.drive;
  const text = `${sku.name} ${sku.tagline} ${sku.bullets.join(" ")}`;
  if (/4wd|4x4|all[- ]wheel/i.test(text)) return "4WD";
  if (/rwd|rear[- ]wheel/i.test(text)) return "RWD";
  if (/tracked|crawler\s*tracks/i.test(text)) return "Tracked Drive";
  if (sku.scale === "1:16") return "4WD";
  return "2WD Proportional";
}

export function QuickCompareDrawer({
  selectedSkus = [],
  availMap = {},
  onRemove = () => {},
  onClear = () => {},
  onAddToCart = () => {},
}: {
  selectedSkus?: Sku[];
  availMap?: Record<string, ProductAvailability>;
  onRemove?: (skuId: string) => void;
  onClear?: () => void;
  onAddToCart?: (sku: Sku) => void;
} = {}) {
  if (selectedSkus.length === 0) return null;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-40 bg-zinc-950/95 backdrop-blur-md border-t border-white/15 shadow-2xl text-white"
      role="region"
      aria-label="Quick RC Model Comparison"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-400 text-zinc-950 text-xs font-extrabold">
              {selectedSkus.length}
            </span>
            <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white">
              Quick Spec Comparison <span className="text-white/50 font-normal">(up to 3 models)</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-white/60 hover:text-white underline cursor-pointer"
          >
            Clear comparison
          </button>
        </div>

        <div className="overflow-x-auto pb-1">
          <table className="w-full min-w-[540px] text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 text-white/50 font-semibold w-28">Model</th>
                {selectedSkus.map((sku) => {
                  const avail = availMap[sku.id];
                  const onlinePrice = Math.max(0, sku.retailINR - 100);
                  return (
                    <th key={sku.id} className="py-2 px-3 align-top min-w-[160px]">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/product/${sku.slug}`}
                          className="flex items-center gap-2 group hover:text-amber-300 transition"
                        >
                          <div className="relative w-10 h-10 rounded-lg bg-white/10 overflow-hidden shrink-0">
                            <Image
                              src={sku.heroImage}
                              alt={sku.name}
                              fill
                              sizes="40px"
                              className="object-contain p-1"
                            />
                          </div>
                          <div>
                            <div className="font-bold text-white group-hover:text-amber-300 line-clamp-1">
                              {sku.name}
                            </div>
                            <div className="text-amber-300 font-extrabold">
                              {formatINR(onlinePrice)}{" "}
                              <span className="text-[10px] font-normal text-white/50">online</span>
                            </div>
                          </div>
                        </Link>
                        <button
                          type="button"
                          onClick={() => onRemove(sku.id)}
                          aria-label={`Remove ${sku.name} from comparison`}
                          className="text-white/40 hover:text-white p-1 rounded cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                      {avail && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <span
                            className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              avail.purchasable
                                ? avail.status === "LOW_STOCK"
                                  ? "bg-amber-500/20 text-amber-300"
                                  : "bg-emerald-500/20 text-emerald-300"
                                : "bg-red-500/20 text-red-300"
                            }`}
                          >
                            {avail.label}
                          </span>
                          {avail.purchasable && (
                            <button
                              type="button"
                              onClick={() => onAddToCart(sku)}
                              className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-amber-400 text-zinc-950 hover:bg-amber-300 transition cursor-pointer"
                            >
                              + Add
                            </button>
                          )}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-[11px]">
              <tr>
                <td className="py-1.5 pr-3 text-white/50 font-medium">RC Scale</td>
                {selectedSkus.map((sku) => (
                  <td key={sku.id} className="py-1.5 px-3 font-semibold text-white">
                    {sku.scale} Scale
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-3 text-white/50 font-medium">Drivetrain</td>
                {selectedSkus.map((sku) => (
                  <td key={sku.id} className="py-1.5 px-3 font-semibold text-white">
                    {extractDrivetrain(sku)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-3 text-white/50 font-medium">Speed / Drive</td>
                {selectedSkus.map((sku) => (
                  <td key={sku.id} className="py-1.5 px-3 text-white/90">
                    {extractSpeed(sku)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-3 text-white/50 font-medium">Battery Runtime</td>
                {selectedSkus.map((sku) => (
                  <td key={sku.id} className="py-1.5 px-3 text-white/90">
                    {extractRuntime(sku)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 pr-3 text-white/50 font-medium">Best For</td>
                {selectedSkus.map((sku) => {
                  const tags = getSkuUseCases(sku);
                  return (
                    <td key={sku.id} className="py-1.5 px-3">
                      <div className="flex flex-wrap gap-1">
                        {tags.map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 rounded bg-white/10 text-white/85 text-[10px] font-medium"
                          >
                            {USE_CASE_LABELS[t]}
                          </span>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default QuickCompareDrawer;

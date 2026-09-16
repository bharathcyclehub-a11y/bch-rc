"use client";

/**
 * Revenue-over-time line chart (Shopify-style): green line, gradient area fill,
 * hover/touch tooltip, and a Revenue / Orders / Customers metric toggle.
 *
 * Pure inline SVG — the repo has no chart dependency and the admin bundle
 * shouldn't grow one. The viewBox scales to any width (`preserveAspectRatio
 *="none"`) while `vectorEffect="non-scaling-stroke"` keeps the line 2px at
 * every breakpoint, so it's responsive with zero horizontal overflow.
 */

import { useMemo, useState } from "react";
import { formatINR } from "@/lib/utils";

export type ChartPoint = {
  label: string; // "07 Jul"
  revenue: number;
  orders: number;
  customers: number;
};

type Metric = "revenue" | "orders" | "customers";

const METRICS: { key: Metric; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "orders", label: "Orders" },
  { key: "customers", label: "New profiles" },
];

const W = 800;
const H = 240;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 24;

function niceCeil(n: number): number {
  if (n <= 5) return 5;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.ceil(n / mag) * mag;
}

export default function RevenueChart({ points }: { points: ChartPoint[] }) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const [hover, setHover] = useState<number | null>(null);

  const values = useMemo(() => points.map((p) => p[metric]), [points, metric]);
  const total = values.reduce((a, b) => a + b, 0);
  const max = niceCeil(Math.max(1, ...values));

  const n = points.length;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const x = (i: number) => PAD_L + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD_T + innerH - (v / max) * innerH;

  const line = points.map((_, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(values[i])}`).join(" ");
  const area = `${line} L${x(n - 1)},${PAD_T + innerH} L${x(0)},${PAD_T + innerH} Z`;

  const fmt = (v: number) => (metric === "revenue" ? formatINR(v) : v.toLocaleString("en-IN"));

  // X labels: first, last, and ~3 evenly spaced in between.
  const labelIdx = new Set<number>([0, n - 1]);
  for (let k = 1; k <= 3; k++) labelIdx.add(Math.round((k * (n - 1)) / 4));

  // A single bucket ("Today") has no trend to draw — show the figure instead of
  // a degenerate one-point line.
  if (n < 2) {
    return (
      <div className="rounded-2xl border border-brand-line bg-white">
        <Header metric={metric} setMetric={setMetric} total={total} fmt={fmt} />
        <div className="px-5 py-10 sm:py-16 text-center">
          <div className="text-3xl font-bold tabular-nums text-brand-ink">{fmt(total)}</div>
          <p className="mt-1 text-sm text-brand-ink-soft">
            {points[0]?.label ?? "No dates selected"}. Select more dates or a smaller chart grouping to see a trend.
          </p>
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-brand-line bg-white">
        <Header metric={metric} setMetric={setMetric} total={0} fmt={fmt} />
        <p className="px-5 py-10 sm:py-16 text-center text-sm text-brand-ink-soft">
          No {metric} recorded in this period yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-brand-line bg-white overflow-hidden">
      <Header metric={metric} setMetric={setMetric} total={total} fmt={fmt} />

      <div
        className="relative px-2 pb-2 pt-4"
        tabIndex={0}
        role="group"
        aria-label="Sales chart. Use the left and right arrow keys to inspect each period."
        onFocus={() => setHover(0)}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setHover((index) => Math.max(0, Math.min(n - 1, (index ?? 0) + (event.key === "ArrowRight" ? 1 : -1))));
          }
        }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const p = (e.clientX - r.left) / r.width;
          setHover(Math.max(0, Math.min(n - 1, Math.round(p * (n - 1)))));
        }}
        onTouchMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const p = (e.touches[0].clientX - r.left) / r.width;
          setHover(Math.max(0, Math.min(n - 1, Math.round(p * (n - 1)))));
        }}
        onTouchEnd={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          preserveAspectRatio="none"
          className="block overflow-visible h-[180px] sm:h-[240px]"
          role="img"
          aria-label={`${metric} over time`}
        >
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--success)" stopOpacity="0.26" />
              <stop offset="1" stopColor="var(--success)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* gridlines */}
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={PAD_L}
              x2={W - PAD_R}
              y1={PAD_T + innerH * f}
              y2={PAD_T + innerH * f}
              stroke="var(--brand-line)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={area} fill="url(#revFill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--success)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {hover !== null && (
            <>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD_T}
                y2={PAD_T + innerH}
                stroke="var(--brand-ink-soft)"
                strokeWidth="1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={x(hover)} cy={y(values[hover])} r="4" fill="var(--success)" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>

        {/* Y max label */}
        <span className="absolute top-2 left-3 text-[10px] tabular-nums text-brand-ink-soft">
          {fmt(max)}
        </span>

        {/* Tooltip */}
        {hover !== null && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-brand-line bg-white px-2.5 py-1.5 shadow-lg"
            style={{
              left: `${Math.max(12, Math.min(88, (hover / Math.max(1, n - 1)) * 100))}%`,
              top: 4,
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-brand-ink-soft">
              {points[hover].label}
            </div>
            <div className="text-sm font-bold tabular-nums text-brand-ink">
              {fmt(values[hover])}
            </div>
          </div>
        )}

        {/* X labels */}
        <div className="mt-1 flex justify-between px-1 text-[10px] tabular-nums text-brand-ink-soft">
          {points.map((p, i) =>
            labelIdx.has(i) ? <span key={i}>{p.label}</span> : null,
          )}
        </div>
      </div>
    </div>
  );
}

function Header({
  metric,
  setMetric,
  total,
  fmt,
}: {
  metric: Metric;
  setMetric: (m: Metric) => void;
  total: number;
  fmt: (v: number) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-brand-line px-4 sm:px-5 py-3.5">
      <div>
        <h2 className="font-semibold text-brand-ink">Sales over time</h2>
        <p className="text-xs text-brand-ink-soft tabular-nums mt-0.5">
          {fmt(total)} total
        </p>
      </div>
      <div className="ml-auto flex gap-1 rounded-full bg-brand-cream p-1">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetric(m.key)}
            aria-pressed={metric === m.key}
            className={`rounded-full px-3 py-2.5 sm:py-1 text-xs font-semibold transition-colors ${
              metric === m.key
                ? "bg-brand-ink text-white"
                : "text-brand-ink-soft hover:text-brand-ink"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

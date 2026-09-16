import type { Sku } from "@/lib/products";
import { cn } from "@/lib/utils";

// Per-SKU color treatment — gives each card a distinct identity even though
// every car ships at the same 1:64 scale. Falls back to scale-based palette.
const SKU_GRADIENTS: Record<string, string> = {
  "pocket-bmw": "from-sky-100 via-blue-50 to-indigo-100",
  "pocket-porsche": "from-rose-100 via-red-50 to-amber-100",
  "pocket-thar": "from-lime-100 via-emerald-50 to-teal-100",
  "pocket-monster": "from-violet-100 via-fuchsia-50 to-orange-100",
  "pocket-f1-classic": "from-amber-100 via-yellow-50 to-orange-100",
  "pocket-f1-ferrari": "from-stone-100 via-zinc-50 to-neutral-100",
  "pocket-beetle": "from-pink-100 via-rose-50 to-fuchsia-100",
  "pocket-f1-driver": "from-red-100 via-rose-50 to-amber-100",
};

const SKU_ACCENT: Record<string, string> = {
  "pocket-bmw": "text-sky-600",
  "pocket-porsche": "text-brand-red",
  "pocket-thar": "text-emerald-700",
  "pocket-monster": "text-violet-600",
  "pocket-f1-classic": "text-amber-600",
  "pocket-f1-ferrari": "text-zinc-600",
  "pocket-beetle": "text-pink-600",
  "pocket-f1-driver": "text-brand-red",
};

const SCALE_GRADIENTS: Record<Sku["scale"], string> = {
  "1:64": "from-rose-100 via-orange-50 to-amber-100",
  "1:43": "from-red-100 via-rose-50 to-orange-100",
  "1:24": "from-slate-100 via-zinc-100 to-neutral-200",
  "1:20": "from-sky-100 via-blue-50 to-indigo-100",
  "1:18": "from-zinc-100 via-neutral-50 to-stone-100",
  "1:16": "from-zinc-100 via-neutral-50 to-stone-100",
  "1:14": "from-zinc-100 via-neutral-50 to-stone-100",
  "1:12": "from-zinc-100 via-neutral-50 to-stone-100",
  "1:10": "from-zinc-100 via-neutral-50 to-stone-100",
  "Ride-on": "from-lime-100 via-neutral-50 to-stone-100",
};

const SCALE_ACCENT: Record<Sku["scale"], string> = {
  "1:64": "text-rose-400",
  "1:43": "text-brand-red",
  "1:24": "text-slate-500",
  "1:20": "text-sky-500",
  "1:18": "text-brand-red",
  "1:16": "text-brand-red",
  "1:14": "text-brand-red",
  "1:12": "text-brand-red",
  "1:10": "text-brand-red",
  "Ride-on": "text-brand-red",
};

export function ProductPlaceholder({
  sku,
  className,
  showLabel = true,
}: {
  sku: Sku;
  className?: string;
  showLabel?: boolean;
}) {
  // Per-sku color wins over scale-based default so each card has its own identity.
  const gradient = SKU_GRADIENTS[sku.id] ?? SCALE_GRADIENTS[sku.scale];
  const accent = SKU_ACCENT[sku.id] ?? SCALE_ACCENT[sku.scale];

  return (
    <div
      className={cn(
        "relative w-full h-full bg-gradient-to-br",
        gradient,
        "flex items-center justify-center overflow-hidden",
        className
      )}
      aria-label={`${sku.name} (${sku.scale}) — image coming soon`}
    >
      <svg
        viewBox="0 0 200 100"
        className={cn("w-3/4 max-w-[260px]", accent)}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M14 70c0-3 2-5 5-5h10l5-12c2-5 7-8 12-8h70c5 0 10 3 12 8l5 12h10c3 0 5 2 5 5v8c0 2-1 3-3 3h-12a14 14 0 0 1-28 0H59a14 14 0 0 1-28 0H17c-2 0-3-1-3-3v-8z" />
        <circle cx="45" cy="76" r="9" fill="#0a0a0a" />
        <circle cx="45" cy="76" r="3.5" fill="currentColor" />
        <circle cx="145" cy="76" r="9" fill="#0a0a0a" />
        <circle cx="145" cy="76" r="3.5" fill="currentColor" />
        <path
          d="M52 50c1-3 4-5 7-5h62c3 0 6 2 7 5l4 10H48l4-10z"
          fill="#0a0a0a"
          opacity="0.6"
        />
      </svg>

      {showLabel && (
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-brand-ink/60">
            {sku.scale}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-ink/60">
            {sku.name}
          </span>
        </div>
      )}
    </div>
  );
}

export function SectionPlaceholder({
  label,
  tone = "cream",
  className,
}: {
  label: string;
  tone?: "cream" | "dark" | "rose";
  className?: string;
}) {
  const tones: Record<string, string> = {
    cream:
      "bg-gradient-to-br from-brand-cream via-amber-50 to-rose-50 text-brand-ink/50",
    dark: "bg-gradient-to-br from-brand-ink via-zinc-900 to-black text-white/40",
    rose: "bg-gradient-to-br from-rose-100 via-orange-50 to-amber-50 text-brand-ink/50",
  };
  return (
    <div
      className={cn(
        "relative w-full h-full flex items-center justify-center overflow-hidden",
        tones[tone],
        className
      )}
      aria-label={label}
    >
      <svg
        viewBox="0 0 100 100"
        className="w-16 h-16 opacity-40"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="50" cy="40" r="14" />
        <path d="M20 80c4-12 16-20 30-20s26 8 30 20" strokeLinecap="round" />
      </svg>
      <span className="absolute bottom-3 left-3 right-3 text-center text-[10px] font-mono uppercase tracking-widest opacity-50">
        {label}
      </span>
    </div>
  );
}

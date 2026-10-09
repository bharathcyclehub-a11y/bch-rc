/**
 * Small shared pieces for the customer Support Centre. No hooks and no
 * server-only imports, so both server pages and client components use them.
 */

import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/Skeleton";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { waLink } from "@/lib/config";

export const SUPPORT_HOURS = "10 AM – 8 PM IST";
export const REPLY_PROMISE = "replies within 4 hours";

/* ── Buttons (all ≥ 48 px tall) ───────────────────────────────────────── */

const btnBase =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red";
export const btnPrimary = `${btnBase} bg-brand-red text-white hover:bg-brand-red-hover`;
export const btnDark = `${btnBase} bg-brand-ink text-white hover:bg-brand-ink-soft`;
export const btnOutline = `${btnBase} border border-neutral-300 bg-white text-brand-ink hover:bg-neutral-50`;
export const btnWhatsApp = `${btnBase} rounded-full border border-tone-pos/30 bg-tone-pos-bg text-tone-pos hover:bg-tone-pos/10`;

export const inputClass =
  "w-full min-h-12 rounded-xl border-2 border-brand-line bg-white px-4 py-3 text-base text-brand-ink placeholder:text-brand-ink-soft/50 focus:border-brand-red focus:outline-none";

export const cardClass = "rounded-2xl border border-brand-line bg-white p-4 sm:p-6";

/* ── Text ─────────────────────────────────────────────────────────────── */

export function Eyebrow({ children, as: Tag = "p", id }: { children: React.ReactNode; as?: "p" | "h2"; id?: string }) {
  return (
    <Tag id={id} className="text-xs font-mono font-bold uppercase tracking-widest text-brand-red">
      {children}
    </Tag>
  );
}

/* ── Dates (always IST) ───────────────────────────────────────────────── */

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
}

/* ── Notices (icon + colour, never colour alone) ──────────────────────── */

type Tone = "info" | "success" | "warn" | "error";

const TONE: Record<Tone, { box: string; icon: typeof Info }> = {
  info: { box: "border-tone-info/30 bg-tone-info-bg text-tone-info", icon: Info },
  success: { box: "border-tone-pos/30 bg-tone-pos-bg text-tone-pos", icon: CheckCircle2 },
  warn: { box: "border-tone-warn/30 bg-tone-warn-bg text-tone-warn", icon: AlertTriangle },
  error: { box: "border-tone-neg/30 bg-tone-neg-bg text-tone-neg", icon: ShieldAlert },
};

export function Notice({
  tone = "info",
  title,
  children,
  role,
  className = "",
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  role?: "alert" | "status";
  className?: string;
}) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <div role={role} className={`flex items-start gap-2.5 rounded-xl border p-3 sm:p-4 text-sm ${t.box} ${className}`}>
      <Icon size={18} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-1 leading-relaxed">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className="text-brand-ink">{children}</div>}
      </div>
    </div>
  );
}

/* ── Ticket status pill ───────────────────────────────────────────────── */

const STATUS_TONE: Record<string, string> = {
  NEW: "bg-tone-info-bg text-tone-info border-tone-info/30",
  OPEN: "bg-tone-info-bg text-tone-info border-tone-info/30",
  ASSIGNED: "bg-tone-info-bg text-tone-info border-tone-info/30",
  IN_PROGRESS: "bg-tone-info-bg text-tone-info border-tone-info/30",
  REOPENED: "bg-tone-info-bg text-tone-info border-tone-info/30",
  ESCALATED: "bg-tone-warn-bg text-tone-warn border-tone-warn/30",
  AWAITING_CUSTOMER: "bg-tone-warn-bg text-tone-warn border-tone-warn/30",
  RESOLUTION_PROPOSED: "bg-tone-warn-bg text-tone-warn border-tone-warn/30",
  RESOLVED: "bg-tone-pos-bg text-tone-pos border-tone-pos/30",
  CLOSED: "bg-tone-neutral-bg text-tone-neutral border-tone-neutral/30",
};

export function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        STATUS_TONE[status] ?? STATUS_TONE.CLOSED
      }`}
    >
      {label}
    </span>
  );
}

/* ── Support hours + WhatsApp ─────────────────────────────────────────── */

export function WhatsAppButton({ message, label = "WhatsApp us", className = "" }: { message?: string; label?: string; className?: string }) {
  return (
    <a href={waLink(message)} target="_blank" rel="noopener" className={`${btnWhatsApp} ${className}`}>
      <WhatsAppIcon size={18} aria-hidden />
      {label}
      <span className="sr-only">(opens WhatsApp)</span>
    </a>
  );
}

/* ── Loading skeleton used by the route loading.tsx files ─────────────── */

export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-2xl border border-brand-line p-4 sm:p-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ))}
    </div>
  );
}

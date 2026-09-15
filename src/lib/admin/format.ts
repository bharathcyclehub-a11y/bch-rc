/**
 * Admin display formatting. Everything renders in IST (see formatIST) with
 * Indian grouping, so server and client produce the same strings.
 */

import { formatIST } from "@/lib/utils";

/**
 * Request-time clock for server components ("3 days ago" labels). A server
 * component renders once per request, so reading the clock there is safe; the
 * named helper keeps react-hooks/purity from treating it as a render effect.
 */
export function requestTime(): number {
  return Date.now();
}

const DAY_MS = 86_400_000;

/** ICU's en-IN short month for September is "Sept"; the design system uses "Sep". */
const sep = (s: string) => s.replace(/\bSept\b/g, "Sep");
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Calendar day number in IST — for "today"/"yesterday" comparisons. */
function istDay(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
}

/** Last 10 digits of an Indian mobile, or null when the stored value isn't one. */
export function mobile10(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** wa.me chat link (India +91), or null when the number is unusable. */
export function whatsappHref(phone: string | null | undefined): string | null {
  const ten = mobile10(phone);
  return ten ? `https://wa.me/91${ten}` : null;
}

/** tel: link (India +91), or null when the number is unusable. */
export function telHref(phone: string | null | undefined): string | null {
  const ten = mobile10(phone);
  return ten ? `tel:+91${ten}` : null;
}

/** "98201 44102" for Indian mobiles; anything else is returned as stored. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? `${ten.slice(0, 5)} ${ten.slice(5)}` : raw;
}

/** "14 Sep, 12:08 pm" */
export function formatDateTimeShort(value: Date | string | number): string {
  return sep(formatIST(value, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }));
}

/** "14 Sep" (adds the year when it isn't the current IST year). */
export function formatDateShort(value: Date | string | number, now: number): string {
  const d = new Date(value);
  const sameYear =
    formatIST(d, { year: "numeric" }) === formatIST(now, { year: "numeric" });
  return sep(formatIST(d, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }));
}

/** "Feb 2024" */
export function formatMonthYear(value: Date | string | number): string {
  return sep(formatIST(value, { month: "short", year: "numeric" }));
}

/**
 * Operator-friendly relative time: "Just now", "5 min ago", "3 h ago",
 * "Yesterday", "4 days ago", then a short date past 30 days.
 */
export function formatRelative(value: Date | string | number, now: number): string {
  const ms = new Date(value).getTime();
  const diff = now - ms;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const days = istDay(now) - istDay(ms);
  if (days <= 0) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDateShort(ms, now);
}

export function discountPct(mrp: number, price: number): number {
  return mrp > price && mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0;
}

export function initialsOf(name: string | null | undefined, fallback = "?"): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}

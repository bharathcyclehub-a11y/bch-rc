/**
 * Hand-off from the support menu (chat) and help guides to the ticket form,
 * through sessionStorage key "prc-support-prefill" (same tab only). The form
 * reads it once and removes it. Browser-only helpers; every access is guarded
 * because storage can be blocked (private mode, disabled site data).
 */

export const PREFILL_KEY = "prc-support-prefill";

export type SupportPrefill = {
  /** Starting text for the description (≤ 1000 chars). */
  text: string;
  /** Suggested ticket category (validated by the form). */
  category?: string;
  source: "chat" | "guide";
  /** Extra context for staff (chat transcript, steps tried). */
  context?: Record<string, unknown>;
};

export function writePrefill(p: SupportPrefill): void {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(p));
  } catch {
    /* storage blocked — the form simply starts empty */
  }
}

export function peekPrefill(): string | null {
  try {
    return sessionStorage.getItem(PREFILL_KEY);
  } catch {
    return null;
  }
}

export function clearPrefill(): void {
  try {
    sessionStorage.removeItem(PREFILL_KEY);
  } catch {
    /* ignore */
  }
}

export function parsePrefill(raw: string): SupportPrefill | null {
  try {
    const v = JSON.parse(raw) as Partial<SupportPrefill> | string;
    if (typeof v === "string") return { text: v, source: "chat" };
    if (!v || typeof v.text !== "string") return null;
    return {
      text: v.text,
      category: typeof v.category === "string" ? v.category : undefined,
      source: v.source === "guide" ? "guide" : "chat",
      context: v.context && typeof v.context === "object" ? v.context : undefined,
    };
  } catch {
    return raw.trim() ? { text: raw, source: "chat" } : null;
  }
}

/**
 * Analytics guardrails — pure helpers that keep impossible business numbers off
 * the screen. A dashboard that shows "120% conversion" or a negative drop-off
 * destroys trust faster than a missing number; these functions make the failure
 * mode "a small warning" instead of "a corrupt metric".
 *
 * Dependency-free so it's unit-testable in isolation (see
 * scripts/verify-analytics-math.ts).
 */

/** A finite, non-NaN number, else 0. Guards every division result. */
export function finiteOr0(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

/**
 * Percentage that never divides by zero and never returns NaN/Infinity.
 * Returns 0 when the denominator is ≤ 0. NOT clamped — callers that render a
 * bar/label should also clampPct() so a tracking undercount can't paint > 100%.
 */
export function safePct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return finiteOr0((numerator / denominator) * 100);
}

/** Clamp a percentage into the sane [0, 100] range for display. */
export function clampPct(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, x));
}

/** A funnel-ish stage: a label and the count of people who reached it. */
export type StageCount = { label: string; visitors: number };

/**
 * Detect impossible funnel states: a stage that has MORE people than the stage
 * before it. In a true funnel this cannot happen; when it does it means the two
 * stages are measured from different sources (e.g. cookie-based visitor counts
 * up top vs the exact orders ledger at the bottom) and upstream tracking
 * undercounted. Returns human-readable anomaly strings (empty = healthy) so the
 * UI can show a "tracking gap" note instead of a bar that overflows past 100%.
 */
export function detectFunnelAnomalies(stages: StageCount[]): string[] {
  const anomalies: string[] = [];
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1];
    const cur = stages[i];
    if (cur.visitors > prev.visitors) {
      anomalies.push(
        `“${cur.label}” (${cur.visitors.toLocaleString("en-IN")}) exceeds “${prev.label}” (${prev.visitors.toLocaleString("en-IN")}). ` +
          `Stage reach is counted independently: visitors can skip steps, browser events may be missing, and buyers use a different identity from visitors. These totals do not measure a linked sequence of people.`,
      );
    }
  }
  return anomalies;
}

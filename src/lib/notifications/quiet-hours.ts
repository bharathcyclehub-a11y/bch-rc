/**
 * IST quiet hours for customer notices. Pure (no DB) so it is unit-testable.
 */

import { IST_OFFSET_MS } from "@/lib/tz";

export type QuietHours = { startHour: number; endHour: number } | null;

/** When a notice raised at `now` may go out: now, or the end of the window. */
export function noticeSendAt(now: Date, quiet: QuietHours): Date {
  if (!quiet || quiet.startHour === quiet.endHour) return now;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const h = ist.getUTCHours();
  const inQuiet =
    quiet.startHour > quiet.endHour
      ? h >= quiet.startHour || h < quiet.endHour
      : h >= quiet.startHour && h < quiet.endHour;
  if (!inQuiet) return now;
  const release = new Date(ist);
  release.setUTCHours(quiet.endHour, 0, 0, 0);
  if (release.getTime() <= ist.getTime()) release.setUTCDate(release.getUTCDate() + 1);
  return new Date(release.getTime() - IST_OFFSET_MS);
}

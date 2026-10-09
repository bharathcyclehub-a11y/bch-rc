/**
 * app_settings — small admin-editable configuration values (tracking
 * thresholds, support policy, notification toggles) and operational state
 * (the courier-API circuit breaker). One JSON value per key.
 *
 * Reads are cached in-process for 30 s; writes invalidate. Reads never throw:
 * if the table is missing (migration not yet applied) or the DB hiccups,
 * callers get null and fall back to code defaults.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { logWarn } from "@/lib/logger";

const TTL_MS = 30_000;
const cache = new Map<string, { value: unknown; at: number }>();

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T | null;
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key));
    const value = (row?.value ?? null) as T | null;
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch (err) {
    logWarn("settings:get", err instanceof Error ? err.message : String(err), { key });
    return null;
  }
}

export async function setSetting(key: string, value: unknown, updatedBy: string | null): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy, updatedAt: sql`now()` },
    });
  cache.delete(key);
}

export function invalidateSettingsCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

/**
 * Per-provider circuit breaker. When a courier API refuses us outright
 * (401 / 403 / 429 — auth, IP block, rate limit) we stop calling THAT provider
 * for a while instead of retrying into the block: the Sep-2026 Shiprocket IP
 * block came from retrying a refusing provider every few minutes.
 *
 * One breaker per provider, so a bad Delhivery token never pauses Shiprocket
 * tracking (and vice versa). Shiprocket keeps the original settings key, so a
 * breaker open at deploy time is honoured. Routing treats an open breaker as
 * "provider unhealthy".
 */

import { getSetting, setSetting } from "@/lib/settings";
import { alertOps } from "@/lib/alert";
import { DelhiveryApiError } from "./delhivery";
import { ShiprocketApiError } from "@/lib/shiprocket";
import type { CourierProvider } from "./types";

export type Circuit = { openUntil: string; reason: string; openedAt: string };

const KEY: Record<CourierProvider, string> = {
  shiprocket: "tracking.circuit",
  delhivery: "tracking.circuit.delhivery",
};

export async function circuitState(now: Date, provider: CourierProvider = "shiprocket"): Promise<Circuit | null> {
  const c = await getSetting<Circuit>(KEY[provider]);
  return c && new Date(c.openUntil) > now ? c : null;
}

export async function openCircuit(now: Date, minutes: number, reason: string, provider: CourierProvider = "shiprocket"): Promise<void> {
  const until = new Date(now.getTime() + minutes * 60_000);
  await setSetting(KEY[provider], { openUntil: until.toISOString(), reason, openedAt: now.toISOString() }, "system");
  await alertOps({
    scope: "tracking",
    message: `${provider === "delhivery" ? "Delhivery" : "Shiprocket"} calls paused for ${minutes} min: ${reason}`,
    context: { provider, until: until.toISOString() },
  });
}

/** The courier refused us outright (auth / IP block / rate limit). */
export function isCourierRefusal(err: unknown): boolean {
  if (err instanceof ShiprocketApiError) return err.isAuth || err.status === 401 || err.status === 403 || err.status === 429;
  if (err instanceof DelhiveryApiError) return err.status === 401 || err.status === 403 || err.status === 429;
  return false;
}

/** Strip credentials from an error message before it is stored or shown. */
export function redactCourierError(msg: string): string {
  return msg
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
    .replace(/Token\s+[A-Za-z0-9._-]+/g, "Token ***")
    .slice(0, 300);
}

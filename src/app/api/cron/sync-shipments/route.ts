/**
 * /api/cron/sync-shipments — the tracking reconciliation worker's trigger.
 *
 * Called every 15 minutes by the VPS cron (deploy/vps/remote-deploy.sh) and by
 * vercel.json while that host is live. Each run (src/lib/tracking/sync.ts):
 *   - creates tracking rows for in-flight orders that lack one,
 *   - retries courier webhooks whose processing failed,
 *   - polls only the shipments that are DUE (per-status intervals from
 *     tracking config; failures back off; a courier refusal pauses all polls),
 *   - re-evaluates delivery exceptions for every active shipment,
 *   - drains the notifications outbox.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`, required — the run makes
 * courier API calls, so it must never be open to the internet.
 *
 * ?backfill=1 runs a full sync WITHOUT customer notifications, for catching up
 * on a backlog (e.g. right after this worker is first deployed).
 */

import { NextResponse } from "next/server";
import { runTrackingSync } from "@/lib/tracking/sync";
import { drainNotificationsOutbox } from "@/lib/notifications/drain";
import { runSupportMaintenance } from "@/lib/support/tickets";
import { purgeOldVerifications } from "@/lib/support/verify";
import { logError } from "@/lib/logger";

export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const backfill = new URL(req.url).searchParams.get("backfill") === "1";

  let tracking;
  try {
    tracking = await runTrackingSync({ trigger: "CRON", notify: !backfill });
  } catch (err) {
    logError("cron:sync-shipments", err);
    return NextResponse.json({ ok: false, error: "tracking sync failed" }, { status: 500 });
  }

  // Support housekeeping: auto-close resolved tickets after the reopen
  // window, drop expired verification codes. Never blocks tracking.
  let support: { autoClosed: number } | { error: string } = { autoClosed: 0 };
  try {
    support = await runSupportMaintenance();
    await purgeOldVerifications();
  } catch (err) {
    logError("cron:support-maintenance", err);
    support = { error: "support maintenance failed" };
  }

  let notifications = { drained: 0, sent: 0, failed: 0, exhausted: 0 };
  try {
    notifications = await drainNotificationsOutbox(200);
  } catch (err) {
    logError("cron:drain-outbox", err);
  }

  return NextResponse.json({ ok: true, backfill, tracking, support, notifications });
}

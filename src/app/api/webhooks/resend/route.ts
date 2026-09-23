/**
 * POST /api/webhooks/resend
 *
 * Receives Resend email delivery events and records the REAL outcome on the
 * matching notifications_outbox row, so we know whether a confirmation
 * actually reached the customer (not just that we handed it to Resend).
 *
 * On a bounce/complaint the customer never got the email → we fire an ops
 * alert with their phone number so the team follows up by WhatsApp/call.
 *
 * Security: Resend signs webhooks with Svix. We verify the signature using
 * RESEND_WEBHOOK_SECRET (the "whsec_..." value from the Resend dashboard).
 *
 * Events handled (Resend `type`):
 *   email.sent            → sent
 *   email.delivered       → delivered
 *   email.delivery_delayed→ delayed
 *   email.bounced         → bounced   (+ ops alert)
 *   email.complained      → complained(+ ops alert)
 */

import { NextResponse, after } from "next/server";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationsOutbox, events } from "@/db/schema";
import { alertOpsEmailBounce } from "@/lib/notifications/notify-seller";
import { logError } from "@/lib/logger";
import { envStr } from "@/lib/env";

const STATUS_MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

/**
 * Verify a Svix-signed webhook. Header `svix-signature` is space-separated
 * `v1,<base64sig>` entries; we recompute HMAC-SHA256 over
 * `${id}.${timestamp}.${body}` with the base64-decoded secret and constant-
 * time compare against any provided signature.
 */
function verifySvix(
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !timestamp || !sigHeader) return false;

  // Reject stale deliveries (>5 min) to blunt replay.
  const tsMs = Number(timestamp) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
    return false;
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(signed)
    .digest("base64");

  for (const part of sigHeader.split(" ")) {
    const sig = part.split(",")[1];
    if (!sig) continue;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const secret = envStr("RESEND_WEBHOOK_SECRET");

  if (!secret) {
    // Not configured yet — accept-and-ignore so Resend's setup test passes,
    // but record nothing. Once the secret is set, verification kicks in.
    return NextResponse.json({ ok: true, note: "secret not set" });
  }
  if (!verifySvix(rawBody, req.headers, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: {
    type?: string;
    data?: { email_id?: string; to?: string[] | string };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const status = event.type ? STATUS_MAP[event.type] : undefined;
  const emailId = event.data?.email_id;
  if (!status || !emailId) {
    return NextResponse.json({ ok: true, note: "ignored" });
  }

  try {
    const [row] = await db
      .update(notificationsOutbox)
      .set({ deliveryStatus: status, deliveryStatusAt: new Date() })
      .where(eq(notificationsOutbox.providerId, emailId))
      .returning({
        id: notificationsOutbox.id,
        orderId: notificationsOutbox.orderId,
        siteId: notificationsOutbox.siteId,
        customerId: notificationsOutbox.customerId,
      });

    // Bounce / spam-complaint = customer never got it. Log + alert ops.
    if (row && (status === "bounced" || status === "complained")) {
      if (row.orderId) {
        await db
          .insert(events)
          .values({
            siteId: row.siteId,
            orderId: row.orderId,
            customerId: row.customerId,
            type: "EMAIL_BOUNCED",
            payload: { status, providerId: emailId },
            source: "webhook",
          })
          .catch(() => {});
        after(() =>
          alertOpsEmailBounce(row.orderId!, status).catch(() => {}),
        );
      }
    }
  } catch (err) {
    logError("webhooks:resend", err, { emailId, status });
    // Still 200 so Resend doesn't hammer retries; we logged it.
  }

  return NextResponse.json({ ok: true });
}

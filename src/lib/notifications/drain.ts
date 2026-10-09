/**
 * Outbox drainer — exactly-once delivery under concurrency.
 *
 * Rows are CLAIMED before sending: a batch is selected `FOR UPDATE SKIP LOCKED`
 * and its `next_attempt_at` is leased 3 minutes into the future in the same
 * statement. So overlapping cron runs (and the inline send) can never grab the
 * same row, and a crash mid-send just means the lease expires and the row is
 * retried later. As a final backstop the row's `dedup_key` is sent to the email
 * provider as an Idempotency-Key, so even a double dispatch is collapsed.
 */

import { and, lte, isNull, sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationsOutbox, events } from "@/db/schema";
import { sendEmail } from "./send-email";
import { sendWhatsApp } from "./send-whatsapp";
import {
  renderTemplate,
  renderWhatsApp,
  type EmailPayload,
  type NotificationTemplate,
} from "./templates";
import { logError } from "@/lib/logger";

const DEFAULT_BATCH = 50;
const MAX_ATTEMPTS = 10;
/** How far ahead a claimed row's next attempt is pushed while it's in flight. */
const LEASE_INTERVAL = "3 minutes";

/**
 * Render + transport a single outbox row by its channel. The outbox/retry
 * bookkeeping is identical across channels — only this dispatch differs.
 */
async function dispatchRow(
  channel: string,
  template: NotificationTemplate,
  payload: EmailPayload,
  dedupKey: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    // Customer notices (customer-notice.ts) arrive pre-rendered.
    if ((template as string) === "CUSTOMER_NOTICE") {
      const n = payload as unknown as { to: string; toPhone: string | null; subject: string; html: string; text: string; whatsapp: string };
      if (channel === "whatsapp") return await sendWhatsApp({ toPhone: n.toPhone ?? "", text: n.whatsapp });
      return await sendEmail({
        to: n.to,
        subject: n.subject,
        html: n.html,
        text: n.text,
        idempotencyKey: dedupKey ?? undefined,
      });
    }
    if (channel === "whatsapp") {
      const { text } = renderWhatsApp(template, payload);
      return await sendWhatsApp({ toPhone: payload.toPhone ?? "", text });
    }
    const rendered = renderTemplate(template, payload);

    // Attach the GST invoice PDF to the DELIVERED email, generated from the
    // computed invoice carried in the payload. Done at send-time (not enqueue)
    // so it survives retries and never bloats the outbox row. If PDF generation
    // throws, the email still goes out without the attachment rather than
    // failing the whole notification.
    let attachments: Array<{ filename: string; content: string }> | undefined;
    if (template === "DELIVERED" && payload.invoice && !payload.invoice.isDraft) {
      try {
        const { renderInvoicePdfBase64 } = await import("@/lib/invoice-pdf");
        const content = await renderInvoicePdfBase64(payload.invoice, {
          name: payload.customerName,
          address: payload.shippingAddress,
        });
        const num = payload.invoice.invoiceNumber ?? payload.orderId;
        attachments = [
          { filename: `Invoice-${num.replace(/[^A-Za-z0-9_-]/g, "")}.pdf`, content },
        ];
      } catch (err) {
        logError("notifications:invoice-pdf", err, { orderId: payload.orderId });
      }
    }

    return await sendEmail({
      to: payload.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: dedupKey ?? undefined,
      attachments,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function nextDelaySeconds(attempt: number): number {
  if (attempt <= 1) return 60;
  if (attempt === 2) return 300;
  return 1800;
}

type ClaimedRow = {
  id: string;
  site_id: string | null;
  order_id: string | null;
  customer_id: string | null;
  channel: string;
  template: string;
  dedup_key: string | null;
  payload: EmailPayload;
  attempts: number;
};

async function settle(
  row: ClaimedRow,
  result: { ok: true; id: string } | { ok: false; error: string },
): Promise<"sent" | "failed" | "exhausted"> {
  if (result.ok) {
    // Store the provider message id so the Resend webhook can match delivery
    // events back to this row. delivery_status='sent' = handed to provider;
    // the webhook later upgrades it to delivered / bounced / complained.
    await db
      .update(notificationsOutbox)
      .set({
        sentAt: new Date(),
        lastError: null,
        providerId: result.id,
        deliveryStatus: "sent",
        deliveryStatusAt: new Date(),
      })
      .where(eq(notificationsOutbox.id, row.id));
    return "sent";
  }

  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db
      .update(notificationsOutbox)
      .set({
        attempts,
        lastError: result.error.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + 24 * 3600 * 1000),
      })
      .where(eq(notificationsOutbox.id, row.id));
    if (row.order_id) {
      await db
        .insert(events)
        .values({
          siteId: row.site_id,
          orderId: row.order_id,
          customerId: row.customer_id,
          type: "NOTIFICATION_EXHAUSTED",
          payload: { template: row.template, channel: row.channel, error: result.error.slice(0, 500) },
          source: "system",
        })
        .catch(() => {});
    }
    return "exhausted";
  }

  await db
    .update(notificationsOutbox)
    .set({
      attempts,
      lastError: result.error.slice(0, 500),
      nextAttemptAt: new Date(Date.now() + nextDelaySeconds(attempts) * 1000),
    })
    .where(eq(notificationsOutbox.id, row.id));
  logError("notifications:drain", new Error(result.error), {
    notificationId: row.id,
    template: row.template,
    attempts,
  });
  return "failed";
}

export async function drainNotificationsOutbox(
  batchSize: number = DEFAULT_BATCH,
): Promise<{ drained: number; sent: number; failed: number; exhausted: number }> {
  // Claim a batch atomically: SKIP LOCKED so parallel drains never overlap,
  // and lease each row forward so the inline path won't re-grab it either.
  const claimed = await db.execute<ClaimedRow>(sql`
    WITH due AS (
      SELECT id FROM notifications_outbox
      WHERE sent_at IS NULL AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notifications_outbox n
      SET next_attempt_at = now() + interval '${sql.raw(LEASE_INTERVAL)}'
      FROM due WHERE n.id = due.id
      RETURNING n.id, n.site_id, n.order_id, n.customer_id, n.channel,
                n.template, n.dedup_key, n.payload, n.attempts
  `);

  const rows = (claimed as unknown as ClaimedRow[]) ?? [];
  if (rows.length === 0) return { drained: 0, sent: 0, failed: 0, exhausted: 0 };

  let sent = 0;
  let failed = 0;
  let exhausted = 0;

  for (const row of rows) {
    const result = await dispatchRow(
      row.channel,
      row.template as NotificationTemplate,
      row.payload as EmailPayload,
      row.dedup_key,
    );
    const outcome = await settle(row, result);
    if (outcome === "sent") sent++;
    else if (outcome === "exhausted") exhausted++;
    else failed++;
  }

  return { drained: rows.length, sent, failed, exhausted };
}

/**
 * Best-effort inline send. Called right after an outbox row is enqueued.
 * Claims the row with the same lease-in-WHERE as the cron, so an inline send
 * and a concurrent cron drain can never both dispatch the same row.
 */
export async function sendOutboxRow(rowId: string): Promise<boolean> {
  // Atomic claim: only succeeds if still unsent AND due. Pushes the lease out
  // so the cron won't double-send. If 0 rows, someone else owns it → no-op.
  const claimed = await db
    .update(notificationsOutbox)
    .set({ nextAttemptAt: sql`now() + interval '${sql.raw(LEASE_INTERVAL)}'` })
    .where(
      and(
        eq(notificationsOutbox.id, rowId),
        isNull(notificationsOutbox.sentAt),
        lte(notificationsOutbox.nextAttemptAt, new Date()),
      ),
    )
    .returning({
      id: notificationsOutbox.id,
      siteId: notificationsOutbox.siteId,
      orderId: notificationsOutbox.orderId,
      customerId: notificationsOutbox.customerId,
      channel: notificationsOutbox.channel,
      template: notificationsOutbox.template,
      dedupKey: notificationsOutbox.dedupKey,
      payload: notificationsOutbox.payload,
      attempts: notificationsOutbox.attempts,
    });

  if (claimed.length === 0) return true; // already sent or owned by the cron

  const c = claimed[0];
  const row: ClaimedRow = {
    id: c.id,
    site_id: c.siteId,
    order_id: c.orderId,
    customer_id: c.customerId,
    channel: c.channel,
    template: c.template,
    dedup_key: c.dedupKey,
    payload: c.payload as EmailPayload,
    attempts: c.attempts,
  };

  const result = await dispatchRow(
    row.channel,
    row.template as NotificationTemplate,
    row.payload,
    row.dedup_key,
  );
  const outcome = await settle(row, result);
  return outcome === "sent";
}

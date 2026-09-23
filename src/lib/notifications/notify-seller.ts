/**
 * Seller / ops order alerts — fire the moment a paid order lands so the team
 * knows immediately and can pack + ship fast. This is SEPARATE from the
 * customer-facing confirmation: it goes to YOU, not the buyer.
 *
 * Channels (best-effort, never throws — must not break the webhook):
 *   • Email  — via Resend (already live). Recipients: ORDER_ALERT_EMAILS
 *              (comma-separated). This is the reliable default.
 *   • WhatsApp — via the Meta Cloud API IF WHATSAPP_ENABLED + WHATSAPP_API_*
 *              are set. Recipients: ORDER_ALERT_PHONES (comma-separated).
 *              NOTE: Meta only allows free-form text inside a 24h window or
 *              requires an approved template for business-initiated messages,
 *              so this lights up once that's configured.
 *
 * Trigger: called from the Razorpay payment.captured webhook — the single
 * choke point where both full-prepaid and partial-prepaid COD orders confirm.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, customers } from "@/db/schema";
import { sendEmail } from "./send-email";
import { sendWhatsApp } from "./send-whatsapp";
import { whatsappEnabled } from "./notify";
import { logError } from "@/lib/logger";
import { envStr, sanitizeEnvValue } from "@/lib/env";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://pocketrccars.com";

function recipients(envKey: string): string[] {
  return envStr(envKey)
    .split(",")
    .map((s) => sanitizeEnvValue(s))
    .filter(Boolean);
}

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

/**
 * Alert ops when a customer confirmation email bounced / was marked spam.
 * The customer never got it, so the team must reach them another way — this
 * surfaces the phone number prominently so they can WhatsApp/call.
 */
export async function alertOpsEmailBounce(
  orderId: string,
  status: string,
): Promise<void> {
  try {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return;
    const addr = (order.shippingAddress ?? {}) as {
      fullName?: string;
      phone?: string;
      email?: string;
    };
    const name = addr.fullName || "Customer";
    const phone = addr.phone || "—";
    const orderUrl = `${SITE_URL}/orders/${order.id}`;

    const subject = `⚠️ Email ${status} — follow up ${order.id} by phone`;
    const text = [
      `A confirmation email did not reach the customer (${status}).`,
      `Reach them another way — WhatsApp or call.`,
      ``,
      `Order:    ${order.id}`,
      `Customer: ${name}`,
      `Phone:    ${phone}`,
      `Email:    ${addr.email ?? "—"} (${status})`,
      `Total:    ${inr(order.totalInr)}`,
      ``,
      `Send them this link: ${orderUrl}`,
    ].join("\n");
    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:480px">
        <h2 style="margin:0 0 4px;color:#dc2626">⚠️ Confirmation email ${status}</h2>
        <p style="margin:0 0 12px;color:#555">Customer didn't get it — follow up by phone/WhatsApp.</p>
        <table style="font-size:14px">
          <tr><td style="color:#888;padding:3px 8px 3px 0">Order</td><td>${order.id}</td></tr>
          <tr><td style="color:#888;padding:3px 8px 3px 0">Customer</td><td>${name}</td></tr>
          <tr><td style="color:#888;padding:3px 8px 3px 0">Phone</td><td><strong>${phone}</strong></td></tr>
          <tr><td style="color:#888;padding:3px 8px 3px 0">Email</td><td>${addr.email ?? "—"} (${status})</td></tr>
        </table>
        <a href="${orderUrl}" style="display:inline-block;margin-top:14px;color:#dc2626">Order link to send them →</a>
      </div>`;

    const emails = recipients("ORDER_ALERT_EMAILS");
    await Promise.all(
      emails.map((to) =>
        sendEmail({
          to,
          subject,
          html,
          text,
          idempotencyKey: `bounce-alert:${order.id}:${status}:${to}`,
        }).catch((err) => logError("notify-seller:bounce-email", err, { orderId, to })),
      ),
    );
    if (whatsappEnabled()) {
      const phones = recipients("ORDER_ALERT_PHONES");
      await Promise.all(
        phones.map((toPhone) =>
          sendWhatsApp({ toPhone, text }).catch(() => {}),
        ),
      );
    }
  } catch (err) {
    logError("notify-seller:bounce", err, { orderId });
  }
}

export async function sendSellerOrderAlert(orderId: string): Promise<void> {
  try {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return;

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, order.customerId));

    const addr = (order.shippingAddress ?? {}) as {
      fullName?: string;
      phone?: string;
      city?: string;
      state?: string;
      pincode?: string;
    };
    const items = (order.items as Array<{ name: string; qty: number }>) ?? [];
    const itemLines = items
      .map((i) => `• ${i.name} × ${i.qty}`)
      .join("\n");

    const isCod = order.paymentMethod === "COD";
    const payLine = isCod
      ? `COD — paid ${inr(order.confirmationFeeInr)} online, collect ${inr(
          order.totalInr - order.confirmationFeeInr,
        )} on delivery`
      : `Prepaid — ${inr(order.totalInr)} paid online`;

    const custName = addr.fullName || customer?.name || "Customer";
    const custPhone = addr.phone || customer?.phone || "";
    const where = [addr.city, addr.pincode].filter(Boolean).join(" · ");
    const packUrl = `${SITE_URL}/pack`;

    const subject = `🛒 New order ${order.id} · ${inr(order.totalInr)} · ${
      isCod ? "COD" : "Prepaid"
    }`;

    const text = [
      `New order on pocketrccars.com`,
      ``,
      `Order:    ${order.id}`,
      `Amount:   ${inr(order.totalInr)}`,
      `Payment:  ${payLine}`,
      ``,
      `Items:`,
      itemLines,
      ``,
      `Customer: ${custName}`,
      `Phone:    ${custPhone}`,
      `Ship to:  ${where}`,
      ``,
      `Pack & ship → ${packUrl}`,
    ].join("\n");

    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:480px">
        <h2 style="margin:0 0 4px">🛒 New order — ${order.id}</h2>
        <p style="margin:0 0 16px;color:#555">${inr(order.totalInr)} · ${payLine}</p>
        <table style="font-size:14px;border-collapse:collapse;width:100%">
          <tr><td style="padding:4px 0;color:#888">Items</td><td style="padding:4px 0">${items
            .map((i) => `${i.name} × ${i.qty}`)
            .join("<br>")}</td></tr>
          <tr><td style="padding:4px 0;color:#888">Customer</td><td style="padding:4px 0">${custName}</td></tr>
          <tr><td style="padding:4px 0;color:#888">Phone</td><td style="padding:4px 0">${custPhone}</td></tr>
          <tr><td style="padding:4px 0;color:#888">Ship to</td><td style="padding:4px 0">${where}</td></tr>
        </table>
        <a href="${packUrl}" style="display:inline-block;margin-top:16px;background:#dc2626;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Pack &amp; ship →</a>
      </div>`;

    // ── Email (reliable) ─────────────────────────────────────────────
    const emails = recipients("ORDER_ALERT_EMAILS");
    if (emails.length === 0) {
      logError(
        "notify-seller:no-recipients",
        new Error("ORDER_ALERT_EMAILS not set — seller won't be alerted"),
        { orderId },
      );
    }
    await Promise.all(
      emails.map((to) =>
        sendEmail({
          to,
          subject,
          html,
          text,
          // One alert per order per address — dedups webhook retries.
          idempotencyKey: `seller-alert:${order.id}:${to}`,
        }).catch((err) => logError("notify-seller:email", err, { orderId, to })),
      ),
    );

    // ── WhatsApp (best-effort, when configured) ──────────────────────
    if (whatsappEnabled()) {
      const phones = recipients("ORDER_ALERT_PHONES");
      await Promise.all(
        phones.map((toPhone) =>
          sendWhatsApp({ toPhone, text }).catch((err) =>
            logError("notify-seller:whatsapp", err, { orderId, toPhone }),
          ),
        ),
      );
    }
  } catch (err) {
    // Never let a seller-alert failure bubble into the webhook.
    logError("notify-seller", err, { orderId });
  }
}

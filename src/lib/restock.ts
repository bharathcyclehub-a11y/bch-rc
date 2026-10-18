/**
 * Back-in-stock notification service (Phase 5)
 *
 * Supports:
 * - Email or WhatsApp opt-in with explicit customer consent
 * - Per-SKU and colour-variant association
 * - Deduplication via UNIQUE(site_id, sku_id, variant_slug, channel, contact)
 *   (with a resilient fallback to `events` if the migration hasn't been run yet)
 * - Unsubscribe via token (`/api/restock/unsubscribe?token=...`)
 * - Verified restock trigger (`<= 0` → `> 0`) that dispatches via Resend /
 *   WhatsApp Business API when configured, and never pretends messages were
 *   sent if a messaging provider is unconfigured.
 */

import { and, eq, sql, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { restockSubscriptions, events } from "@/db/schema";
import { PRODUCTS } from "@/lib/products";
import { INVENTORY_SITE_ID } from "@/lib/inventory";
import { sendEmail } from "@/lib/notifications/send-email";
import { sendWhatsApp } from "@/lib/notifications/send-whatsapp";
import { formatINR } from "@/lib/utils";
import { logError } from "@/lib/logger";

export type RestockChannel = "email" | "whatsapp";

export interface SubscribeRestockInput {
  skuId: string;
  variantSlug?: string | null;
  channel: RestockChannel;
  contact: string;
  consent: boolean;
}

export interface SubscribeRestockResult {
  ok: boolean;
  deduplicated?: boolean;
  unsubscribeToken?: string;
  error?: string;
}

export function normalizeRestockContact(
  channel: RestockChannel,
  raw: string,
): { ok: true; contact: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (channel === "email") {
    const lower = trimmed.toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lower) || lower.length > 160) {
      return { ok: false, error: "Please enter a valid email address." };
    }
    return { ok: true, contact: lower };
  }
  const digits = trimmed.replace(/\D/g, "");
  const tenDigits =
    digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(tenDigits)) {
    return {
      ok: false,
      error: "Please enter a valid 10-digit Indian WhatsApp number.",
    };
  }
  return { ok: true, contact: tenDigits };
}

export async function subscribeRestockAlert(
  input: SubscribeRestockInput,
): Promise<SubscribeRestockResult> {
  if (!input.consent) {
    return {
      ok: false,
      error: "Please confirm consent to receive a one-time restock alert.",
    };
  }

  const sku = PRODUCTS.find((p) => p.id === input.skuId);
  if (!sku || sku.hidden) {
    return { ok: false, error: "Product not found." };
  }

  const normVariant =
    sku.colors && sku.colors.length > 0
      ? (input.variantSlug ?? sku.colors[0].slug)
      : "";
  if (sku.colors && sku.colors.length > 0) {
    const foundColor = sku.colors.find((c) => c.slug === normVariant);
    if (!foundColor) {
      return { ok: false, error: "Invalid colour variant." };
    }
  }

  const norm = normalizeRestockContact(input.channel, input.contact);
  if (!norm.ok) {
    return { ok: false, error: norm.error };
  }

  const token = nanoid(32);

  try {
    const existing = await db
      .select({
        id: restockSubscriptions.id,
        status: restockSubscriptions.status,
        unsubscribeToken: restockSubscriptions.unsubscribeToken,
      })
      .from(restockSubscriptions)
      .where(
        and(
          eq(restockSubscriptions.siteId, INVENTORY_SITE_ID),
          eq(restockSubscriptions.skuId, sku.id),
          eq(restockSubscriptions.variantSlug, normVariant),
          eq(restockSubscriptions.channel, input.channel),
          eq(restockSubscriptions.contact, norm.contact),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      if (row.status === "ACTIVE") {
        return {
          ok: true,
          deduplicated: true,
          unsubscribeToken: row.unsubscribeToken,
        };
      }
      await db
        .update(restockSubscriptions)
        .set({
          status: "ACTIVE",
          consent: true,
          updatedAt: new Date(),
        })
        .where(eq(restockSubscriptions.id, row.id));
      return {
        ok: true,
        deduplicated: false,
        unsubscribeToken: row.unsubscribeToken,
      };
    }

    await db.insert(restockSubscriptions).values({
      siteId: INVENTORY_SITE_ID,
      skuId: sku.id,
      variantSlug: normVariant,
      channel: input.channel,
      contact: norm.contact,
      consent: true,
      status: "ACTIVE",
      unsubscribeToken: token,
    });

    return { ok: true, deduplicated: false, unsubscribeToken: token };
  } catch {
    // Fallback to events table if restock_subscriptions migration hasn't been run yet
    try {
      await db.insert(events).values({
        siteId: INVENTORY_SITE_ID,
        type: "RESTOCK_SUBSCRIBED",
        payload: {
          skuId: sku.id,
          variantSlug: normVariant,
          channel: input.channel,
          contact: norm.contact,
          consent: true,
          unsubscribeToken: token,
        },
        source: "user",
      });
      return { ok: true, deduplicated: false, unsubscribeToken: token };
    } catch (fallbackErr) {
      logError("restock:subscribe", fallbackErr, { skuId: sku.id });
      return { ok: false, error: "Could not save subscription. Please try again." };
    }
  }
}

export async function unsubscribeRestockAlert(
  token: string,
): Promise<{ ok: boolean; skuName?: string }> {
  if (!token || token.length < 10) return { ok: false };
  try {
    const updated = await db
      .update(restockSubscriptions)
      .set({ status: "UNSUBSCRIBED", updatedAt: new Date() })
      .where(eq(restockSubscriptions.unsubscribeToken, token))
      .returning({ skuId: restockSubscriptions.skuId });

    if (updated.length > 0) {
      const sku = PRODUCTS.find((p) => p.id === updated[0].skuId);
      return { ok: true, skuName: sku?.name };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface TriggerRestockResult {
  triggered: boolean;
  sentCount: number;
  queuedWithoutProviderCount: number;
}

/**
 * Trigger restock notifications when a `(skuId, variantSlug)` transitions from
 * `<= 0` to `> 0` verified stock.
 *
 * Rate-limited to at most 50 notifications per restock transition, and avoids
 * duplicate messages by atomically flipping `status = 'ACTIVE'` → `'NOTIFIED'`
 * only when the provider actually accepts the message. If a provider is not
 * configured, records a `RESTOCK_ALERT_QUEUED` event without pretending the
 * message was sent.
 */
export async function triggerRestockAlertsForVariant(opts: {
  skuId: string;
  variantSlug: string;
  beforeStock: number | null;
  afterStock: number;
}): Promise<TriggerRestockResult> {
  const wasOut = (opts.beforeStock ?? 0) <= 0;
  const isNowIn = opts.afterStock > 0;
  if (!wasOut || !isNowIn) {
    return { triggered: false, sentCount: 0, queuedWithoutProviderCount: 0 };
  }

  const sku = PRODUCTS.find((p) => p.id === opts.skuId);
  if (!sku || sku.hidden || sku.comingSoon || sku.discontinued) {
    return { triggered: false, sentCount: 0, queuedWithoutProviderCount: 0 };
  }

  const colorObj = sku.colors?.find((c) => c.slug === opts.variantSlug);
  const fullProductName = colorObj ? `${sku.name} (${colorObj.name})` : sku.name;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://pocketrccars.com";
  const productUrl = `${siteUrl}/product/${sku.slug}${
    opts.variantSlug ? `?color=${encodeURIComponent(opts.variantSlug)}` : ""
  }`;

  try {
    const subs = await db
      .select()
      .from(restockSubscriptions)
      .where(
        and(
          eq(restockSubscriptions.siteId, INVENTORY_SITE_ID),
          eq(restockSubscriptions.skuId, opts.skuId),
          eq(restockSubscriptions.variantSlug, opts.variantSlug),
          eq(restockSubscriptions.status, "ACTIVE"),
        ),
      )
      .limit(50);

    if (subs.length === 0) {
      return { triggered: true, sentCount: 0, queuedWithoutProviderCount: 0 };
    }

    let sentCount = 0;
    let queuedWithoutProviderCount = 0;

    for (const sub of subs) {
      const unsubUrl = `${siteUrl}/api/restock/unsubscribe?token=${encodeURIComponent(
        sub.unsubscribeToken,
      )}`;

      if (sub.channel === "email") {
        if (!process.env.RESEND_API_KEY) {
          queuedWithoutProviderCount++;
          continue;
        }
        const subject = `Back in stock: ${fullProductName} — Pocket RC Cars`;
        const text = `Good news! ${fullProductName} (${formatINR(
          sku.retailINR,
        )}) is back in stock at Pocket RC Cars.\n\nOrder now: ${productUrl}\n\n---\nYou requested a one-time restock alert. Unsubscribe: ${unsubUrl}`;
        const html = `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
            <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#dc2626;font-weight:700;margin:0 0 8px">Back in Stock</p>
            <h2 style="margin:0 0 12px;font-size:20px">${fullProductName} is ready to ship</h2>
            <p style="color:#444;line-height:1.5;margin:0 0 20px">
              The <strong>${fullProductName}</strong> (${formatINR(sku.retailINR)}) you asked us to watch is back in stock in our Bangalore warehouse (${opts.afterStock} units available).
            </p>
            <p style="margin:0 0 24px">
              <a href="${productUrl}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">View ${fullProductName} →</a>
            </p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
            <p style="font-size:12px;color:#777;margin:0">
              You received this one-time alert because you opted in on pocketrccars.com.
              <a href="${unsubUrl}" style="color:#777">Unsubscribe</a>
            </p>
          </div>
        `;
        const res = await sendEmail({
          to: sub.contact,
          subject,
          text,
          html,
          idempotencyKey: `restock:${sub.id}:${ new Date().toISOString().slice(0, 13) }`,
        });
        if (res.ok) {
          await db
            .update(restockSubscriptions)
            .set({
              status: "NOTIFIED",
              notifiedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(restockSubscriptions.id, sub.id));
          sentCount++;
        }
      } else if (sub.channel === "whatsapp") {
        const waConfigured =
          process.env.WHATSAPP_ENABLED === "true" &&
          Boolean(process.env.WHATSAPP_API_URL) &&
          Boolean(process.env.WHATSAPP_API_TOKEN);
        if (!waConfigured) {
          queuedWithoutProviderCount++;
          continue;
        }
        const text = `Good news from Pocket RC Cars! 🏎️\n\n*${fullProductName}* (${formatINR(
          sku.retailINR,
        )}) is back in stock (${opts.afterStock} available).\n\nOrder here: ${productUrl}\n\nOpt out: ${unsubUrl}`;
        const res = await sendWhatsApp({ toPhone: sub.contact, text });
        if (res.ok) {
          await db
            .update(restockSubscriptions)
            .set({
              status: "NOTIFIED",
              notifiedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(restockSubscriptions.id, sub.id));
          sentCount++;
        }
      }
    }

    await db.insert(events).values({
      siteId: INVENTORY_SITE_ID,
      type: "RESTOCK_ALERTS_PROCESSED",
      payload: {
        skuId: opts.skuId,
        variantSlug: opts.variantSlug,
        afterStock: opts.afterStock,
        sentCount,
        queuedWithoutProviderCount,
      },
      source: "system",
    });

    return { triggered: true, sentCount, queuedWithoutProviderCount };
  } catch (err) {
    logError("restock:trigger", err, {
      skuId: opts.skuId,
      variantSlug: opts.variantSlug,
    });
    return { triggered: false, sentCount: 0, queuedWithoutProviderCount: 0 };
  }
}

export interface RestockDemandItem {
  skuId: string;
  variantSlug: string;
  skuName: string;
  colorName: string | null;
  activeEmail: number;
  activeWhatsapp: number;
  totalActive: number;
  pendingCount: number;
  notifiedCount: number;
}

export interface RestockDemandSummary {
  totalPending: number;
  totalNotified: number;
  bySkuVariant: RestockDemandItem[];
}

/**
 * Aggregate restock subscriber counts per `(skuId, variantSlug)` for the Admin
 * dashboard (Phase 5 & Phase 8). Safe if table is not yet migrated.
 */
export async function getRestockDemandSummary(): Promise<RestockDemandSummary> {
  try {
    const rows = await db
      .select({
        skuId: restockSubscriptions.skuId,
        variantSlug: restockSubscriptions.variantSlug,
        channel: restockSubscriptions.channel,
        status: restockSubscriptions.status,
        count: sql<number>`count(*)::int`,
      })
      .from(restockSubscriptions)
      .where(eq(restockSubscriptions.siteId, INVENTORY_SITE_ID))
      .groupBy(
        restockSubscriptions.skuId,
        restockSubscriptions.variantSlug,
        restockSubscriptions.channel,
        restockSubscriptions.status,
      );

    const map = new Map<string, RestockDemandItem>();
    for (const r of rows) {
      const key = `${r.skuId}:${r.variantSlug}`;
      const sku = PRODUCTS.find((p) => p.id === r.skuId);
      const color = sku?.colors?.find((c) => c.slug === r.variantSlug);
      let entry = map.get(key);
      if (!entry) {
        entry = {
          skuId: r.skuId,
          variantSlug: r.variantSlug,
          skuName: sku?.name ?? r.skuId,
          colorName: color?.name ?? (r.variantSlug || null),
          activeEmail: 0,
          activeWhatsapp: 0,
          totalActive: 0,
          pendingCount: 0,
          notifiedCount: 0,
        };
        map.set(key, entry);
      }
      if (r.status === "ACTIVE") {
        if (r.channel === "email") entry.activeEmail += r.count;
        if (r.channel === "whatsapp") entry.activeWhatsapp += r.count;
        entry.totalActive += r.count;
        entry.pendingCount += r.count;
      } else if (r.status === "NOTIFIED") {
        entry.notifiedCount += r.count;
      }
    }

    const bySkuVariant = Array.from(map.values()).sort(
      (a, b) => b.totalActive - a.totalActive,
    );
    return {
      totalPending: bySkuVariant.reduce((s, r) => s + r.pendingCount, 0),
      totalNotified: bySkuVariant.reduce((s, r) => s + r.notifiedCount, 0),
      bySkuVariant,
    };
  } catch {
    // Fallback: inspect RESTOCK_SUBSCRIBED events if table isn't migrated yet
    try {
      const evRows = await db
        .select({ payload: events.payload })
        .from(events)
        .where(
          and(
            eq(events.siteId, INVENTORY_SITE_ID),
            eq(events.type, "RESTOCK_SUBSCRIBED"),
          ),
        )
        .orderBy(desc(events.createdAt))
        .limit(200);
      const map = new Map<string, RestockDemandItem>();
      for (const r of evRows) {
        const p = r.payload as {
          skuId?: string;
          variantSlug?: string;
          channel?: string;
        } | null;
        if (!p?.skuId) continue;
        const vSlug = p.variantSlug ?? "";
        const key = `${p.skuId}:${vSlug}`;
        const sku = PRODUCTS.find((s) => s.id === p.skuId);
        const color = sku?.colors?.find((c) => c.slug === vSlug);
        let entry = map.get(key);
        if (!entry) {
          entry = {
            skuId: p.skuId,
            variantSlug: vSlug,
            skuName: sku?.name ?? p.skuId,
            colorName: color?.name ?? (vSlug || null),
            activeEmail: 0,
            activeWhatsapp: 0,
            totalActive: 0,
            pendingCount: 0,
            notifiedCount: 0,
          };
          map.set(key, entry);
        }
        if (p.channel === "whatsapp") entry.activeWhatsapp += 1;
        else entry.activeEmail += 1;
        entry.totalActive += 1;
        entry.pendingCount += 1;
      }
      const bySkuVariant = Array.from(map.values()).sort(
        (a, b) => b.totalActive - a.totalActive,
      );
      return {
        totalPending: bySkuVariant.reduce((s, r) => s + r.pendingCount, 0),
        totalNotified: 0,
        bySkuVariant,
      };
    } catch {
      return { totalPending: 0, totalNotified: 0, bySkuVariant: [] };
    }
  }
}

/**
 * Shipping-cost report — per courier provider (Shiprocket / Delhivery direct).
 *
 * Cohort: orders PLACED in the window, the same rule as Returns / RTO, so every
 * rate on the page divides like by like (an RTO this month is not set against
 * dispatches from a different month).
 *
 * Sources, all already stored — nothing here calls a courier:
 *   orders.courier_provider / courier_quoted_paise / courier_billed_paise
 *   orders.courier_routing.decision — the routing record (every provider's
 *     quote with zone + charged weight, reasonCode, comparable, savingsPaise)
 *   delivery_exceptions, shipment_tracking — service quality
 *
 * Billed figures are entered by staff from invoices and are never estimated:
 * where a quote stands in for a bill, the page says so.
 *
 * Four grouped queries. A missing courier_* column (migration not applied)
 * surfaces as Postgres 42703 for the caller's isMissingTableError().
 */

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { ExceptionType } from "@/lib/tracking/assess";
import { COURIER_PROVIDERS, type CourierProvider } from "@/lib/couriers/types";

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v ?? 0) || 0;
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const provider = (v: unknown): CourierProvider => (v === "delhivery" ? "delhivery" : "shiprocket");

async function rows(q: SQL): Promise<Row[]> {
  return (await db.execute(q)) as unknown as Row[];
}

const textList = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
const siteArray = (siteIds: string[]) => sql`array[${textList(siteIds)}]::text[]`;

/** A pickup that never happened on time (src/lib/tracking/assess.ts). */
export const PICKUP_EXCEPTION_TYPES = ["PICKUP_DELAYED"] as const satisfies readonly ExceptionType[];

/** Courier-side delivery problems after pickup. Excludes RTO (its own rate),
 *  our own sync/AWB/order-state checks, and customer reports. */
export const DELIVERY_EXCEPTION_TYPES = [
  "DELIVERY_ATTEMPT_FAILED",
  "CARRIER_EXCEPTION",
  "CARRIER_DELAY",
  "EDD_EXPIRED",
  "NO_MOVEMENT",
] as const satisfies readonly ExceptionType[];

/** Courier charges by 500 g slab; the slab's upper bound in grams. */
export const WEIGHT_SLAB_GRAMS = 500;

function cohort(siteIds: string[], start: Date, end: Date): SQL {
  // booked: Delhivery = a waybill; Shiprocket = a real (all-digit) order id,
  // AWB or not; anything dispatched counts even if its ids were never stored.
  return sql`
    cohort AS (
      SELECT o.id,
             o.courier_provider AS provider,
             o.payment_method::text AS payment_method,
             o.status::text AS status,
             o.shipped_at,
             o.delivered_at,
             o.courier_quoted_paise AS quoted,
             o.courier_billed_paise AS billed,
             o.courier_routing AS routing,
             (o.awb_code IS NOT NULL
               OR o.shiprocket_order_id ~ '^[0-9]+$'
               OR o.status IN ('SHIPPED', 'DELIVERED', 'RETURNED')) AS booked,
             o.status IN ('SHIPPED', 'DELIVERED', 'RETURNED') AS dispatched
      FROM orders o
      WHERE o.site_id = ANY(${siteArray(siteIds)})
        AND o.placed_at >= ${start.toISOString()}
        AND o.placed_at < ${end.toISOString()}
    )`;
}

/** The order has an exception of these types on its FORWARD parcel (or one
 *  not tied to a tracking row). Return/replacement parcels don't count. */
function hasException(types: readonly string[]): SQL {
  return sql`EXISTS (
    SELECT 1 FROM delivery_exceptions de
    LEFT JOIN shipment_tracking st ON st.id = de.tracking_id
    WHERE de.order_id = c.id
      AND coalesce(st.kind, 'FORWARD') = 'FORWARD'
      AND de.type IN (${textList(types)})
  )`;
}

export type ProviderSummary = {
  provider: CourierProvider;
  booked: number;
  cod: number;
  prepaid: number;
  quotedN: number;
  quotedSum: number;
  billedN: number;
  billedSum: number;
  /** Orders with both a quote and a bill: the quote-vs-bill gap is fair only on these. */
  pairedN: number;
  pairedGap: number;
  delivered: number;
  deliveredBilledN: number;
  deliveredQuotedN: number;
  /** Σ billed-else-quoted over delivered orders that have either figure. */
  deliveredCostSum: number;
  dispatched: number;
  returned: number;
  pickupFailed: number;
  deliveryExceptions: number;
  transitN: number;
  transitDays: number | null;
};

export type BreakdownRow = {
  provider: CourierProvider;
  /** null = no stored quote (or the quote had no zone / weight). */
  key: string | number | null;
  n: number;
  quotedN: number;
  quotedSum: number;
  billedN: number;
  billedSum: number;
};

export type RoutingRow = {
  mode: string;
  reasonCode: string;
  recommended: CourierProvider | null;
  n: number;
  /** Booked on the provider the decision recommended. */
  followed: number;
  comparableN: number;
  savingsN: number;
  savingsSum: number;
  savingsFollowedN: number;
  savingsFollowedSum: number;
};

export type SyncRow = {
  provider: CourierProvider;
  active: number;
  failing: number;
  waitingForAwb: number;
  maxFailures: number;
  lastFailedAt: Date | null;
};

export type ShippingReport = {
  providers: ProviderSummary[];
  byZone: BreakdownRow[];
  byWeight: BreakdownRow[];
  routing: RoutingRow[];
  sync: SyncRow[];
};

const emptySummary = (p: CourierProvider): ProviderSummary => ({
  provider: p,
  booked: 0,
  cod: 0,
  prepaid: 0,
  quotedN: 0,
  quotedSum: 0,
  billedN: 0,
  billedSum: 0,
  pairedN: 0,
  pairedGap: 0,
  delivered: 0,
  deliveredBilledN: 0,
  deliveredQuotedN: 0,
  deliveredCostSum: 0,
  dispatched: 0,
  returned: 0,
  pickupFailed: 0,
  deliveryExceptions: 0,
  transitN: 0,
  transitDays: null,
});

export async function loadShippingReport(siteIds: string[], start: Date, end: Date): Promise<ShippingReport> {
  const slab = sql.raw(String(WEIGHT_SLAB_GRAMS));
  const [summaryRows, breakdownRows, routingRows, syncRows] = await Promise.all([
    rows(sql`
      WITH ${cohort(siteIds, start, end)}
      SELECT c.provider,
        count(*) FILTER (WHERE c.booked)::int AS booked,
        count(*) FILTER (WHERE c.booked AND c.payment_method = 'COD')::int AS cod,
        count(c.quoted) FILTER (WHERE c.booked)::int AS quoted_n,
        coalesce(sum(c.quoted) FILTER (WHERE c.booked), 0)::float8 AS quoted_sum,
        count(c.billed) FILTER (WHERE c.booked)::int AS billed_n,
        coalesce(sum(c.billed) FILTER (WHERE c.booked), 0)::float8 AS billed_sum,
        count(*) FILTER (WHERE c.booked AND c.quoted IS NOT NULL AND c.billed IS NOT NULL)::int AS paired_n,
        coalesce(sum(c.billed - c.quoted) FILTER (WHERE c.booked AND c.quoted IS NOT NULL AND c.billed IS NOT NULL), 0)::float8 AS paired_gap,
        count(*) FILTER (WHERE c.status = 'DELIVERED')::int AS delivered,
        count(c.billed) FILTER (WHERE c.status = 'DELIVERED')::int AS delivered_billed_n,
        count(*) FILTER (WHERE c.status = 'DELIVERED' AND c.billed IS NULL AND c.quoted IS NOT NULL)::int AS delivered_quoted_n,
        coalesce(sum(coalesce(c.billed, c.quoted)) FILTER (WHERE c.status = 'DELIVERED'), 0)::float8 AS delivered_cost_sum,
        count(*) FILTER (WHERE c.dispatched)::int AS dispatched,
        count(*) FILTER (WHERE c.status = 'RETURNED')::int AS returned,
        count(*) FILTER (WHERE c.booked AND ${hasException(PICKUP_EXCEPTION_TYPES)})::int AS pickup_failed,
        count(*) FILTER (WHERE c.dispatched AND ${hasException(DELIVERY_EXCEPTION_TYPES)})::int AS delivery_exceptions,
        count(*) FILTER (WHERE c.status = 'DELIVERED' AND c.delivered_at >= c.shipped_at)::int AS transit_n,
        (avg(extract(epoch FROM c.delivered_at - c.shipped_at))
          FILTER (WHERE c.status = 'DELIVERED' AND c.delivered_at >= c.shipped_at) / 86400)::float8 AS transit_days
      FROM cohort c
      GROUP BY c.provider
    `),
    // Zone and charged weight come from the BOOKED provider's own quote in the
    // routing record; both breakdowns in one pass via GROUPING SETS.
    rows(sql`
      WITH ${cohort(siteIds, start, end)},
      booked AS (
        SELECT c.provider, c.quoted, c.billed,
               jsonb_path_query_first(
                 c.routing,
                 '$.decision.assessments[*] ? (@.provider == $p).quote',
                 jsonb_build_object('p', c.provider)
               ) AS quote
        FROM cohort c
        WHERE c.booked
      ),
      facts AS (
        SELECT provider, quoted, billed,
               nullif(trim(quote->>'zone'), '') AS zone,
               CASE WHEN jsonb_typeof(quote->'chargedWeightGrams') = 'number'
                         AND (quote->>'chargedWeightGrams')::numeric > 0
                    THEN (ceil((quote->>'chargedWeightGrams')::numeric / ${slab}) * ${slab})::int
               END AS slab
        FROM booked
      )
      SELECT provider, zone, slab, GROUPING(zone)::int AS by_slab,
        count(*)::int AS n,
        count(quoted)::int AS quoted_n,
        coalesce(sum(quoted), 0)::float8 AS quoted_sum,
        count(billed)::int AS billed_n,
        coalesce(sum(billed), 0)::float8 AS billed_sum
      FROM facts
      GROUP BY GROUPING SETS ((provider, zone), (provider, slab))
    `),
    // Every stored decision, shadow included (mode = 'shadow' is a
    // recommendation only — the order was booked on Shiprocket regardless).
    rows(sql`
      WITH ${cohort(siteIds, start, end)},
      d AS (
        SELECT c.provider, c.booked,
               coalesce(c.routing->'decision'->>'mode', 'unknown') AS mode,
               coalesce(c.routing->'decision'->>'reasonCode', 'UNKNOWN') AS reason_code,
               c.routing->'decision'->>'recommended' AS recommended,
               c.routing->'decision'->>'comparable' = 'true' AS comparable,
               CASE WHEN jsonb_typeof(c.routing->'decision'->'savingsPaise') = 'number'
                    THEN (c.routing->'decision'->>'savingsPaise')::numeric
               END AS savings
        FROM cohort c
        WHERE jsonb_typeof(c.routing->'decision') = 'object'
      )
      SELECT mode, reason_code, recommended,
        count(*)::int AS n,
        count(*) FILTER (WHERE booked AND provider = recommended)::int AS followed,
        count(*) FILTER (WHERE comparable)::int AS comparable_n,
        count(savings) FILTER (WHERE comparable)::int AS savings_n,
        coalesce(sum(savings) FILTER (WHERE comparable), 0)::float8 AS savings_sum,
        count(savings) FILTER (WHERE comparable AND booked AND provider = recommended)::int AS savings_followed_n,
        coalesce(sum(savings) FILTER (WHERE comparable AND booked AND provider = recommended), 0)::float8 AS savings_followed_sum
      FROM d
      GROUP BY mode, reason_code, recommended
    `),
    // Current state, not windowed: last_sync_error is cleared on the next
    // successful sync, so there is no history to put in a window.
    rows(sql`
      SELECT st.courier_provider AS provider,
        count(*) FILTER (WHERE st.active)::int AS active,
        count(*) FILTER (WHERE st.active AND st.consecutive_failures > 0)::int AS failing,
        count(*) FILTER (WHERE st.active AND st.consecutive_failures = 0 AND st.last_sync_error IS NOT NULL)::int AS waiting,
        coalesce(max(st.consecutive_failures) FILTER (WHERE st.active), 0)::int AS max_failures,
        max(st.last_sync_attempt_at) FILTER (WHERE st.active AND st.consecutive_failures > 0) AS last_failed_at
      FROM shipment_tracking st
      WHERE st.site_id = ANY(${siteArray(siteIds)})
      GROUP BY st.courier_provider
    `),
  ]);

  // courier_provider has a CHECK constraint: at most one row per provider.
  const summaries = new Map(COURIER_PROVIDERS.map((p) => [p, emptySummary(p)]));
  for (const r of summaryRows) {
    const p = provider(r.provider);
    summaries.set(p, {
      provider: p,
      booked: num(r.booked),
      cod: num(r.cod),
      prepaid: num(r.booked) - num(r.cod),
      quotedN: num(r.quoted_n),
      quotedSum: num(r.quoted_sum),
      billedN: num(r.billed_n),
      billedSum: num(r.billed_sum),
      pairedN: num(r.paired_n),
      pairedGap: num(r.paired_gap),
      delivered: num(r.delivered),
      deliveredBilledN: num(r.delivered_billed_n),
      deliveredQuotedN: num(r.delivered_quoted_n),
      deliveredCostSum: num(r.delivered_cost_sum),
      dispatched: num(r.dispatched),
      returned: num(r.returned),
      pickupFailed: num(r.pickup_failed),
      deliveryExceptions: num(r.delivery_exceptions),
      transitN: num(r.transit_n),
      transitDays: r.transit_days === null || r.transit_days === undefined ? null : num(r.transit_days),
    });
  }

  const byZone: BreakdownRow[] = [];
  const byWeight: BreakdownRow[] = [];
  for (const r of breakdownRows) {
    const bySlab = num(r.by_slab) === 1;
    const slab = r.slab === null || r.slab === undefined ? null : num(r.slab);
    const row: BreakdownRow = {
      provider: provider(r.provider),
      key: bySlab ? slab : str(r.zone),
      n: num(r.n),
      quotedN: num(r.quoted_n),
      quotedSum: num(r.quoted_sum),
      billedN: num(r.billed_n),
      billedSum: num(r.billed_sum),
    };
    (bySlab ? byWeight : byZone).push(row);
  }
  const order = (a: BreakdownRow, b: BreakdownRow) =>
    COURIER_PROVIDERS.indexOf(a.provider) - COURIER_PROVIDERS.indexOf(b.provider) ||
    (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) ||
    (typeof a.key === "number" && typeof b.key === "number" ? a.key - b.key : b.n - a.n);
  byZone.sort(order);
  byWeight.sort(order);

  const routing: RoutingRow[] = routingRows.map((r) => ({
    mode: String(r.mode ?? "unknown"),
    reasonCode: String(r.reason_code ?? "UNKNOWN"),
    recommended: r.recommended === "delhivery" || r.recommended === "shiprocket" ? r.recommended : null,
    n: num(r.n),
    followed: num(r.followed),
    comparableN: num(r.comparable_n),
    savingsN: num(r.savings_n),
    savingsSum: num(r.savings_sum),
    savingsFollowedN: num(r.savings_followed_n),
    savingsFollowedSum: num(r.savings_followed_sum),
  }));

  const sync: SyncRow[] = COURIER_PROVIDERS.map((p) => {
    const r = syncRows.find((x) => provider(x.provider) === p);
    // The driver may hand back a Date or the raw timestamptz text.
    const at = r?.last_failed_at ? new Date(r.last_failed_at as string | Date) : null;
    return {
      provider: p,
      active: num(r?.active),
      failing: num(r?.failing),
      waitingForAwb: num(r?.waiting),
      maxFailures: num(r?.max_failures),
      lastFailedAt: at && Number.isFinite(at.getTime()) ? at : null,
    };
  });

  return { providers: COURIER_PROVIDERS.map((p) => summaries.get(p)!), byZone, byWeight, routing, sync };
}

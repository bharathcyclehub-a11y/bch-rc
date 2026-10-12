/**
 * Read-only queries behind the admin support desk (/admin/support/*).
 *
 * Every query here is scoped to the operator's sites (tickets, exceptions,
 * orders carry a site id; claims and refunds are scoped through their order)
 * and never writes. Mutations go through tickets.ts / claims.ts / refunds.ts /
 * kb.ts so rules and the audit trail stay in one place.
 *
 * The support tables come from a manual migration: callers catch
 * isMissingTableError() and render a setup notice instead of a 500.
 */

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  admins,
  appSettings,
  customers,
  deliveryExceptions,
  helpArticles,
  inventory,
  orders,
  refundCases,
  shipmentJobs,
  supportClaims,
  supportTicketAttachments,
  supportTicketEvents,
  supportTicketMessages,
  supportTickets,
} from "@/db/schema";
import { addUtcDays, istDayStart, istYmd } from "@/lib/tz";
import { OPEN_STATUSES, type Priority } from "./rules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

/** Postgres "undefined table / column" — the support migration isn't applied yet. */
export function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  const code = e?.code ?? e?.cause?.code;
  return code === "42P01" || code === "42703";
}

/** Fresh aggregate per select field — a selected SQL carries its decoder, so never share one. */
const countAll = () => sql<number>`count(*)::int`;
const countWhere = (cond: SQL | undefined) => sql<number>`(count(*) filter (where ${cond ?? sql`true`}))::int`;

const openTicket = () => inArray(supportTickets.status, [...OPEN_STATUSES]);
const ticketScope = (siteIds: string[]) => inArray(supportTickets.siteId, siteIds);

/** Customer wrote after our last reply (or we never replied) and it's our move. */
const unansweredCond = () =>
  and(
    openTicket(),
    eq(supportTickets.awaiting, "STAFF"),
    sql`${supportTickets.lastCustomerMessageAt} > coalesce(${supportTickets.lastStaffMessageAt}, 'epoch'::timestamptz)`,
  );

/** Open, no first reply yet, first-response target passed (same rule as countSlaBreaches). */
const breachedCond = (now: Date) =>
  and(openTicket(), isNull(supportTickets.firstResponseAt), lt(supportTickets.firstResponseDueAt, now));

export const DELAY_EXCEPTION_TYPES = ["EDD_EXPIRED", "NO_MOVEMENT", "CARRIER_DELAY"] as const;
export const PENDING_REPLACEMENT_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "NEEDS_INFO", "APPROVED"] as const;
export const PENDING_REFUND_STATUSES = ["REQUESTED", "APPROVED", "PROCESSING"] as const;
/** Orders whose failed shipment job no longer matters (cancelled/refunded from pack etc.). */
const CLOSED_ORDER_STATUSES = ["CANCELLED", "REFUNDED", "RETURNED", "FAILED", "ABANDONED"] as const;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type AttentionItem =
  | { kind: "critical"; id: string; number: string; subject: string; reason: string | null; at: Date; assignedTo: string | null; breached: boolean }
  | { kind: "sla"; id: string; number: string; subject: string; dueAt: Date }
  | { kind: "refund"; id: string; orderId: string; amountInr: number; method: string; ticketId: string | null; ticketNumber: string | null; at: Date }
  | { kind: "exception"; id: string; orderId: string; type: string; detail: string | null; severity: string; escalatedAt: Date };

export type SupportDashboard = {
  metrics: {
    open: number;
    unassigned: number;
    critical: number;
    slaBreaches: number;
    unanswered: number;
    deliveryDelays: number;
    syncFailures: number;
    rto: number;
    pendingReplacements: number;
    pendingRefunds: number;
    refundsAwaitingApproval: number;
    failedShipments: number;
  };
  attention: AttentionItem[];
  week: {
    days: Array<{ ymd: string; count: number }>;
    total: number;
    medianFirstResponseMin: number | null;
    firstResponseSample: number;
    resolved: number;
    resolvedInSla: number;
    topCategories: Array<{ category: string; count: number }>;
  };
};

export async function loadSupportDashboard(siteIds: string[], now: Date): Promise<SupportDashboard> {
  const scope = ticketScope(siteIds);
  const exScope = inArray(deliveryExceptions.siteId, siteIds);
  const orderScope = inArray(orders.siteId, siteIds);
  const weekStart = addUtcDays(istDayStart(now), -6);
  const day = sql<string>`to_char(date_trunc('day', ${supportTickets.createdAt} AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;

  const [
    [tickets],
    exceptionRows,
    [claims],
    refundRows,
    [failed],
    critical,
    breached,
    refundsToApprove,
    escalatedEx,
    dayRows,
    [firstResponse],
    [resolved],
    categoryRows,
  ] = await Promise.all([
    db
      .select({
        open: countWhere(openTicket()),
        unassigned: countWhere(and(openTicket(), isNull(supportTickets.assignedTo))),
        critical: countWhere(and(openTicket(), eq(supportTickets.priority, "CRITICAL"))),
        breached: countWhere(breachedCond(now)),
        unanswered: countWhere(unansweredCond()),
      })
      .from(supportTickets)
      .where(scope),
    db
      .select({ type: deliveryExceptions.type, n: countAll() })
      .from(deliveryExceptions)
      .where(and(exScope, ne(deliveryExceptions.status, "RESOLVED")))
      .groupBy(deliveryExceptions.type),
    db
      .select({ n: countAll() })
      .from(supportClaims)
      .innerJoin(orders, eq(orders.id, supportClaims.orderId))
      .where(
        and(orderScope, eq(supportClaims.type, "REPLACEMENT"), inArray(supportClaims.status, [...PENDING_REPLACEMENT_STATUSES])),
      ),
    db
      .select({ status: refundCases.status, n: countAll() })
      .from(refundCases)
      .innerJoin(orders, eq(orders.id, refundCases.orderId))
      .where(and(orderScope, inArray(refundCases.status, [...PENDING_REFUND_STATUSES])))
      .groupBy(refundCases.status),
    db
      .select({ n: countAll() })
      .from(shipmentJobs)
      .innerJoin(orders, eq(orders.id, shipmentJobs.orderId))
      .where(and(orderScope, eq(shipmentJobs.status, "FAILED"), notInArray(orders.status, [...CLOSED_ORDER_STATUSES]))),
    db
      .select({
        id: supportTickets.id,
        number: supportTickets.number,
        subject: supportTickets.subject,
        reason: supportTickets.priorityReason,
        at: supportTickets.createdAt,
        assignedTo: supportTickets.assignedTo,
        firstResponseAt: supportTickets.firstResponseAt,
        firstResponseDueAt: supportTickets.firstResponseDueAt,
      })
      .from(supportTickets)
      .where(and(scope, openTicket(), eq(supportTickets.priority, "CRITICAL")))
      .orderBy(asc(supportTickets.createdAt))
      .limit(5),
    db
      .select({ id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject, dueAt: supportTickets.firstResponseDueAt })
      .from(supportTickets)
      .where(and(scope, breachedCond(now), ne(supportTickets.priority, "CRITICAL")))
      .orderBy(asc(supportTickets.firstResponseDueAt))
      .limit(5),
    db
      .select({
        id: refundCases.id,
        orderId: refundCases.orderId,
        amountInr: refundCases.amountInr,
        method: refundCases.method,
        ticketId: refundCases.ticketId,
        ticketNumber: supportTickets.number,
        at: refundCases.createdAt,
      })
      .from(refundCases)
      .innerJoin(orders, eq(orders.id, refundCases.orderId))
      .leftJoin(supportTickets, eq(supportTickets.id, refundCases.ticketId))
      .where(and(orderScope, eq(refundCases.status, "REQUESTED")))
      .orderBy(asc(refundCases.createdAt))
      .limit(5),
    db
      .select({
        id: deliveryExceptions.id,
        orderId: deliveryExceptions.orderId,
        type: deliveryExceptions.type,
        detail: deliveryExceptions.detail,
        severity: deliveryExceptions.severity,
        escalatedAt: deliveryExceptions.escalatedAt,
      })
      .from(deliveryExceptions)
      .where(and(exScope, ne(deliveryExceptions.status, "RESOLVED"), isNotNull(deliveryExceptions.escalatedAt)))
      .orderBy(asc(deliveryExceptions.escalatedAt))
      .limit(5),
    db
      .select({ d: day, n: countAll() })
      .from(supportTickets)
      .where(and(scope, gte(supportTickets.createdAt, weekStart)))
      .groupBy(day),
    db
      .select({
        medianSec: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${supportTickets.firstResponseAt} - ${supportTickets.createdAt}))::float8)`,
        n: countAll(),
      })
      .from(supportTickets)
      .where(and(scope, gte(supportTickets.createdAt, weekStart), isNotNull(supportTickets.firstResponseAt))),
    db
      .select({
        n: countAll(),
        inSla: countWhere(sql`${supportTickets.resolvedAt} <= ${supportTickets.resolutionDueAt}`),
      })
      .from(supportTickets)
      .where(and(scope, gte(supportTickets.resolvedAt, weekStart))),
    db
      .select({ category: supportTickets.category, n: countAll() })
      .from(supportTickets)
      .where(and(scope, gte(supportTickets.createdAt, weekStart)))
      .groupBy(supportTickets.category)
      .orderBy(desc(countAll()))
      .limit(5),
  ]);

  const exByType = new Map(exceptionRows.map((r) => [r.type, r.n]));
  const refundsBy = new Map(refundRows.map((r) => [r.status, r.n]));

  const byDay = new Map(dayRows.map((r) => [r.d, r.n]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const ymd = istYmd(addUtcDays(weekStart, i));
    return { ymd, count: byDay.get(ymd) ?? 0 };
  });

  const attention: AttentionItem[] = [
    ...critical.map((t) => ({
      kind: "critical" as const,
      id: t.id,
      number: t.number,
      subject: t.subject,
      reason: t.reason,
      at: t.at,
      assignedTo: t.assignedTo,
      breached: !t.firstResponseAt && !!t.firstResponseDueAt && t.firstResponseDueAt < now,
    })),
    ...breached.map((t) => ({ kind: "sla" as const, id: t.id, number: t.number, subject: t.subject, dueAt: t.dueAt ?? now })),
    ...escalatedEx.map((e) => ({
      kind: "exception" as const,
      id: e.id,
      orderId: e.orderId,
      type: e.type,
      detail: e.detail,
      severity: e.severity,
      escalatedAt: e.escalatedAt ?? now,
    })),
    ...refundsToApprove.map((r) => ({ kind: "refund" as const, ...r })),
  ];

  const median = firstResponse?.medianSec == null ? null : Number(firstResponse.medianSec);

  return {
    metrics: {
      open: tickets?.open ?? 0,
      unassigned: tickets?.unassigned ?? 0,
      critical: tickets?.critical ?? 0,
      // Same rule as countSlaBreaches(), scoped to the operator's sites.
      slaBreaches: tickets?.breached ?? 0,
      unanswered: tickets?.unanswered ?? 0,
      deliveryDelays: DELAY_EXCEPTION_TYPES.reduce((s, t) => s + (exByType.get(t) ?? 0), 0),
      syncFailures: exByType.get("SYNC_FAILING") ?? 0,
      rto: exByType.get("RTO") ?? 0,
      pendingReplacements: claims?.n ?? 0,
      pendingRefunds: PENDING_REFUND_STATUSES.reduce((s, st) => s + (refundsBy.get(st) ?? 0), 0),
      refundsAwaitingApproval: refundsBy.get("REQUESTED") ?? 0,
      failedShipments: failed?.n ?? 0,
    },
    attention,
    week: {
      days,
      total: days.reduce((s, d) => s + d.count, 0),
      medianFirstResponseMin: median == null || !Number.isFinite(median) ? null : Math.round(median / 60),
      firstResponseSample: firstResponse?.n ?? 0,
      resolved: resolved?.n ?? 0,
      resolvedInSla: resolved?.inSla ?? 0,
      topCategories: categoryRows.map((r) => ({ category: r.category, count: r.n })),
    },
  };
}

// ---------------------------------------------------------------------------
// Ticket list
// ---------------------------------------------------------------------------

export const TICKET_VIEWS = ["open", "mine", "unassigned", "awaiting", "resolved", "closed", "all"] as const;
export type TicketView = (typeof TICKET_VIEWS)[number];

/** Dashboard drill-downs that aren't a tab or a filter. */
export const TICKET_FOCUS = ["breached", "unanswered", "replacements", "refunds"] as const;
export type TicketFocus = (typeof TICKET_FOCUS)[number];

export type TicketListQuery = {
  view: TicketView;
  q: string;
  category: string;
  priority: Priority | "";
  /** "" any · "none" unassigned · an admin email */
  assignee: string;
  focus: TicketFocus | "";
  offset: number;
  limit: number;
};

function viewCond(view: TicketView, me: string): SQL | undefined {
  switch (view) {
    case "open":
      return openTicket();
    case "mine":
      return and(openTicket(), eq(supportTickets.assignedTo, me));
    case "unassigned":
      return and(openTicket(), isNull(supportTickets.assignedTo));
    case "awaiting":
      return eq(supportTickets.status, "AWAITING_CUSTOMER");
    case "resolved":
      return eq(supportTickets.status, "RESOLVED");
    case "closed":
      return eq(supportTickets.status, "CLOSED");
    default:
      return undefined;
  }
}

function focusCond(focus: TicketFocus | "", now: Date): SQL | undefined {
  switch (focus) {
    case "breached":
      return breachedCond(now);
    case "unanswered":
      return unansweredCond();
    case "replacements":
      return sql`exists (select 1 from ${supportClaims} where ${supportClaims.ticketId} = ${supportTickets.id} and ${supportClaims.type} = 'REPLACEMENT' and ${supportClaims.status} in ('SUBMITTED', 'UNDER_REVIEW', 'NEEDS_INFO', 'APPROVED'))`;
    case "refunds":
      return sql`exists (select 1 from ${refundCases} where (${refundCases.ticketId} = ${supportTickets.id} or ${refundCases.orderId} = ${supportTickets.orderId}) and ${refundCases.status} in ('REQUESTED', 'APPROVED', 'PROCESSING'))`;
    default:
      return undefined;
  }
}

const escapeLike = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);

function searchCond(q: string): SQL | undefined {
  if (!q) return undefined;
  const like = `%${escapeLike(q)}%`;
  const digits = q.replace(/\D/g, "");
  return or(
    ilike(supportTickets.number, like),
    ilike(supportTickets.orderId, like),
    ilike(supportTickets.subject, like),
    ilike(supportTickets.contactName, like),
    ilike(supportTickets.contactEmail, like),
    ilike(supportTickets.contactPhone, like),
    digits.length >= 4
      ? sql`regexp_replace(coalesce(${supportTickets.contactPhone}, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`
      : undefined,
  );
}

const PRIORITY_RANK = sql`CASE ${supportTickets.priority} WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`;
/** The SLA clock that matters now: first response until answered, then resolution. */
const NEXT_DUE = sql`CASE WHEN ${supportTickets.firstResponseAt} IS NULL THEN ${supportTickets.firstResponseDueAt} ELSE ${supportTickets.resolutionDueAt} END`;

export async function listTicketsForAdmin(siteIds: string[], me: string, query: TicketListQuery, now: Date) {
  const scope = ticketScope(siteIds);
  const where: Array<SQL | undefined> = [scope, viewCond(query.view, me), focusCond(query.focus, now), searchCond(query.q)];
  if (query.category) where.push(eq(supportTickets.category, query.category));
  if (query.priority) where.push(eq(supportTickets.priority, query.priority));
  if (query.assignee === "none") where.push(isNull(supportTickets.assignedTo));
  else if (query.assignee) where.push(eq(supportTickets.assignedTo, query.assignee));

  const triage = query.view === "open" || query.view === "mine" || query.view === "unassigned" || query.view === "awaiting";
  const order = triage
    ? [asc(PRIORITY_RANK), sql`${NEXT_DUE} ASC NULLS LAST`, desc(supportTickets.updatedAt)]
    : [desc(supportTickets.updatedAt)];

  const [[counts], rows] = await Promise.all([
    db
      .select({
        open: countWhere(viewCond("open", me)),
        mine: countWhere(viewCond("mine", me)),
        unassigned: countWhere(viewCond("unassigned", me)),
        awaiting: countWhere(viewCond("awaiting", me)),
        resolved: countWhere(viewCond("resolved", me)),
        closed: countWhere(viewCond("closed", me)),
        all: countAll(),
      })
      .from(supportTickets)
      .where(scope),
    db
      .select({
        id: supportTickets.id,
        number: supportTickets.number,
        subject: supportTickets.subject,
        category: supportTickets.category,
        status: supportTickets.status,
        priority: supportTickets.priority,
        orderId: supportTickets.orderId,
        contactName: supportTickets.contactName,
        contactPhone: supportTickets.contactPhone,
        contactEmail: supportTickets.contactEmail,
        customerName: customers.name,
        assignedTo: supportTickets.assignedTo,
        safetyFlag: supportTickets.safetyFlag,
        firstResponseAt: supportTickets.firstResponseAt,
        firstResponseDueAt: supportTickets.firstResponseDueAt,
        resolutionDueAt: supportTickets.resolutionDueAt,
        resolvedAt: supportTickets.resolvedAt,
        updatedAt: supportTickets.updatedAt,
        createdAt: supportTickets.createdAt,
      })
      .from(supportTickets)
      .leftJoin(customers, eq(customers.id, supportTickets.customerId))
      .where(and(...where))
      .orderBy(...order)
      .limit(query.limit + 1)
      .offset(query.offset),
  ]);

  return {
    counts: (counts ?? { open: 0, mine: 0, unassigned: 0, awaiting: 0, resolved: 0, closed: 0, all: 0 }) as Record<TicketView, number>,
    rows: rows.slice(0, query.limit),
    hasNext: rows.length > query.limit,
  };
}

export type TicketListRow = Awaited<ReturnType<typeof listTicketsForAdmin>>["rows"][number];

// ---------------------------------------------------------------------------
// Ticket detail
// ---------------------------------------------------------------------------

export async function loadTicketDetail(id: string) {
  if (!isUuid(id)) return null;
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, id));
  if (!ticket) return null;

  const refundWhere = ticket.orderId
    ? or(eq(refundCases.ticketId, ticket.id), eq(refundCases.orderId, ticket.orderId))
    : eq(refundCases.ticketId, ticket.id);

  const [messages, attachments, events, claims, refunds, orderRows, customerRows] = await Promise.all([
    db.select().from(supportTicketMessages).where(eq(supportTicketMessages.ticketId, ticket.id)).orderBy(asc(supportTicketMessages.createdAt)),
    db
      .select({
        id: supportTicketAttachments.id,
        messageId: supportTicketAttachments.messageId,
        mimeType: supportTicketAttachments.mimeType,
        sizeBytes: supportTicketAttachments.sizeBytes,
        name: supportTicketAttachments.originalName,
        uploadedBy: supportTicketAttachments.uploadedBy,
        createdAt: supportTicketAttachments.createdAt,
      })
      .from(supportTicketAttachments)
      .where(eq(supportTicketAttachments.ticketId, ticket.id))
      .orderBy(asc(supportTicketAttachments.createdAt)),
    db
      .select()
      .from(supportTicketEvents)
      .where(eq(supportTicketEvents.ticketId, ticket.id))
      .orderBy(desc(supportTicketEvents.createdAt))
      .limit(100),
    db.select().from(supportClaims).where(eq(supportClaims.ticketId, ticket.id)).orderBy(desc(supportClaims.createdAt)),
    db.select().from(refundCases).where(refundWhere).orderBy(desc(refundCases.createdAt)),
    ticket.orderId ? db.select().from(orders).where(eq(orders.id, ticket.orderId)) : Promise.resolve([]),
    ticket.customerId
      ? db
          .select({
            id: customers.id,
            name: customers.name,
            email: customers.email,
            phone: customers.phone,
            totalOrders: customers.totalOrders,
            totalSpentInr: customers.totalSpentInr,
          })
          .from(customers)
          .where(eq(customers.id, ticket.customerId))
      : Promise.resolve([]),
  ]);

  return {
    ticket,
    messages,
    attachments,
    events,
    claims,
    refunds,
    order: orderRows[0] ?? null,
    customer: customerRows[0] ?? null,
  };
}

export type TicketDetail = NonNullable<Awaited<ReturnType<typeof loadTicketDetail>>>;

/** Current sellable stock for one SKU/variant (null = no inventory row). */
export async function liveStock(siteId: string, skuId: string, variantSlug: string | null): Promise<number | null> {
  const [row] = await db
    .select({ stock: inventory.stock })
    .from(inventory)
    .where(and(eq(inventory.siteId, siteId), eq(inventory.skuId, skuId), eq(inventory.variantSlug, variantSlug ?? "")));
  return row ? row.stock : null;
}

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

export async function listAdmins(opts: { activeOnly?: boolean } = {}) {
  return db
    .select({ id: admins.id, email: admins.email, name: admins.name, role: admins.role, active: admins.active, createdAt: admins.createdAt })
    .from(admins)
    .where(opts.activeOnly ? eq(admins.active, true) : undefined)
    .orderBy(asc(admins.email));
}

export type AdminListRow = Awaited<ReturnType<typeof listAdmins>>[number];

// ---------------------------------------------------------------------------
// Settings + articles
// ---------------------------------------------------------------------------

/** Who last changed each settings key, and when. */
export async function settingsMeta(keys: string[]): Promise<Record<string, { updatedAt: Date; updatedBy: string | null }>> {
  const rows = await db
    .select({ key: appSettings.key, updatedAt: appSettings.updatedAt, updatedBy: appSettings.updatedBy })
    .from(appSettings)
    .where(inArray(appSettings.key, keys));
  return Object.fromEntries(rows.map((r) => [r.key, { updatedAt: r.updatedAt, updatedBy: r.updatedBy }]));
}

/** Raw stored value (no defaults, no cache) — used to merge an edit onto it. */
export async function rawSetting(key: string): Promise<Record<string, unknown>> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  const v = row?.value;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function getArticleById(id: string) {
  if (!isUuid(id)) return null;
  const [a] = await db.select().from(helpArticles).where(eq(helpArticles.id, id));
  return a ?? null;
}

export async function articleSlugTaken(slug: string, exceptId: string | null): Promise<boolean> {
  const [row] = await db
    .select({ id: helpArticles.id })
    .from(helpArticles)
    .where(exceptId ? and(eq(helpArticles.slug, slug), ne(helpArticles.id, exceptId)) : eq(helpArticles.slug, slug));
  return !!row;
}

export async function listArticleOptions() {
  return db
    .select({ id: helpArticles.id, slug: helpArticles.slug, title: helpArticles.title, status: helpArticles.status })
    .from(helpArticles)
    .orderBy(asc(helpArticles.title));
}

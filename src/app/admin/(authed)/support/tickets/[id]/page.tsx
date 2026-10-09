import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowRight, Film, Lock, MessageCircle, Phone, ShieldAlert } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { formatDateTimeShort, formatPhone, formatRelative, initialsOf, requestTime, telHref, whatsappHref } from "@/lib/admin/format";
import { can } from "@/lib/admin/permissions";
import { PAYMENT_METHOD_LABEL, paymentStateMeta } from "@/lib/admin/status";
import { isMissingTableError, listAdmins, loadTicketDetail, type TicketDetail } from "@/lib/support/admin-queries";
import { loadPolicy } from "@/lib/support/config";
import { EVIDENCE_ACCEPT } from "@/lib/support/evidence";
import { onlineRefundable } from "@/lib/support/refunds";
import { canStaffMove, isTicketStatus, TICKET_STATUSES } from "@/lib/support/rules";
import { cn, formatINR } from "@/lib/utils";
import { Badge, OrderStatusBadge, Tag } from "@/components/admin/Badge";
import { KeyValue, Panel, PanelHeader } from "@/components/admin/Panel";
import { PageHeader } from "@/components/admin/PageHeader";
import { Skeleton } from "@/components/admin/Skeleton";
import { TrackingPanel } from "@/app/admin/(authed)/orders/[id]/TrackingPanel";
import {
  categoryLabel,
  CLAIM_REASON_LABEL,
  ClaimStatusBadge,
  eventDetail,
  eventLabel,
  NoAccessNotice,
  PriorityBadge,
  REFUND_METHOD_LABEL,
  refundStatusMeta,
  shortEmail,
  slaState,
  SupportSetupNotice,
  TicketStatusBadge,
  ticketStatusLabel,
} from "../../ticket-ui";
import { ClaimActions } from "./ClaimActions";
import { Composer } from "./Composer";
import { RefundCaseActions, RequestRefundButton } from "./RefundActions";
import { TicketActions } from "./TicketActions";

type OrderItem = { skuId: string; variantSlug: string | null; name: string; unitPriceInr?: number; qty: number; lineTotalInr?: number };
type ClaimItem = { skuId: string; variantSlug: string | null; name: string; qty: number; unitPriceInr: number | null };
type Eligibility = { message?: string; eligible?: boolean; daysSinceDelivery?: number | null; windowDays?: number | null; evidence?: string; conditions?: string[] };
type StockSnapshot = { available?: number | null; inStock?: boolean; checkedAt?: string };

const CHANNEL_LABEL: Record<string, string> = { WEB: "web form", CHAT: "support chat", WHATSAPP: "WhatsApp", VOICE: "phone", ADMIN: "staff" };
const ACTIVE_REFUND = new Set(["REQUESTED", "APPROVED", "PROCESSING", "PROCESSED"]);

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "support.view")) return <NoAccessNotice title="Ticket" />;
  const { id } = await params;
  const now = new Date(requestTime());

  let detail: TicketDetail | null;
  let staff: Awaited<ReturnType<typeof listAdmins>>;
  let maxFiles: number;
  try {
    [detail, staff, { maxEvidenceFiles: maxFiles }] = await Promise.all([loadTicketDetail(id), listAdmins({ activeOnly: true }), loadPolicy()]);
  } catch (err) {
    if (isMissingTableError(err)) return <SupportSetupNotice title="Ticket" />;
    throw err;
  }
  if (!detail || !ctx.siteIds.includes(detail.ticket.siteId)) notFound();

  const { ticket: t, messages, attachments, events, claims, refunds, order, customer } = detail;
  const perm = {
    reply: can(ctx.role, "support.reply"),
    assign: can(ctx.role, "support.assign"),
    decide: can(ctx.role, "claims.decide"),
    fulfil: can(ctx.role, "claims.fulfil"),
    requestRefund: can(ctx.role, "refunds.request"),
    approveRefund: can(ctx.role, "refunds.approve"),
  };
  const status = isTicketStatus(t.status) ? t.status : "OPEN";
  const statusTargets = TICKET_STATUSES.filter((s) => s !== status && canStaffMove(status, s)).map((s) => ({ value: s, label: ticketStatusLabel(s) }));
  const sla = slaState(t, now);
  const contactName = t.contactName || customer?.name || null;
  const internalCount = messages.filter((m) => m.internal).length;
  const filesByMessage = new Map<string, typeof attachments>();
  for (const a of attachments) {
    if (!a.messageId) continue;
    filesByMessage.set(a.messageId, [...(filesByMessage.get(a.messageId) ?? []), a]);
  }
  const looseFiles = attachments.filter((a) => !a.messageId);
  const context = contextLines(t.context);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/support/tickets", label: "Tickets" }}
        title={t.subject}
        description={
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <Tag mono>{t.number}</Tag>
              <span>
                Opened {formatRelative(t.createdAt, now.getTime()).toLowerCase()}
                {contactName ? <> by <span className="font-medium text-brand-ink">{contactName}</span></> : null} via{" "}
                {CHANNEL_LABEL[t.channel] ?? t.channel.toLowerCase()} · {categoryLabel(t.category)}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <TicketStatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
              {t.priorityReason && <span className="text-xs text-admin-muted">({t.priorityReason})</span>}
              {sla && <Badge tone={sla.tone}>SLA: {sla.label.charAt(0).toLowerCase() + sla.label.slice(1)}</Badge>}
              {t.safetyFlag && (
                <Badge tone="negative">
                  <ShieldAlert size={12} aria-hidden /> Safety hazard reported
                </Badge>
              )}
              {t.reopenCount > 0 && <Tag>Reopened ×{t.reopenCount}</Tag>}
            </div>
            {t.status === "ESCALATED" && t.escalationReason && (
              <p className="text-xs text-tone-neg">Escalated: {t.escalationReason}</p>
            )}
          </div>
        }
        actions={
          <TicketActions
            ticketId={t.id}
            status={t.status}
            priority={t.priority}
            assignedTo={t.assignedTo}
            staff={staff.map((a) => ({ value: a.email, label: a.name ? `${a.name} (${shortEmail(a.email)})` : a.email }))}
            statusTargets={statusTargets}
            canAssign={perm.assign}
            canReply={perm.reply}
          />
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── Conversation ─────────────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            title="Conversation"
            description={`${messages.length} message${messages.length === 1 ? "" : "s"}${internalCount ? ` · ${internalCount} internal note${internalCount === 1 ? "" : "s"}` : ""} · oldest first`}
          />
          {context.length > 0 && (
            <div className="border-b border-admin-line bg-admin-page px-4 py-3 sm:px-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">Hand-off context</p>
              <dl className="mt-1.5 space-y-1 text-[13px]">
                {context.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="shrink-0 text-admin-muted">{k}:</dt>
                    <dd className="min-w-0 break-words text-brand-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <ol className="divide-y divide-admin-line">
            {messages.map((m) => (
              <MessageRow key={m.id} m={m} files={filesByMessage.get(m.id) ?? []} contactEmail={t.contactEmail} contactPhone={t.contactPhone} />
            ))}
          </ol>
          {looseFiles.length > 0 && (
            <div className="border-t border-admin-line px-4 py-3 sm:px-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">Other attachments</p>
              <Attachments files={looseFiles} />
            </div>
          )}
          {t.status === "CLOSED" ? (
            <p className="border-t border-admin-line px-4 py-4 text-[13px] text-admin-muted sm:px-5">
              This ticket is closed. If the customer needs more help, raise a new ticket.
            </p>
          ) : perm.reply ? (
            <Composer
              ticketId={t.id}
              customerContact={t.contactEmail}
              statusOptions={statusTargets}
              accept={EVIDENCE_ACCEPT}
              maxFiles={Math.min(5, maxFiles)}
            />
          ) : (
            <p className="border-t border-admin-line px-4 py-4 text-[13px] text-admin-muted sm:px-5">Your role can read this ticket but not reply.</p>
          )}
        </Panel>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <CustomerPanel t={t} customer={customer} />
          {order && <OrderPanel order={order} />}
          {order && (
            <Suspense fallback={<PanelSkeleton title="Tracking" />}>
              <TrackingPanel orderId={order.id} />
            </Suspense>
          )}
          {claims.map((c) => (
            <ClaimPanel key={c.id} claim={c} canDecide={perm.decide} canFulfil={perm.fulfil} now={now} />
          ))}
          {order && (
            <RefundsPanel
              ticketId={t.id}
              order={order}
              refunds={refunds}
              claim={claims[0] ?? null}
              canRequest={perm.requestRefund && t.status !== "CLOSED"}
              canApprove={perm.approveRefund}
            />
          )}
          <ActivityPanel events={events} now={now} />
        </div>
      </div>
    </>
  );
}

// ── Conversation ────────────────────────────────────────────────────────────

type Message = TicketDetail["messages"][number];
type Attachment = TicketDetail["attachments"][number];

function MessageRow({ m, files, contactEmail, contactPhone }: { m: Message; files: Attachment[]; contactEmail: string | null; contactPhone: string | null }) {
  if (m.authorType === "SYSTEM" || m.authorType === "ASSISTANT") {
    return (
      <li className="bg-admin-page px-4 py-3 sm:px-5">
        <div className="flex items-baseline gap-2 text-xs text-admin-muted">
          <span className="font-semibold uppercase tracking-[0.06em]">{m.authorType === "ASSISTANT" ? "Assistant" : "Update"}</span>
          <time className="ml-auto shrink-0 tabular-nums">{formatDateTimeShort(m.createdAt)}</time>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-brand-ink-soft">{m.body}</p>
        {files.length > 0 && <div className="mt-2"><Attachments files={files} /></div>}
      </li>
    );
  }
  const customer = m.authorType === "CUSTOMER";
  const name = customer ? m.authorName || "Customer" : m.authorName || "Staff";
  return (
    <li className={cn("px-4 py-4 sm:px-5", m.internal && "border-l-4 border-l-tone-warn bg-tone-warn-bg")}>
      {m.internal && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-tone-warn">
          <Lock size={12} aria-hidden /> Internal note — only staff can see
        </p>
      )}
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
            customer ? "bg-brand-ink text-white" : "bg-admin-subtle text-brand-ink",
          )}
        >
          {initialsOf(customer ? name : name.split("@")[0])}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="truncate text-[13px] font-semibold text-brand-ink">{customer ? name : shortEmail(name) || name}</span>
            <Tag>{customer ? "Customer" : "Staff"}</Tag>
            <time className="ml-auto shrink-0 text-xs tabular-nums text-admin-muted">{formatDateTimeShort(m.createdAt)}</time>
          </div>
          <p className="truncate text-xs text-admin-muted">
            {customer
              ? [m.authorEmail ?? contactEmail, contactPhone ? formatPhone(contactPhone) : null].filter(Boolean).join(" · ")
              : m.internal
                ? m.authorEmail
                : `${m.authorEmail ?? ""}${contactEmail ? ` → ${contactEmail}` : ""}`}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-brand-ink">{m.body}</p>
          {files.length > 0 && <div className="mt-3"><Attachments files={files} /></div>}
        </div>
      </div>
    </li>
  );
}

function Attachments({ files }: { files: Attachment[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((f) => {
        const href = `/api/support/evidence/${f.id}`;
        const label = f.name || (f.mimeType.startsWith("video/") ? "Video" : "Photo");
        if (f.mimeType.startsWith("image/")) {
          return (
            <li key={f.id}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={`${label} · ${formatBytes(f.sizeBytes)}`}
                className="block h-24 w-24 overflow-hidden rounded-lg border border-admin-line bg-admin-subtle hover:border-admin-line-strong"
              >
                {/* Private evidence: served (after an access check) via a short-lived signed redirect, so no next/image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={href} alt={label} loading="lazy" className="h-full w-full object-cover" />
              </a>
            </li>
          );
        }
        return (
          <li key={f.id}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-24 w-40 flex-col justify-center gap-1 rounded-lg border border-admin-line bg-admin-subtle px-3 text-xs text-brand-ink hover:border-admin-line-strong"
            >
              <Film size={18} aria-hidden className="text-admin-muted" />
              <span className="truncate font-medium">{label}</span>
              <span className="tabular-nums text-admin-muted">{formatBytes(f.sizeBytes)} · opens in a new tab</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// ── Sidebar panels ──────────────────────────────────────────────────────────

function CustomerPanel({ t, customer }: { t: TicketDetail["ticket"]; customer: TicketDetail["customer"] }) {
  const phone = t.contactPhone ?? customer?.phone ?? null;
  const email = t.contactEmail ?? customer?.email ?? null;
  const tel = telHref(phone);
  const wa = whatsappHref(phone);
  return (
    <Panel>
      <PanelHeader
        title="Customer & contact"
        actions={
          t.identityVerified ? <Badge tone="positive">Verified owner</Badge> : <Badge tone="attention">Not verified</Badge>
        }
      />
      <KeyValue
        items={[
          { label: "Name", value: t.contactName || customer?.name || "—" },
          {
            label: "Email",
            value: email ? (
              <a href={`mailto:${email}`} className="break-all hover:underline">
                {email}
              </a>
            ) : (
              "—"
            ),
          },
          {
            label: "Phone",
            value: phone ? (
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                <span className="tabular-nums">{formatPhone(phone)}</span>
                {tel && (
                  <a href={tel} aria-label="Call" title="Call" className="text-admin-muted hover:text-brand-ink">
                    <Phone size={14} aria-hidden />
                  </a>
                )}
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" title="WhatsApp" className="text-admin-muted hover:text-brand-ink">
                    <MessageCircle size={14} aria-hidden />
                  </a>
                )}
              </span>
            ) : (
              "—"
            ),
          },
          ...(customer
            ? [
                {
                  label: "History",
                  value: (
                    <Link href={`/admin/customers/${customer.id}`} className="hover:underline">
                      {customer.totalOrders} order{customer.totalOrders === 1 ? "" : "s"} · {formatINR(customer.totalSpentInr)}
                    </Link>
                  ),
                },
              ]
            : []),
        ]}
      />
      {!t.identityVerified && (
        <p className="border-t border-admin-line px-4 py-2.5 text-xs leading-4 text-admin-muted sm:px-5">
          Raised without proving order ownership. Confirm the order details before sharing anything about it.
        </p>
      )}
    </Panel>
  );
}

function OrderPanel({ order }: { order: NonNullable<TicketDetail["order"]> }) {
  const items = (Array.isArray(order.items) ? order.items : []) as OrderItem[];
  const pay = paymentStateMeta(order.paymentMethod, order.paymentStatus);
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            Order <span className="font-mono text-[13px]">{order.id}</span>
          </span>
        }
        actions={
          <Link href={`/admin/orders/${order.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-ink hover:underline">
            View order <ArrowRight size={13} aria-hidden />
          </Link>
        }
      />
      <ul className="divide-y divide-admin-line border-b border-admin-line">
        {items.map((it, i) => (
          <li key={`${it.skuId}-${it.variantSlug ?? ""}-${i}`} className="flex items-start gap-3 px-4 py-2.5 text-[13px] sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-brand-ink">{it.name}</p>
              <p className="truncate font-mono text-[11px] text-admin-muted">
                {it.skuId}
                {it.variantSlug ? ` · ${it.variantSlug}` : ""} · ×{it.qty}
              </p>
            </div>
            {typeof it.lineTotalInr === "number" && <span className="shrink-0 tabular-nums">{formatINR(it.lineTotalInr)}</span>}
          </li>
        ))}
      </ul>
      <KeyValue
        items={[
          { label: "Status", value: <OrderStatusBadge status={order.status} /> },
          {
            label: "Payment",
            value: (
              <span>
                {PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod} · <Badge tone={pay.tone}>{pay.label}</Badge>
              </span>
            ),
          },
          { label: "Total", value: <span className="tabular-nums">{formatINR(order.totalInr)}</span> },
          { label: "Placed", value: formatDateTimeShort(order.placedAt) },
          { label: "Delivered", value: order.deliveredAt ? formatDateTimeShort(order.deliveredAt) : <span className="text-admin-muted">Not yet</span> },
          ...(order.awbCode
            ? [{ label: "Courier", value: <span>{order.courierName ?? "—"} · <span className="font-mono text-xs">{order.awbCode}</span></span> }]
            : []),
        ]}
      />
    </Panel>
  );
}

function ClaimPanel({
  claim,
  canDecide,
  canFulfil,
  now,
}: {
  claim: TicketDetail["claims"][number];
  canDecide: boolean;
  canFulfil: boolean;
  now: Date;
}) {
  const items = (Array.isArray(claim.items) ? claim.items : []) as ClaimItem[];
  const el = (claim.eligibility ?? {}) as Eligibility;
  const stock = (claim.stock ?? {}) as StockSnapshot;
  const replacement = claim.type === "REPLACEMENT";
  const rows: { label: string; value: ReactNode }[] = [
    { label: "Reason", value: CLAIM_REASON_LABEL[claim.reason] ?? claim.reason },
    { label: "Items", value: items.length ? items.map((i) => `${i.name} ×${i.qty}`).join(", ") : "—" },
  ];
  if (el.daysSinceDelivery != null || el.windowDays != null) {
    rows.push({
      label: "Window",
      value: `${el.daysSinceDelivery != null ? `Day ${el.daysSinceDelivery}` : "Not delivered"}${el.windowDays != null ? ` of ${el.windowDays}` : ""}`,
    });
  }
  if (el.evidence) rows.push({ label: "Evidence", value: el.evidence === "REQUIRED" ? "Required" : el.evidence === "RECOMMENDED" ? "Recommended" : "Not needed" });
  if (replacement && stock.checkedAt) {
    rows.push({
      label: "Stock at submission",
      value: (
        <span>
          <Badge tone={stock.inStock ? "positive" : "negative"}>{stock.inStock ? "In stock" : "Out of stock"}</Badge>{" "}
          <span className="tabular-nums text-admin-muted">{stock.available ?? 0} available</span>
        </span>
      ),
    });
  }
  if (claim.decisionBy) {
    rows.push({ label: "Decided", value: `${shortEmail(claim.decisionBy)} · ${claim.decisionAt ? formatRelative(claim.decisionAt, now.getTime()) : ""}` });
  }
  if (claim.shipmentAwb) rows.push({ label: "AWB", value: <span className="font-mono text-xs">{claim.shipmentAwb}</span> });
  if (claim.replacementOrderId) {
    rows.push({
      label: "Replacement order",
      value: (
        <Link href={`/admin/orders/${claim.replacementOrderId}`} className="font-mono text-xs hover:underline">
          {claim.replacementOrderId}
        </Link>
      ),
    });
  }

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Claim <span className="font-mono text-[13px]">{claim.number}</span>
            <span className="text-xs font-normal text-admin-muted">{replacement ? "Replacement" : "Return"}</span>
          </span>
        }
        actions={<ClaimStatusBadge status={claim.status} />}
      />
      {el.message && (
        <div className={cn("border-b border-admin-line px-4 py-3 text-[13px] leading-5 sm:px-5", el.eligible ? "bg-tone-pos-bg text-tone-pos" : "bg-tone-warn-bg text-tone-warn")}>
          <p className="font-semibold">{el.eligible ? "Within policy" : "Needs review"}</p>
          <p className="mt-0.5">{el.message}</p>
          {el.conditions && el.conditions.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs">
              {el.conditions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <KeyValue items={rows} />
      {claim.decisionNote && (
        <p className="border-t border-admin-line px-4 py-2.5 text-xs leading-4 text-brand-ink-soft sm:px-5">
          <span className="font-semibold text-brand-ink">Note:</span> {claim.decisionNote}
        </p>
      )}
      <ClaimActions claimId={claim.id} status={claim.status} type={claim.type} canDecide={canDecide} canFulfil={canFulfil} />
    </Panel>
  );
}

function RefundsPanel({
  ticketId,
  order,
  refunds,
  claim,
  canRequest,
  canApprove,
}: {
  ticketId: string;
  order: NonNullable<TicketDetail["order"]>;
  refunds: TicketDetail["refunds"];
  claim: TicketDetail["claims"][number] | null;
  canRequest: boolean;
  canApprove: boolean;
}) {
  const active = refunds.filter((r) => r.orderId === order.id && ACTIVE_REFUND.has(r.status));
  const committed = active.reduce((s, r) => s + r.amountInr, 0);
  const committedOnline = active.filter((r) => r.method === "RAZORPAY").reduce((s, r) => s + r.amountInr, 0);
  const onlineRoom = Math.max(0, onlineRefundable(order) - committedOnline);
  const remaining = Math.max(0, order.totalInr - committed);

  const claimItems = (claim && Array.isArray(claim.items) ? claim.items : []) as ClaimItem[];
  const lineTotal = claimItems.length && claimItems.every((i) => typeof i.unitPriceInr === "number")
    ? claimItems.reduce((s, i) => s + (i.unitPriceInr ?? 0) * i.qty, 0)
    : null;
  const defaultMethod: "RAZORPAY" | "MANUAL" = onlineRoom > 0 ? "RAZORPAY" : "MANUAL";
  const base = lineTotal ?? (onlineRoom > 0 ? onlineRoom : remaining);
  const defaultAmount = Math.max(0, Math.min(base, defaultMethod === "RAZORPAY" ? onlineRoom : remaining));

  return (
    <Panel>
      <PanelHeader
        title="Refunds"
        description={`${formatINR(onlineRoom)} refundable via Razorpay · ${formatINR(remaining)} left of ${formatINR(order.totalInr)}`}
        actions={
          canRequest ? (
            <RequestRefundButton
              ticketId={ticketId}
              claimId={claim?.id ?? null}
              idempotencyKey={randomUUID()}
              defaultAmount={defaultAmount}
              defaultMethod={defaultMethod}
              onlineRoom={onlineRoom}
              remaining={remaining}
            />
          ) : undefined
        }
      />
      {refunds.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-admin-muted sm:px-5">No refunds for this order yet.</p>
      ) : (
        <ul className="divide-y divide-admin-line">
          {refunds.map((r) => {
            const meta = refundStatusMeta(r.status, r.method);
            return (
              <li key={r.id} className="px-4 py-3 text-[13px] sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums text-brand-ink">{formatINR(r.amountInr)}</span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {r.ticketId && r.ticketId !== ticketId && <Tag>Other ticket</Tag>}
                </div>
                <p className="mt-1 text-xs text-brand-ink-soft">{REFUND_METHOD_LABEL[r.method] ?? r.method}</p>
                <p className="mt-0.5 break-words text-xs text-admin-muted">{r.reason}</p>
                <dl className="mt-1.5 space-y-0.5 text-xs text-admin-muted">
                  <div>
                    Requested by {shortEmail(r.requestedBy)} · {formatDateTimeShort(r.createdAt)}
                  </div>
                  {r.approvedBy && (
                    <div>
                      Approved by {shortEmail(r.approvedBy)}
                      {r.approvedAt ? ` · ${formatDateTimeShort(r.approvedAt)}` : ""}
                    </div>
                  )}
                  {r.razorpayRefundId && (
                    <div>
                      Razorpay refund <span className="font-mono text-brand-ink">{r.razorpayRefundId}</span>
                      {r.providerStatus ? ` · ${r.providerStatus}` : ""}
                    </div>
                  )}
                  {r.manualReference && (
                    <div>
                      Transfer UTR <span className="font-mono text-brand-ink">{r.manualReference}</span> (recorded by finance)
                    </div>
                  )}
                  {r.providerConfirmedAt && r.method === "RAZORPAY" && <div>Razorpay confirmed {formatDateTimeShort(r.providerConfirmedAt)}</div>}
                  {r.failureReason && <div className="text-tone-neg">{r.failureReason}</div>}
                </dl>
                {canApprove && <RefundCaseActions refundId={r.id} ticketId={ticketId} status={r.status} method={r.method} amountInr={r.amountInr} />}
              </li>
            );
          })}
        </ul>
      )}
      {!canApprove && refunds.some((r) => r.status === "REQUESTED") && (
        <p className="border-t border-admin-line px-4 py-2.5 text-xs text-admin-muted sm:px-5">Approval and execution are done by the owner or finance.</p>
      )}
    </Panel>
  );
}

function ActivityPanel({ events, now }: { events: TicketDetail["events"]; now: Date }) {
  return (
    <Panel>
      <PanelHeader title="Activity" description="Audit trail · newest first" />
      {events.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-admin-muted sm:px-5">No activity yet.</p>
      ) : (
        <ol className="space-y-3 px-4 py-4 sm:px-5">
          {events.map((e) => {
            const payload = (e.payload && typeof e.payload === "object" ? e.payload : {}) as Record<string, unknown>;
            const detail = eventDetail(e.type, payload);
            return (
              <li key={e.id} className="relative pl-4">
                <span aria-hidden className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full bg-admin-line-strong" />
                <div className="flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 text-[13px] font-medium text-brand-ink">{eventLabel(e.type, payload)}</p>
                  <time className="shrink-0 text-[11px] tabular-nums text-admin-muted" title={formatDateTimeShort(e.createdAt)}>
                    {formatRelative(e.createdAt, now.getTime())}
                  </time>
                </div>
                <p className="text-xs text-admin-muted">{actorLabel(e.actor)}</p>
                {detail && <p className="mt-0.5 break-words text-xs leading-4 text-brand-ink-soft">{detail}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function PanelSkeleton({ title }: { title: string }) {
  return (
    <Panel aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
      <PanelHeader title={title} />
      <div className="space-y-2 p-4 sm:p-5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </Panel>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function actorLabel(actor: string): string {
  if (actor === "system") return "System";
  if (actor === "customer") return "Customer";
  if (actor === "webhook" || actor === "razorpay-api") return "Razorpay";
  return actor;
}

/** Readable lines from the ticket's hand-off context (troubleshooting tried, chat summary…). */
function contextLines(raw: unknown): Array<[string, string]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v == null || v === "" || k === "variantSlug") continue;
    const label = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    const nice = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
    let value: string;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") value = String(v);
    else if (Array.isArray(v)) value = v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" · ");
    else value = JSON.stringify(v);
    out.push([nice, value.length > 400 ? `${value.slice(0, 399)}…` : value]);
  }
  return out.slice(0, 12);
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

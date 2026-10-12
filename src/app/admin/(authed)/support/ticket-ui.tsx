/**
 * Display vocabulary for the admin support desk — ticket / claim / refund
 * status tones and labels, SLA wording, audit-event labels, and the two
 * "can't show this page" notices. Pure (no hooks, no DB), so both server
 * pages and client action components import it.
 */

import { Database, Lock } from "lucide-react";
import { TONE_TEXT, type Tone } from "@/lib/admin/status";
import {
  TICKET_CATEGORIES,
  TICKET_STATUS_LABEL_STAFF,
  isTicketStatus,
  type TicketCategory,
} from "@/lib/support/rules";
import { Badge } from "@/components/admin/Badge";
import { EmptyState } from "@/components/admin/EmptyState";
import { PageHeader } from "@/components/admin/PageHeader";
import { Panel } from "@/components/admin/Panel";

// ── Tickets ─────────────────────────────────────────────────────────────────

export const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const PRIORITY_LABEL: Record<string, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
const PRIORITY_TONE: Record<string, Tone> = { CRITICAL: "negative", HIGH: "attention", MEDIUM: "neutral", LOW: "neutral" };

const STATUS_TONE: Record<string, Tone> = {
  NEW: "attention",
  OPEN: "attention",
  REOPENED: "attention",
  ASSIGNED: "info",
  IN_PROGRESS: "info",
  RESOLUTION_PROPOSED: "info",
  AWAITING_CUSTOMER: "neutral",
  ESCALATED: "negative",
  RESOLVED: "positive",
  CLOSED: "neutral",
};

export function ticketStatusLabel(status: string): string {
  return isTicketStatus(status) ? TICKET_STATUS_LABEL_STAFF[status] : status;
}

export function categoryLabel(category: string): string {
  return TICKET_CATEGORIES[category as TicketCategory]?.label ?? category;
}

export function TicketStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{ticketStatusLabel(status)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? "neutral"}>{PRIORITY_LABEL[priority] ?? priority}</Badge>;
}

/** "45m", "1h 12m", "3d 4h". */
export function formatDuration(ms: number): string {
  const min = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h}h ${min % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

type SlaInput = {
  status: string;
  firstResponseAt: Date | null;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  resolvedAt: Date | null;
};

/**
 * The SLA clock that matters right now: first reply until we've answered,
 * then resolution. Resolved/closed tickets report whether the target was met.
 */
export function slaState(t: SlaInput, now: Date): { label: string; tone: Tone; breached: boolean } | null {
  if (t.status === "RESOLVED" || t.status === "CLOSED") {
    if (!t.resolvedAt || !t.resolutionDueAt) return null;
    const met = t.resolvedAt <= t.resolutionDueAt;
    return { label: met ? "Resolved within SLA" : "Resolved late", tone: met ? "positive" : "negative", breached: !met };
  }
  if (!t.firstResponseAt && t.firstResponseDueAt) {
    const left = t.firstResponseDueAt.getTime() - now.getTime();
    if (left < 0) return { label: `Reply overdue ${formatDuration(left)}`, tone: "negative", breached: true };
    return { label: `Reply due in ${formatDuration(left)}`, tone: left < 3_600_000 ? "attention" : "neutral", breached: false };
  }
  if (t.resolutionDueAt) {
    const left = t.resolutionDueAt.getTime() - now.getTime();
    if (left < 0) return { label: `Resolution overdue ${formatDuration(left)}`, tone: "negative", breached: true };
    return { label: `Resolve in ${formatDuration(left)}`, tone: left < 3_600_000 ? "attention" : "neutral", breached: false };
  }
  return null;
}

/** SLA wording colour: neutral reads as secondary ink, the rest use their tone. */
export function slaTextClass(tone: Tone | undefined): string {
  if (!tone) return "text-admin-muted";
  return tone === "neutral" ? "text-brand-ink-soft" : TONE_TEXT[tone];
}

/** "98••• ••102" — list views show enough to recognise a caller, not the number. */
export function maskPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 ? `${ten.slice(0, 2)}••• ••${ten.slice(7)}` : `••••${ten.slice(-3)}`;
}

/** "priya" from "priya@pocketrccars.com" — short assignee labels. */
export function shortEmail(email: string | null | undefined): string {
  return email ? email.split("@")[0] : "";
}

// ── Claims ──────────────────────────────────────────────────────────────────

export const CLAIM_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  SUBMITTED: { label: "Submitted", tone: "attention" },
  UNDER_REVIEW: { label: "Under review", tone: "info" },
  NEEDS_INFO: { label: "Needs info", tone: "attention" },
  APPROVED: { label: "Approved", tone: "positive" },
  REJECTED: { label: "Rejected", tone: "negative" },
  RETURN_IN_TRANSIT: { label: "Return in transit", tone: "info" },
  RECEIVED: { label: "Return received", tone: "info" },
  REPLACEMENT_SHIPPED: { label: "Replacement shipped", tone: "info" },
  COMPLETED: { label: "Completed", tone: "positive" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const CLAIM_REASON_LABEL: Record<string, string> = {
  TRANSIT_DAMAGE: "Damaged in transit",
  MANUFACTURING_DEFECT: "Manufacturing defect",
  WRONG_ITEM: "Wrong item",
  MISSING_ACCESSORY: "Missing item / accessory",
  CHANGE_OF_MIND: "Change of mind",
};

export function ClaimStatusBadge({ status }: { status: string }) {
  const m = CLAIM_STATUS_META[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

// ── Refunds ─────────────────────────────────────────────────────────────────

export const REFUND_METHOD_LABEL: Record<string, string> = {
  RAZORPAY: "Razorpay — original payment",
  MANUAL: "Bank/UPI transfer recorded by finance",
};

/**
 * PROCESSED reads differently per method: a Razorpay refund is confirmed by
 * Razorpay; a MANUAL one only means finance recorded a transfer reference.
 */
export function refundStatusMeta(status: string, method: string): { label: string; tone: Tone } {
  switch (status) {
    case "REQUESTED":
      return { label: "Awaiting approval", tone: "attention" };
    case "APPROVED":
      return { label: method === "MANUAL" ? "Approved — transfer pending" : "Approved", tone: "info" };
    case "PROCESSING":
      return { label: "Sent to Razorpay — awaiting confirmation", tone: "info" };
    case "PROCESSED":
      return method === "MANUAL"
        ? { label: "Transfer recorded by finance", tone: "positive" }
        : { label: "Confirmed by Razorpay", tone: "positive" };
    case "FAILED":
      return { label: "Failed", tone: "negative" };
    case "REJECTED":
      return { label: "Rejected", tone: "neutral" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

// ── Audit events ────────────────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Ticket created",
  PRIORITY_SET: "Priority set by rule",
  PRIORITY_CHANGED: "Priority changed",
  ESCALATED: "Escalated",
  ASSIGNED: "Assignment changed",
  STATUS_CHANGED: "Status changed",
  STAFF_REPLIED: "Staff replied",
  INTERNAL_NOTE: "Internal note added",
  CUSTOMER_REPLIED: "Customer replied",
  REOPENED: "Reopened by customer",
  RESOLVED_BY_CUSTOMER: "Marked solved by customer",
  AUTO_CLOSED: "Closed automatically",
  CLAIM_CREATED: "Claim created",
  CLAIM_DECIDED: "Claim decision",
  CLAIM_SHIPMENT: "Claim shipment recorded",
  RETURN_RECEIVED: "Return received",
  CLAIM_COMPLETED: "Claim completed",
  REFUND_REQUESTED: "Refund requested",
  REFUND_APPROVED: "Refund approved",
  REFUND_INITIATED: "Refund sent to Razorpay",
  REFUND_CONFIRMED: "Refund confirmed",
  REFUND_FAILED: "Refund failed",
  REFUND_OUTCOME_UNKNOWN: "Refund outcome unknown",
  REFUND_REJECTED: "Refund rejected",
  REFUND_RECONCILED: "Refund checked with Razorpay",
};

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const inr = (v: unknown) => (typeof v === "number" ? `₹${v.toLocaleString("en-IN")}` : "");

export function eventLabel(type: string, payload: Record<string, unknown>): string {
  if (type === "ASSIGNED") return payload.to ? "Assigned" : "Unassigned";
  return EVENT_LABEL[type] ?? type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " ");
}

/** One plain line of detail from an event payload (never raw JSON). */
export function eventDetail(type: string, p: Record<string, unknown>): string | null {
  switch (type) {
    case "CREATED":
      return [categoryLabel(str(p.category)), p.channel ? `via ${str(p.channel).toLowerCase()}` : "", p.verified ? "verified" : "unverified"]
        .filter(Boolean)
        .join(" · ");
    case "PRIORITY_SET":
      return [PRIORITY_LABEL[str(p.priority)], str(p.reason)].filter(Boolean).join(" — ");
    case "PRIORITY_CHANGED":
      return `${PRIORITY_LABEL[str(p.from)] ?? str(p.from)} → ${PRIORITY_LABEL[str(p.to)] ?? str(p.to)}${p.reason ? ` — ${str(p.reason)}` : ""}`;
    case "ESCALATED":
      return str(p.reason) || null;
    case "ASSIGNED":
      return p.to ? `to ${str(p.to)}` : null;
    case "STATUS_CHANGED":
      return `${ticketStatusLabel(str(p.from))} → ${ticketStatusLabel(str(p.to))}${p.note ? ` — ${str(p.note)}` : ""}`;
    case "STAFF_REPLIED":
      return p.status ? `Status: ${ticketStatusLabel(str(p.status))}` : null;
    case "CUSTOMER_REPLIED":
    case "REOPENED":
      return typeof p.files === "number" && p.files > 0 ? `${p.files} file${p.files === 1 ? "" : "s"} attached` : null;
    case "CLAIM_CREATED":
      return [str(p.claim), p.eligible ? "within policy" : "outside policy / needs review", p.missingEvidence ? "evidence missing" : ""]
        .filter(Boolean)
        .join(" · ");
    case "CLAIM_DECIDED":
      return [str(p.claim), str(p.decision).toLowerCase().replace(/_/g, " "), p.overrideStock ? "stock override" : "", str(p.note)]
        .filter(Boolean)
        .join(" · ");
    case "CLAIM_SHIPMENT":
      return [str(p.claim), p.awb ? `AWB ${str(p.awb)}` : "", p.replacementOrderId ? `order ${str(p.replacementOrderId)}` : ""]
        .filter(Boolean)
        .join(" · ");
    case "RETURN_RECEIVED":
      return [str(p.claim), str(p.condition)].filter(Boolean).join(" · ");
    case "CLAIM_COMPLETED":
      return str(p.claim) || null;
    default:
      if (type.startsWith("REFUND_")) {
        return [
          inr(p.amountInr),
          p.method ? REFUND_METHOD_LABEL[str(p.method)] ?? str(p.method) : "",
          p.refundId ? `Razorpay ${str(p.refundId)}` : "",
          p.manualReference ? `UTR ${str(p.manualReference)}` : "",
          p.providerStatus ? `status ${str(p.providerStatus)}` : "",
          str(p.reason),
          p.error && p.error !== "unknown" ? str(p.error) : "",
        ]
          .filter(Boolean)
          .join(" · ") || null;
      }
      return null;
  }
}

// ── Notices ─────────────────────────────────────────────────────────────────

export const SUPPORT_MIGRATION = "src/db/migrations/manual/2026-10-09_support_centre.sql";

export function SupportSetupNotice({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Panel>
        <EmptyState
          icon={Database}
          title="The support centre isn't set up yet"
          description={
            <>
              Apply <span className="font-mono text-xs">{SUPPORT_MIGRATION}</span> (and the shipment tracking migration) to the
              database, then reload this page.
            </>
          }
        />
      </Panel>
    </>
  );
}

export function NoAccessNotice({ title, what = "the support desk" }: { title: string; what?: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Panel>
        <EmptyState icon={Lock} title="No access" description={`Your role can't open ${what}. Ask an owner if you need it.`} />
      </Panel>
    </>
  );
}

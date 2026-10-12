/**
 * Support rules — pure, dependency-free, unit-tested (scripts/tests/support.test.ts).
 *
 *   - ticket categories and statuses (with customer wording)
 *   - PRIORITY by documented operational rules, never by guesswork
 *   - SLA due dates counted in support hours (10:00–20:00 IST by default)
 *   - return / replacement ELIGIBILITY from the published PRC policy
 *
 * The policy defaults below transcribe /policies/replacement and
 * /policies/refund (src/lib/policies.ts, updated 2026-06-02). Ops can edit the
 * operational values in /admin/support/settings; commercial terms that
 * conflict elsewhere on the site are listed in POLICY_INCONSISTENCIES for the
 * owner to decide — they are NOT silently resolved here.
 */

import { IST_OFFSET_MS } from "@/lib/tz";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type PolicyReason =
  | "TRANSIT_DAMAGE"
  | "MANUFACTURING_DEFECT"
  | "WRONG_ITEM"
  | "MISSING_ACCESSORY"
  | "CHANGE_OF_MIND";

export type EvidenceRule = "REQUIRED" | "RECOMMENDED" | "NONE";

type CategoryDef = {
  label: string;
  group: "DELIVERY" | "PRODUCT" | "RETURNS" | "MONEY" | "OTHER";
  /** Must be raised against a verified order. */
  needsOrder: boolean;
  evidence: EvidenceRule;
  /** Policy reason when this category can become a return/replacement claim. */
  claimReason: PolicyReason | null;
  hint: string;
};

export const TICKET_CATEGORIES = {
  ORDER_NOT_RECEIVED: { label: "Order not received", group: "DELIVERY", needsOrder: true, evidence: "NONE", claimReason: null, hint: "The parcel hasn't reached you." },
  DELIVERY_DELAYED: { label: "Delivery delayed", group: "DELIVERY", needsOrder: true, evidence: "NONE", claimReason: null, hint: "It's taking longer than expected." },
  INCORRECT_TRACKING: { label: "Incorrect tracking", group: "DELIVERY", needsOrder: true, evidence: "RECOMMENDED", claimReason: null, hint: "Tracking says something that isn't true, e.g. delivered but not received." },
  WRONG_ITEM: { label: "Wrong item received", group: "PRODUCT", needsOrder: true, evidence: "REQUIRED", claimReason: "WRONG_ITEM", hint: "A different car or colour arrived." },
  MISSING_ITEM: { label: "Missing item", group: "PRODUCT", needsOrder: true, evidence: "REQUIRED", claimReason: "MISSING_ACCESSORY", hint: "Something from the box or order is missing." },
  DAMAGED_PRODUCT: { label: "Damaged product", group: "PRODUCT", needsOrder: true, evidence: "REQUIRED", claimReason: "TRANSIT_DAMAGE", hint: "Cracked, broken or damaged on arrival." },
  PRODUCT_NOT_WORKING: { label: "Product not working", group: "PRODUCT", needsOrder: true, evidence: "RECOMMENDED", claimReason: "MANUFACTURING_DEFECT", hint: "Won't power on, move or steer." },
  BATTERY_CHARGING: { label: "Battery or charging problem", group: "PRODUCT", needsOrder: true, evidence: "RECOMMENDED", claimReason: "MANUFACTURING_DEFECT", hint: "Won't charge or the battery runs out very fast." },
  REMOTE_CONNECTION: { label: "Remote connection issue", group: "PRODUCT", needsOrder: true, evidence: "RECOMMENDED", claimReason: "MANUFACTURING_DEFECT", hint: "The remote won't pair or keeps disconnecting." },
  REPLACEMENT_REQUEST: { label: "Replacement request", group: "RETURNS", needsOrder: true, evidence: "REQUIRED", claimReason: "MANUFACTURING_DEFECT", hint: "You want a replacement unit." },
  RETURN_REQUEST: { label: "Return request", group: "RETURNS", needsOrder: true, evidence: "NONE", claimReason: "CHANGE_OF_MIND", hint: "Unopened and you've changed your mind." },
  REFUND_STATUS: { label: "Refund status", group: "MONEY", needsOrder: true, evidence: "NONE", claimReason: null, hint: "Where is my refund?" },
  PAYMENT_ISSUE: { label: "Payment issue", group: "MONEY", needsOrder: false, evidence: "RECOMMENDED", claimReason: null, hint: "Failed, double or wrong payment." },
  SPARE_PARTS: { label: "Spare parts request", group: "OTHER", needsOrder: false, evidence: "NONE", claimReason: null, hint: "Wheels, batteries, shells, remotes." },
  GENERAL: { label: "General enquiry", group: "OTHER", needsOrder: false, evidence: "NONE", claimReason: null, hint: "Anything else." },
} as const satisfies Record<string, CategoryDef>;

export type TicketCategory = keyof typeof TICKET_CATEGORIES;
export const CATEGORY_KEYS = Object.keys(TICKET_CATEGORIES) as TicketCategory[];
export const isCategory = (s: string): s is TicketCategory => s in TICKET_CATEGORIES;

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const TICKET_STATUSES = [
  "NEW",
  "AWAITING_CUSTOMER",
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "ESCALATED",
  "RESOLUTION_PROPOSED",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const isTicketStatus = (s: string): s is TicketStatus => (TICKET_STATUSES as readonly string[]).includes(s);

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "New",
  AWAITING_CUSTOMER: "Awaiting your reply",
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  ESCALATED: "Escalated",
  RESOLUTION_PROPOSED: "Resolution proposed",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
};

/** Staff-facing wording differs only where the customer view is phrased for them. */
export const TICKET_STATUS_LABEL_STAFF: Record<TicketStatus, string> = {
  ...TICKET_STATUS_LABEL,
  AWAITING_CUSTOMER: "Awaiting customer",
};

/** Customer progress strip: Received → Reviewing → Resolution proposed → Resolved. */
export function customerStage(status: TicketStatus): 0 | 1 | 2 | 3 {
  if (status === "RESOLVED" || status === "CLOSED") return 3;
  if (status === "RESOLUTION_PROPOSED") return 2;
  if (status === "NEW") return 0;
  return 1;
}

export const OPEN_STATUSES: readonly TicketStatus[] = [
  "NEW",
  "AWAITING_CUSTOMER",
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "ESCALATED",
  "RESOLUTION_PROPOSED",
  "REOPENED",
];

/**
 * Allowed staff transitions. RESOLVED → CLOSED happens automatically after the
 * reopen window; CLOSED is final (a new ticket is raised instead).
 */
const STAFF_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  NEW: ["OPEN", "ASSIGNED", "IN_PROGRESS", "AWAITING_CUSTOMER", "ESCALATED", "RESOLUTION_PROPOSED", "RESOLVED", "CLOSED"],
  OPEN: ["ASSIGNED", "IN_PROGRESS", "AWAITING_CUSTOMER", "ESCALATED", "RESOLUTION_PROPOSED", "RESOLVED", "CLOSED"],
  ASSIGNED: ["OPEN", "IN_PROGRESS", "AWAITING_CUSTOMER", "ESCALATED", "RESOLUTION_PROPOSED", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["OPEN", "AWAITING_CUSTOMER", "ESCALATED", "RESOLUTION_PROPOSED", "RESOLVED", "CLOSED"],
  AWAITING_CUSTOMER: ["OPEN", "IN_PROGRESS", "ESCALATED", "RESOLUTION_PROPOSED", "RESOLVED", "CLOSED"],
  ESCALATED: ["IN_PROGRESS", "AWAITING_CUSTOMER", "RESOLUTION_PROPOSED", "RESOLVED", "CLOSED"],
  RESOLUTION_PROPOSED: ["IN_PROGRESS", "AWAITING_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED"],
  RESOLVED: ["REOPENED", "CLOSED"],
  REOPENED: ["IN_PROGRESS", "AWAITING_CUSTOMER", "ESCALATED", "RESOLUTION_PROPOSED", "RESOLVED", "CLOSED"],
  CLOSED: [],
};

export function canStaffMove(from: TicketStatus, to: TicketStatus): boolean {
  return STAFF_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Priority — documented rules, first match wins
// ---------------------------------------------------------------------------

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const SAFETY_WORDS = /\b(smok\w*|fire|burn\w*|swell\w*|swollen|spark\w*|melt\w*|overheat\w*|too hot|very hot|explod\w*|leak\w*)\b/i;

/** True when the description reports a possible battery/electrical safety hazard. */
export function mentionsSafetyHazard(text: string): boolean {
  return SAFETY_WORDS.test(text);
}

export type PriorityInput = {
  category: TicketCategory;
  description: string;
  /** Customer ticked "heat, smoke, swelling or burning smell". */
  safetyFlag: boolean;
  /** Courier shows the order delivered (for "not received" claims). */
  trackingDelivered?: boolean;
  /** The delivery estimate has passed. */
  estimateExpired?: boolean;
};

/**
 * PRIORITY RULES (shown to staff as `priority_reason`):
 *   CRITICAL  possible safety hazard (customer flag or hazard words)
 *   CRITICAL  "not received" while the courier says delivered
 *   HIGH      damaged / wrong / missing item, payment issue
 *   HIGH      delivery complaints once the estimate has passed
 *   MEDIUM    product faults, returns/replacements, refunds, other delivery issues
 *   LOW       spare parts, general enquiries
 */
export function computePriority(p: PriorityInput): { priority: Priority; reason: string } {
  if (p.safetyFlag || mentionsSafetyHazard(p.description)) {
    return { priority: "CRITICAL", reason: "Possible safety hazard reported (heat, smoke, swelling or burning)" };
  }
  if ((p.category === "ORDER_NOT_RECEIVED" || p.category === "INCORRECT_TRACKING") && p.trackingDelivered) {
    return { priority: "CRITICAL", reason: "Courier shows delivered but the customer reports not received" };
  }
  switch (p.category) {
    case "DAMAGED_PRODUCT":
    case "WRONG_ITEM":
    case "MISSING_ITEM":
      return { priority: "HIGH", reason: `${TICKET_CATEGORIES[p.category].label} — fixed rule` };
    case "PAYMENT_ISSUE":
      return { priority: "HIGH", reason: "Payment problem — money may be held" };
    case "ORDER_NOT_RECEIVED":
    case "DELIVERY_DELAYED":
      return p.estimateExpired
        ? { priority: "HIGH", reason: "Delivery estimate has already passed" }
        : { priority: "MEDIUM", reason: "Delivery question within the estimate" };
    case "SPARE_PARTS":
    case "GENERAL":
      return { priority: "LOW", reason: `${TICKET_CATEGORIES[p.category].label} — fixed rule` };
    default:
      return { priority: "MEDIUM", reason: `${TICKET_CATEGORIES[p.category].label} — fixed rule` };
  }
}

const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
export const higherPriority = (a: Priority, b: Priority): Priority => (PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b);

// ---------------------------------------------------------------------------
// SLA — counted in support hours (IST)
// ---------------------------------------------------------------------------

export type SlaConfig = {
  supportStartHour: number;
  supportEndHour: number;
  /** Support hours to first reply / to resolution, per priority. */
  firstResponseHours: Record<Priority, number>;
  resolutionHours: Record<Priority, number>;
};

/**
 * Defaults: the published promise is "we reply within 4 hours, 10 AM to 8 PM
 * IST" — that is the MEDIUM first-response target. Resolution targets are
 * internal goals, editable in settings.
 */
export const DEFAULT_SLA: SlaConfig = {
  supportStartHour: 10,
  supportEndHour: 20,
  firstResponseHours: { CRITICAL: 1, HIGH: 2, MEDIUM: 4, LOW: 8 },
  resolutionHours: { CRITICAL: 10, HIGH: 20, MEDIUM: 30, LOW: 50 },
};

/** Add `hours` of support time (start–end IST, every day) to `from`. */
export function addSupportHours(from: Date, hours: number, sla: Pick<SlaConfig, "supportStartHour" | "supportEndHour">): Date {
  const { supportStartHour: s, supportEndHour: e } = sla;
  let remaining = hours * 3_600_000;
  // Work in IST wall-clock by shifting, then shift back.
  let t = from.getTime() + IST_OFFSET_MS;
  for (let guard = 0; guard < 400 && remaining > 0; guard++) {
    const day = new Date(t);
    const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), s);
    const dayEnd = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), e);
    if (t < dayStart) t = dayStart;
    if (t >= dayEnd) {
      t = dayStart + 86_400_000;
      continue;
    }
    const take = Math.min(remaining, dayEnd - t);
    t += take;
    remaining -= take;
    if (remaining > 0) t = dayStart + 86_400_000;
  }
  return new Date(t - IST_OFFSET_MS);
}

export function slaDueDates(priority: Priority, from: Date, sla: SlaConfig = DEFAULT_SLA) {
  return {
    firstResponseDueAt: addSupportHours(from, sla.firstResponseHours[priority], sla),
    resolutionDueAt: addSupportHours(from, sla.resolutionHours[priority], sla),
  };
}

// ---------------------------------------------------------------------------
// Return / replacement policy
// ---------------------------------------------------------------------------

export type SupportPolicy = {
  replacementWindowDays: number;
  returnWindowDays: number;
  /** Reasons that qualify for a free replacement. */
  replacementReasons: PolicyReason[];
  evidence: Record<PolicyReason, EvidenceRule>;
  notCovered: string[];
  returnConditions: string;
  /** Change-of-mind deduction, as published ("₹100 forward + return shipping"). */
  changeOfMindDeduction: string;
  returnShipping: string;
  /** Customer keeps the faulty unit for replacements (published policy). */
  replacementNeedsReturn: boolean;
  refundTimeline: { inspection: string; prepaid: string; cod: string };
  maxEvidenceFiles: number;
  maxEvidenceMb: number;
};

export const DEFAULT_POLICY: SupportPolicy = {
  replacementWindowDays: 7,
  returnWindowDays: 7,
  replacementReasons: ["TRANSIT_DAMAGE", "MANUFACTURING_DEFECT", "WRONG_ITEM", "MISSING_ACCESSORY"],
  evidence: {
    TRANSIT_DAMAGE: "REQUIRED",
    MANUFACTURING_DEFECT: "REQUIRED",
    WRONG_ITEM: "REQUIRED",
    MISSING_ACCESSORY: "REQUIRED",
    CHANGE_OF_MIND: "NONE",
  },
  notCovered: [
    "Damage from misuse — water, drops from above 1.5 m, modifications, objects jammed in the gears",
    "Normal wear after the 7-day window — shell scuffs, worn wheels, battery capacity loss",
    "Items lost or stolen after delivery confirmation",
  ],
  returnConditions: "Unopened and unused, in the original gift box",
  changeOfMindDeduction: "₹100 forward + return shipping",
  returnShipping: "Free for defective items; deducted for change-of-mind returns",
  replacementNeedsReturn: false,
  refundTimeline: {
    inspection: "1–2 working days after the return reaches us",
    prepaid: "5–7 working days to the original payment method",
    cod: "3–5 working days to your bank account or UPI ID",
  },
  maxEvidenceFiles: 5,
  maxEvidenceMb: 20,
};

/**
 * Conflicts found while building the support centre. Shown in the admin
 * settings page; each needs an owner decision, none is changed silently.
 */
export const POLICY_INCONSISTENCIES: string[] = [
  "Replacement policy says you keep the faulty unit (no return courier); the home FAQ says we 'arrange pickup'.",
  "Policy evidence is 'a photo or short video'; some pages ask for an 'unboxing clip'.",
  "The COD confirmation fee is non-refundable after dispatch (checkout copy) — this is not stated in the refund policy.",
  "Cancel window: refund policy says 'typically within 4 hours'; order emails say 'within 2 hrs'.",
  "Delivery windows differ: policy 2–3 / 4–7 / 7–10 days, FAQ 2–4 / 4–7 days, PRC estimate rule 2–3 / 3–5 days.",
  "Spares dispatch: policy 3 working days, FAQ 48 hrs, order page 24 hrs.",
  "Pages name the warehouse 'Yelahanka'; the courier pickup location is 'Allalasandra' since 1 Oct 2026.",
];

export type Eligibility = {
  eligible: boolean;
  claimType: "REPLACEMENT" | "RETURN" | null;
  reason: PolicyReason | null;
  deliveredAt: string | null;
  daysSinceDelivery: number | null;
  windowDays: number | null;
  evidence: EvidenceRule;
  /** One plain sentence for the customer. */
  message: string;
  /** Extra conditions the customer must confirm (e.g. unopened). */
  conditions: string[];
};

function istDayNumber(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / 86_400_000);
}

/**
 * Policy check for a claim. Never approves anything — it tells the customer
 * where they stand and gives staff a snapshot. Staff decide.
 */
export function checkEligibility(input: {
  category: TicketCategory;
  orderStatus: string;
  deliveredAt: Date | null;
  now: Date;
  policy?: SupportPolicy;
}): Eligibility {
  const policy = input.policy ?? DEFAULT_POLICY;
  const reason = TICKET_CATEGORIES[input.category].claimReason;
  const base: Eligibility = {
    eligible: false,
    claimType: null,
    reason,
    deliveredAt: input.deliveredAt?.toISOString() ?? null,
    daysSinceDelivery: null,
    windowDays: null,
    evidence: reason ? policy.evidence[reason] : "NONE",
    message: "",
    conditions: [],
  };
  if (!reason) return { ...base, message: "This request isn't a return or replacement claim." };

  const claimType = reason === "CHANGE_OF_MIND" ? "RETURN" : "REPLACEMENT";
  const windowDays = claimType === "RETURN" ? policy.returnWindowDays : policy.replacementWindowDays;
  const out = { ...base, claimType, windowDays } as Eligibility;
  if (claimType === "RETURN") {
    out.conditions = [policy.returnConditions, `Refund less ${policy.changeOfMindDeduction}`];
  }

  if (!input.deliveredAt || input.orderStatus !== "DELIVERED") {
    return {
      ...out,
      message:
        "This order isn't marked delivered yet, so we can't check the return window. Our team will review your request.",
    };
  }
  const days = istDayNumber(input.now) - istDayNumber(input.deliveredAt);
  out.daysSinceDelivery = days;
  if (days > windowDays) {
    return {
      ...out,
      message: `Delivered ${days} days ago — outside the ${windowDays}-day window. Our team will still review it, and spare parts are available.`,
    };
  }
  if (claimType === "REPLACEMENT" && !policy.replacementReasons.includes(reason)) {
    return { ...out, message: "This reason isn't covered by the replacement policy. Our team will review it." };
  }
  return {
    ...out,
    eligible: true,
    message:
      claimType === "RETURN"
        ? `Delivered ${days} day${days === 1 ? "" : "s"} ago — within the ${windowDays}-day return window if the item is unopened.`
        : `Delivered ${days} day${days === 1 ? "" : "s"} ago — within the ${windowDays}-day replacement window.`,
  };
}

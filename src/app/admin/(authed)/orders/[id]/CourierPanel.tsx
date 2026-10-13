import type { orders } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { Badge, Tag } from "@/components/admin/Badge";
import { KeyValue, Panel, PanelBody, PanelHeader } from "@/components/admin/Panel";
import { asCourierProvider, COURIER_PROVIDER_LABEL, courierBookingRef, COURIER_PROVIDERS } from "@/lib/couriers";
import type { ProviderAssessment, RoutingRecord } from "@/lib/couriers/routing";
import { readRoutingState } from "@/lib/couriers/routing-state";
import { loadCourierSettings } from "@/lib/couriers/settings";
import { formatIstDateTime } from "@/lib/tracking/time";
import { CourierActions } from "./CourierActions";

const inr = (paise: number | null | undefined) => (paise == null ? "—" : `₹${(paise / 100).toFixed(2)}`);

const MODE_LABEL: Record<string, string> = {
  off: "Routing off",
  shadow: "Shadow (recommend only)",
  manual: "Staff-controlled",
  auto: "Automatic",
};

/**
 * How this order is (or will be) booked: provider, the routing engine's
 * verdict with each provider's serviceability and quote, quoted vs billed
 * cost, pickup state, and the staff controls. Courier scans, sync health and
 * the estimate live in TrackingPanel right below.
 */
export async function CourierPanel({ order }: { order: typeof orders.$inferSelect }) {
  const ctx = await requireAdmin();
  const settings = await loadCourierSettings();
  const state = readRoutingState(order.courierRouting);
  const provider = asCourierProvider(order.courierProvider);
  const ref = courierBookingRef(order);
  const verdict: RoutingRecord | undefined = state.recheck ?? state.decision;
  const canBook = can(ctx.role, "shipping.book");
  const canCosts = can(ctx.role, "shipping.costs");
  const preAwb = (order.status === "PAID" || order.status === "PACKED") && !order.awbCode;

  // A Shiprocket parcel with an AWB that the courier hasn't collected yet can
  // be moved to Delhivery (the Shiprocket booking is cancelled first).
  const movable =
    provider === "shiprocket" && !!order.awbCode && order.status === "PACKED" && !order.shippedAt &&
    settings.mode !== "off" && settings.delhiveryEnabled;

  const bookable = preAwb && settings.mode !== "off"
    ? COURIER_PROVIDERS.filter((p) => (p === "delhivery" ? settings.delhiveryEnabled : settings.shiprocketEnabled))
        .filter((p) => !(p === "shiprocket" && ref && provider === "shiprocket"))
        .map((p) => ({ provider: p, label: COURIER_PROVIDER_LABEL[p], recommended: verdict?.recommended === p }))
    : movable
      ? [{ provider: "delhivery", label: COURIER_PROVIDER_LABEL.delhivery, recommended: true, move: true }]
      : [];

  return (
    <Panel>
      <PanelHeader
        title="Courier"
        description={`${MODE_LABEL[settings.mode] ?? settings.mode}${settings.delhiveryEnabled ? "" : " · Delhivery booking off"}`}
      />
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 sm:px-5">
        <Badge tone={ref ? "positive" : "neutral"}>{ref ? `Booked · ${COURIER_PROVIDER_LABEL[provider]}` : "Not booked"}</Badge>
        {state.override && <Tag>Staff chose {COURIER_PROVIDER_LABEL[state.override.provider]}</Tag>}
        {state.booking?.state === "attempting" && <Tag>Delhivery booking being confirmed</Tag>}
      </div>
      {state.held && (
        <PanelBody>
          <p className="rounded-md bg-tone-warn-bg px-3 py-2 text-[13px] text-tone-warn">
            Waiting for staff since {formatIstDateTime(new Date(state.held.since))}: {state.held.reason}
          </p>
        </PanelBody>
      )}
      <div className="mt-2">
        <KeyValue
          items={[
            { label: "Booking ref", value: <span className="font-mono text-xs">{ref ?? "—"}</span> },
            {
              label: "Quoted / billed",
              // The booked provider's quote is stored at booking; before that the
              // quotes are the routing rows below, not a cost of this order.
              value:
                !ref && order.courierQuotedPaise == null ? (
                  "Not booked yet"
                ) : (
                  <>
                    {order.courierQuotedPaise != null ? `${inr(order.courierQuotedPaise)} quoted` : "No quote stored"} ·{" "}
                    {order.courierBilledPaise != null ? `${inr(order.courierBilledPaise)} billed` : "billed not recorded"}
                  </>
                ),
            },
            {
              label: "Routing",
              value: verdict ? (
                <>
                  <span className="font-semibold">
                    {verdict.recommended ? COURIER_PROVIDER_LABEL[verdict.recommended] : "Staff review"}
                  </span>{" "}
                  — {verdict.reason}
                  {verdict.hypothetical ? " (shadow: as if Delhivery were enabled)" : ""}
                  <span className="block text-xs text-admin-muted">
                    {state.recheck ? "Rechecked" : "Decided"} {formatIstDateTime(new Date(verdict.evaluatedAt))}
                    {verdict.savingsPaise != null ? ` · ${inr(verdict.savingsPaise)} vs the alternative (like-for-like)` : ""}
                  </span>
                </>
              ) : (
                "Not evaluated (booked before routing, or routing off)"
              ),
            },
            {
              label: "Pickup",
              value: order.pickupScheduledAt
                ? `Requested ${formatIstDateTime(order.pickupScheduledAt)}`
                : order.manifestedAt
                  ? `Ready since ${formatIstDateTime(order.manifestedAt)} — not requested`
                  : "Not requested",
            },
          ]}
        />
      </div>
      {verdict && (
        <PanelBody>
          <ul className="space-y-1.5 text-[13px]">
            {verdict.assessments.map((a) => (
              <AssessmentRow key={a.provider} a={a} reason={verdict.eligibility.find((e) => e.provider === a.provider)?.reason ?? null} />
            ))}
          </ul>
        </PanelBody>
      )}
      {(canBook || canCosts) && (
        <PanelBody>
          <CourierActions
            orderId={order.id}
            canBook={canBook}
            canCosts={canCosts}
            bookable={bookable}
            hasAwb={!!order.awbCode}
            billedInr={order.courierBilledPaise != null ? order.courierBilledPaise / 100 : null}
          />
        </PanelBody>
      )}
    </Panel>
  );
}

function AssessmentRow({ a, reason }: { a: ProviderAssessment; reason: string | null }) {
  const q = a.quote;
  const service =
    a.serviceable === null ? "serviceability unknown" : a.serviceable ? (a.codAvailable ? "serves · COD ok" : "serves · no COD") : "doesn't serve";
  const parts = q
    ? [
        q.components.freightPaise != null ? `freight ${inr(q.components.freightPaise)}` : null,
        q.components.codPaise ? `COD ${inr(q.components.codPaise)}` : null,
        q.components.fuelPaise ? `fuel ${inr(q.components.fuelPaise)}` : null,
        q.components.otherPaise ? `other ${inr(q.components.otherPaise)}` : null,
        q.components.taxPaise ? `GST ${inr(q.components.taxPaise)}` : null,
      ].filter(Boolean)
    : [];
  return (
    <li className="rounded-md border border-admin-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-semibold">{COURIER_PROVIDER_LABEL[a.provider]}</span>
        <span className="text-admin-muted">{service}</span>
        {q && (
          <span>
            {inr(q.totalPaise)}
            {q.taxIncluded === true ? " incl. GST" : q.taxIncluded === false ? " excl. GST" : " (GST not stated)"}
            {q.courierName && q.courierName !== "Delhivery" ? ` · ${q.courierName}` : ""}
            {q.mode ? ` · ${q.mode}` : ""}
          </span>
        )}
        <Tag>{q ? `${q.confidence} quote` : "no quote"}</Tag>
      </div>
      {parts.length > 0 && <div className="text-xs text-admin-muted">{parts.join(" · ")}</div>}
      {reason && <div className="text-xs text-tone-neg">{reason}</div>}
    </li>
  );
}

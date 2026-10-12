import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { formatDateTimeShort } from "@/lib/admin/format";
import { can, ROLE_LABEL, type AdminRole } from "@/lib/admin/permissions";
import { loadNoticeConfig, NOTICE_KINDS, NOTICE_LABEL } from "@/lib/notifications/customer-notice";
import { getSetting } from "@/lib/settings";
import { isMissingTableError, listAdmins, settingsMeta } from "@/lib/support/admin-queries";
import { loadPolicy, loadSla } from "@/lib/support/config";
import { POLICY_INCONSISTENCIES } from "@/lib/support/rules";
import { DEFAULT_TRACKING_CONFIG, resolveTrackingConfig, trackingConfigSchema, type TrackingConfig } from "@/lib/tracking/config";
import { PageHeader } from "@/components/admin/PageHeader";
import { Panel, PanelHeader } from "@/components/admin/Panel";
import { NoAccessNotice, shortEmail } from "../ticket-ui";
import { NoticeForm, PolicyForm, SlaForm, TrackingForm, type TrackingField } from "./SettingsForms";
import { TeamRoles } from "./TeamRoles";

/** Labels, units and groups for every tracking setting (limits come from the zod schema). */
const TRACKING_META: Record<keyof TrackingConfig, { label: string; unit: string; group: string; hint?: string }> = {
  awaitingIntervalMin: { label: "Poll while awaiting AWB / pickup", unit: "min", group: "Polling" },
  movingIntervalMin: { label: "Poll while moving normally", unit: "min", group: "Polling" },
  attentionIntervalMin: { label: "Poll when out for delivery / delayed / exception", unit: "min", group: "Polling" },
  rtoIntervalMin: { label: "Poll while returning to us (RTO)", unit: "min", group: "Polling" },
  finalReconcileHours: { label: "Last check after a final status", unit: "h", group: "Polling" },
  maxPerRun: { label: "Shipments synced per run", unit: "/run", group: "Polling", hint: "Keeps us inside courier API limits" },
  callSpacingMs: { label: "Pause between courier API calls", unit: "ms", group: "Polling" },
  failureBaseMin: { label: "First retry after a failed sync", unit: "min", group: "Failures", hint: "Doubles each time" },
  failureMaxMin: { label: "Longest gap between retries", unit: "min", group: "Failures" },
  circuitBreakMin: { label: "Pause all syncs after auth refusal / rate limit", unit: "min", group: "Failures" },
  syncStaleHours: { label: "No successful sync → “sync failing”", unit: "h", group: "Failures" },
  noMovementHours: { label: "No courier scan → “no movement”", unit: "h", group: "Exceptions" },
  noMovementEscalateHours: { label: "Escalate “no movement” after", unit: "h", group: "Exceptions" },
  pickupDelayHours: { label: "AWB not picked up → “pickup delayed”", unit: "h", group: "Exceptions" },
  missingAwbHours: { label: "Shipment without AWB → exception", unit: "h", group: "Exceptions" },
  eddEscalateDays: { label: "Escalate an expired estimate after", unit: "days", group: "Exceptions" },
  failedAttemptsEscalate: { label: "Escalate after failed delivery attempts", unit: "×", group: "Exceptions" },
};

const SETTINGS_KEYS = ["support.sla", "support.policy", "notifications.config", "tracking.config"];

export default async function SupportSettingsPage() {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "support.view")) return <NoAccessNotice title="Support settings" />;
  const canEdit = can(ctx.role, "support.settings");
  const isOwner = ctx.role === "OWNER";

  // The readers never throw (they fall back to defaults); the meta/admin reads might.
  const [sla, policy, notices, storedTracking] = await Promise.all([loadSla(), loadPolicy(), loadNoticeConfig(), getSetting("tracking.config")]);
  let meta: Awaited<ReturnType<typeof settingsMeta>> = {};
  let members: Awaited<ReturnType<typeof listAdmins>> = [];
  let storageMissing = false;
  try {
    [meta, members] = await Promise.all([settingsMeta(SETTINGS_KEYS), listAdmins()]);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    storageMissing = true;
    members = await listAdmins().catch(() => []);
  }
  const tracking = resolveTrackingConfig(storedTracking);

  const trackingFields: TrackingField[] = (Object.keys(DEFAULT_TRACKING_CONFIG) as Array<keyof TrackingConfig>).map((key) => {
    const field = trackingConfigSchema.shape[key];
    return {
      key,
      ...TRACKING_META[key],
      min: field.minValue ?? null,
      max: field.maxValue ?? null,
      int: field.isInt,
    };
  });

  const updated = (key: string) => {
    const m = meta[key];
    return m ? `Last changed ${formatDateTimeShort(m.updatedAt)}${m.updatedBy ? ` by ${shortEmail(m.updatedBy)}` : ""}` : "Using the built-in defaults";
  };

  const roleOptions = (Object.keys(ROLE_LABEL) as AdminRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }));

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Support settings"
        description={canEdit ? "Changes apply within 30 seconds. Everything is validated before it's saved." : "Read-only — owners and managers can change these."}
      />

      {storageMissing && (
        <p role="status" className="mb-4 rounded-xl border border-tone-warn/25 bg-tone-warn-bg px-4 py-3 text-[13px] text-tone-warn">
          Settings storage (app_settings) isn&rsquo;t set up yet, so the defaults below are in use and can&rsquo;t be saved. Apply the
          support / tracking migrations first.
        </p>
      )}

      <div className="space-y-4">
        <Panel>
          <PanelHeader
            title={
              <span className="flex items-center gap-2">
                <TriangleAlert size={16} aria-hidden className="text-tone-warn" /> Needs an owner decision
              </span>
            }
            description="Conflicts found between the published policy and other pages. Nothing here was changed automatically."
          />
          <ol className="divide-y divide-admin-line">
            {POLICY_INCONSISTENCIES.map((text, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5 text-[13px] leading-5 text-brand-ink sm:px-5">
                <span className="w-5 shrink-0 text-right tabular-nums text-admin-muted">{i + 1}.</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel>
          <PanelHeader title="Response targets (SLA)" description={updated("support.sla")} />
          <SlaForm initial={sla} canEdit={canEdit && !storageMissing} />
        </Panel>

        <Panel>
          <PanelHeader title="Returns & replacements" description={updated("support.policy")} />
          <PolicyForm
            initial={{
              replacementWindowDays: policy.replacementWindowDays,
              returnWindowDays: policy.returnWindowDays,
              evidence: policy.evidence,
              maxEvidenceFiles: Math.min(5, policy.maxEvidenceFiles),
            }}
            canEdit={canEdit && !storageMissing}
            readOnlyTerms={
              <div className="rounded-lg border border-admin-line bg-admin-page">
                <p className="border-b border-admin-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">
                  Commercial terms — from the published policy, not editable here
                </p>
                <dl className="divide-y divide-admin-line text-[13px]">
                  <Term label="Return conditions">{policy.returnConditions}</Term>
                  <Term label="Change-of-mind deduction">{policy.changeOfMindDeduction}</Term>
                  <Term label="Return shipping">{policy.returnShipping}</Term>
                  <Term label="Faulty unit for replacements">{policy.replacementNeedsReturn ? "Customer returns it" : "Customer keeps it (no return courier)"}</Term>
                  <Term label="Refund timeline">
                    Inspection {policy.refundTimeline.inspection}; prepaid {policy.refundTimeline.prepaid}; COD {policy.refundTimeline.cod}
                  </Term>
                  <Term label="Not covered">
                    <ul className="list-disc space-y-0.5 pl-4">
                      {policy.notCovered.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </Term>
                </dl>
              </div>
            }
          />
        </Panel>

        <Panel>
          <PanelHeader title="Customer notifications" description={updated("notifications.config")} />
          <NoticeForm
            initial={{ enabled: notices.enabled, quietHours: notices.quietHours }}
            kinds={NOTICE_KINDS.map((k) => ({ kind: k, label: NOTICE_LABEL[k] }))}
            canEdit={canEdit && !storageMissing}
          />
        </Panel>

        <Panel>
          <PanelHeader title="Shipment tracking" description={updated("tracking.config")} />
          <TrackingForm initial={tracking} defaults={DEFAULT_TRACKING_CONFIG} fields={trackingFields} canEdit={canEdit && !storageMissing} />
        </Panel>

        <Panel>
          <PanelHeader
            title="Team roles"
            description={isOwner ? "Only owners can change roles. The last active owner can't be removed." : "Only an owner can change roles."}
          />
          <TeamRoles
            members={members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role, active: m.active }))}
            roles={roleOptions}
            canEdit={isOwner}
            me={ctx.email}
          />
          <RoleGuide />
        </Panel>
      </div>
    </div>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-3 py-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-admin-muted">{label}</dt>
      <dd className="text-brand-ink">{children}</dd>
    </div>
  );
}

function RoleGuide() {
  const rows: Array<[string, string]> = [
    [ROLE_LABEL.OWNER, "Everything, including refund approval and team roles"],
    [ROLE_LABEL.MANAGER, "Everything except refund approval and team roles"],
    [ROLE_LABEL.SUPPORT_SUPERVISOR, "Tickets, assignment, claim decisions, help articles, refund requests"],
    [ROLE_LABEL.SUPPORT, "Tickets and replies, tracking resync, refund requests"],
    [ROLE_LABEL.WAREHOUSE, "Claim fulfilment, tracking, inventory; reads support"],
    [ROLE_LABEL.FINANCE, "Refund approval and execution; reads support"],
  ];
  return (
    <dl className="border-t border-admin-line bg-admin-page px-4 py-3 text-xs sm:px-5">
      {rows.map(([role, text]) => (
        <div key={role} className="flex gap-2 py-0.5">
          <dt className="w-36 shrink-0 font-medium text-brand-ink">{role}</dt>
          <dd className="text-admin-muted">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

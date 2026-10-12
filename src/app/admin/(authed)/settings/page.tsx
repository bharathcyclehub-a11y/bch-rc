import { db } from "@/db";
import { sites, admins } from "@/db/schema";
import { requireAdmin, type AdminContext } from "@/lib/admin-auth";
import { formatDateTimeShort } from "@/lib/admin/format";
import { can } from "@/lib/admin/permissions";
import { COURIER_PROVIDER_LABEL, COURIER_PROVIDERS, getCourierAdapter } from "@/lib/couriers";
import {
  COURIER_SETTINGS_KEY,
  delhiveryPickupLocation,
  loadCourierSettings,
  warehousePincode,
} from "@/lib/couriers/settings";
import { isMissingTableError, settingsMeta } from "@/lib/support/admin-queries";
import { Badge } from "@/components/admin/Badge";
import { Panel, PanelHeader } from "@/components/admin/Panel";
import { CourierSettingsForm } from "./CourierSettingsForm";

export default async function AdminSettings() {
  const ctx = await requireAdmin();
  const allSites = await db.select().from(sites);
  const allAdmins = await db.select().from(admins);

  return (
    <div className="space-y-3 sm:space-y-5">
      <h1 className="font-display text-lg sm:text-3xl font-bold text-brand-ink">
        Settings
      </h1>

      <CourierRouting ctx={ctx} />

      <section className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
        <h2 className="font-semibold text-brand-ink mb-3">Sites</h2>
        <ul className="space-y-3">
          {allSites.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 border border-brand-line rounded-lg px-3 sm:px-4 py-3"
            >
              <div className="min-w-0">
                <div className="font-semibold text-brand-ink">
                  {s.name}{" "}
                  <span className="text-xs text-brand-ink-soft font-mono break-all">
                    {s.id}
                  </span>
                </div>
                <div className="text-xs text-brand-ink-soft mt-0.5">
                  {s.domain} · {s.scale} · prefix {s.orderIdPrefix}
                </div>
              </div>
              {s.active ? (
                <span className="shrink-0 text-[10px] font-mono uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full bg-success/10 text-success">
                  Active
                </span>
              ) : (
                <span className="shrink-0 text-[10px] font-mono uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full bg-brand-line text-brand-ink-soft">
                  Inactive
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-brand-ink-soft mt-3">
          Adding new sites: insert directly via Supabase dashboard or seed
          script for now. Admin UI for site creation coming later.
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-brand-line p-3 sm:p-5">
        <h2 className="font-semibold text-brand-ink mb-3">Admins</h2>
        <ul className="space-y-2">
          {allAdmins.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 border border-brand-line rounded-lg px-3 sm:px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-semibold text-brand-ink break-all">{a.email}</div>
                <div className="text-xs text-brand-ink-soft mt-0.5">
                  {a.role} · {a.siteIds.length} sites
                </div>
              </div>
              {a.email === ctx.email && (
                <span className="shrink-0 text-[10px] font-mono uppercase tracking-widest text-brand-ink-soft">
                  You
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-brand-ink-soft mt-3">
          Founder emails (ADMIN_FOUNDER_EMAILS in .env) auto-get OWNER on first
          sign-in. Add a new admin: invite an email here (UI TODO) or insert a
          row in `admins` directly.
        </p>
      </section>
    </div>
  );
}

/**
 * Courier routing (src/lib/couriers/settings.ts): which provider books a new
 * shipment and how. Owners and managers edit; everyone else sees the same
 * values read-only. Only whether the Delhivery token is set is shown — never
 * the token.
 */
async function CourierRouting({ ctx }: { ctx: AdminContext }) {
  const settings = await loadCourierSettings();
  let meta: Awaited<ReturnType<typeof settingsMeta>> = {};
  let storageMissing = false;
  try {
    meta = await settingsMeta([COURIER_SETTINGS_KEY]);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    storageMissing = true;
  }
  const canEdit = can(ctx.role, "shipping.settings") && !storageMissing;
  const delhiveryConfigured = getCourierAdapter("delhivery").isConfigured();
  const m = meta[COURIER_SETTINGS_KEY];
  const updated = m
    ? `Last changed ${formatDateTimeShort(m.updatedAt)}${m.updatedBy ? ` by ${m.updatedBy.split("@")[0]}` : ""}`
    : "Using the built-in defaults";

  return (
    <Panel>
      <PanelHeader
        title="Courier routing"
        description={
          canEdit
            ? updated
            : storageMissing
              ? "Settings storage (app_settings) isn't set up yet — the defaults below are in use."
              : `${updated} · Read-only — owners and managers can change these.`
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 sm:px-5">
        <Badge tone={delhiveryConfigured ? "positive" : "attention"}>
          Delhivery API token {delhiveryConfigured ? "configured" : "not configured"}
        </Badge>
        <Badge tone={settings.delhiveryEnabled ? "info" : "neutral"}>
          Delhivery booking {settings.delhiveryEnabled ? "on" : "off"}
        </Badge>
      </div>
      <CourierSettingsForm
        initial={settings}
        providers={COURIER_PROVIDERS.map((p) => ({ value: p, label: COURIER_PROVIDER_LABEL[p] }))}
        canEdit={canEdit}
        delhiveryConfigured={delhiveryConfigured}
        envFallback={{
          // The env values the blank fields fall back to — only whether they are set.
          pickupLocation: delhiveryPickupLocation({ ...settings, delhiveryPickupLocation: "" }) !== null,
          pickupPincode: warehousePincode({ ...settings, pickupPincode: "" }) !== null,
        }}
      />
    </Panel>
  );
}

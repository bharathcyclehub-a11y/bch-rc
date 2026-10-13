"use client";

import { useState, useTransition, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/admin/Button";
import { Field, Input, PrefixInput, Select, Switch } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import type { CourierProvider } from "@/lib/couriers/types";
import type { CourierSettings, RoutingMode } from "@/lib/couriers/settings";
import { saveCourierSettingsAction } from "./courier-actions";

/** From the mode table at the top of src/lib/couriers/settings.ts, most conservative first. */
const MODE_INFO: Record<RoutingMode, { label: string; hint: string }> = {
  off: { label: "Off", hint: "Shiprocket books every order exactly as before. No evaluation." },
  shadow: { label: "Shadow", hint: "Shiprocket books every order as before; the engine records which provider it would pick and why." },
  manual: {
    label: "Manual",
    hint: "The engine recommends. Orders it would send to Delhivery (or can't route) wait for staff on the order page; the rest book on Shiprocket as before.",
  },
  auto: { label: "Automatic", hint: "The engine books the provider it picks." },
};
const MODES = Object.keys(MODE_INFO) as RoutingMode[];
const DELHIVERY_MODES = ["Surface", "Express"] as const;

type ParcelKey = keyof CourierSettings["parcel"];
const PARCEL_FIELDS: Array<{ key: ParcelKey; label: string; unit: string; step: string }> = [
  { key: "weightGrams", label: "Weight", unit: "g", step: "1" },
  { key: "lengthCm", label: "Length", unit: "cm", step: "any" },
  { key: "breadthCm", label: "Breadth", unit: "cm", step: "any" },
  { key: "heightCm", label: "Height", unit: "cm", step: "any" },
];

/** Numbers stay as typed until save; the server validates the whole object. */
type Draft = Omit<CourierSettings, "maxRateInr" | "reviewAboveInr" | "parcel"> & {
  maxRateInr: string;
  reviewAboveInr: string;
  parcel: Record<ParcelKey, string>;
};

function toDraft(s: CourierSettings): Draft {
  return {
    ...s,
    maxRateInr: s.maxRateInr == null ? "" : String(s.maxRateInr),
    reviewAboveInr: s.reviewAboveInr == null ? "" : String(s.reviewAboveInr),
    parcel: {
      weightGrams: String(s.parcel.weightGrams),
      lengthCm: String(s.parcel.lengthCm),
      breadthCm: String(s.parcel.breadthCm),
      heightCm: String(s.parcel.heightCm),
    },
  };
}

/** Empty → NaN (rejected by the server); `optional` fields send null instead. */
function num(s: string, optional = false): number | null {
  if (s.trim() === "") return optional ? null : Number.NaN;
  return Number(s);
}

function fromDraft(d: Draft) {
  return {
    ...d,
    maxRateInr: num(d.maxRateInr, true),
    reviewAboveInr: num(d.reviewAboveInr, true),
    parcel: Object.fromEntries(PARCEL_FIELDS.map((f) => [f.key, num(d.parcel[f.key])])),
    delhiveryModes: DELHIVERY_MODES.filter((m) => d.delhiveryModes.includes(m)),
  };
}

export function CourierSettingsForm({
  initial,
  providers,
  canEdit,
  delhiveryConfigured,
  envFallback,
}: {
  initial: CourierSettings;
  providers: Array<{ value: CourierProvider; label: string }>;
  canEdit: boolean;
  /** DELHIVERY_API_TOKEN is set (never the value). */
  delhiveryConfigured: boolean;
  /** Whether the env fallbacks for the blank pickup fields are set. */
  envFallback: { pickupLocation: boolean; pickupPincode: boolean };
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [d, setDraft] = useState(() => toDraft(initial));
  // What is live now — the confirm below compares against it, not the draft's start.
  const [saved, setSaved] = useState({ mode: initial.mode, delhiveryEnabled: initial.delhiveryEnabled });
  const off = !canEdit;
  const label = (p: CourierProvider) => providers.find((x) => x.value === p)?.label ?? p;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((cur) => ({ ...cur, [key]: value }));
    setDirty(true);
  }

  function submit() {
    const risks: string[] = [];
    if (d.mode !== saved.mode && d.mode === "auto") risks.push("Mode → Automatic: the engine books whichever provider it picks for every new order.");
    if (d.mode !== saved.mode && d.mode === "manual") {
      risks.push("Mode → Manual: orders the engine would send to Delhivery (or can't route) stop and wait for staff instead of booking.");
    }
    if (d.delhiveryEnabled && !saved.delhiveryEnabled) {
      risks.push(
        `${label("delhivery")} booking turns on: shipments can be booked on our Delhivery account.${
          delhiveryConfigured ? "" : " DELHIVERY_API_TOKEN is NOT configured, so those bookings will fail."
        }`,
      );
    }
    if (risks.length && !window.confirm(`This changes how live orders are booked:\n\n• ${risks.join("\n• ")}\n\nContinue only with the owner's approval.`)) return;

    const next = { mode: d.mode, delhiveryEnabled: d.delhiveryEnabled };
    setError(null);
    startTransition(async () => {
      const r = await saveCourierSettingsAction(fromDraft(d));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(next);
      setDirty(false);
      toast({ title: "Courier routing saved", description: r.message, tone: "success" });
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {canEdit && (
        <div className="px-4 pt-4 sm:px-5">
          <p className="flex items-start gap-2 rounded-lg border border-tone-warn/25 bg-tone-warn-bg px-3 py-2.5 text-[13px] leading-5 text-tone-warn">
            <TriangleAlert size={15} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">Changes live bookings.</span>{" "}
              Switching the mode to Manual or Automatic, or turning on Delhivery booking, changes how paid orders are booked from the next order. Get the owner&rsquo;s approval first.
            </span>
          </p>
        </div>
      )}

      <Group title="Mode">
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <label
              key={m}
              className={cn(
                "flex gap-2.5 rounded-lg border px-3 py-2.5",
                d.mode === m ? "border-brand-ink bg-admin-subtle" : "border-admin-line",
                off ? "cursor-default" : "cursor-pointer",
              )}
            >
              <input
                type="radio"
                name="courier-mode"
                value={m}
                checked={d.mode === m}
                disabled={off}
                onChange={() => set("mode", m)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-ink"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-brand-ink">{MODE_INFO[m].label}</span>
                <span className="mt-0.5 block text-xs leading-4 text-admin-muted">{MODE_INFO[m].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Group>

      <Group title="Providers">
        <div className="space-y-3">
          <Switch
            checked={d.delhiveryEnabled}
            disabled={off}
            onChange={(v) => set("delhiveryEnabled", v)}
            label={`Book on ${label("delhivery")}`}
            description="Master switch. While off, no Delhivery shipment is booked in any mode — staff choices included. Shadow still asks Delhivery for prices."
          />
          <Switch
            checked={d.shiprocketEnabled}
            disabled={off}
            onChange={(v) => set("shiprocketEnabled", v)}
            label={`Book on ${label("shiprocket")}`}
          />
        </div>
        <div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label="Preferred provider" htmlFor="cr-preferred" hint="Tried first when it is eligible.">
            <Select id="cr-preferred" value={d.preferred} disabled={off} onChange={(e) => set("preferred", e.target.value as CourierProvider)}>
              {providers.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="When it isn't eligible" htmlFor="cr-fallback">
            <Select id="cr-fallback" value={d.fallback} disabled={off} onChange={(e) => set("fallback", e.target.value as Draft["fallback"])}>
              <option value="other">Use the other provider</option>
              <option value="review">Hold for staff review</option>
            </Select>
          </Field>
        </div>
      </Group>

      <Group title="Payment types">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Switch checked={d.delhiveryPrepaid} disabled={off} onChange={(v) => set("delhiveryPrepaid", v)} label="Delhivery — prepaid orders" />
          <Switch checked={d.delhiveryCod} disabled={off} onChange={(v) => set("delhiveryCod", v)} label="Delhivery — COD orders" />
          <Switch checked={d.shiprocketPrepaid} disabled={off} onChange={(v) => set("shiprocketPrepaid", v)} label="Shiprocket — prepaid orders" />
          <Switch checked={d.shiprocketCod} disabled={off} onChange={(v) => set("shiprocketCod", v)} label="Shiprocket — COD orders" />
        </div>
      </Group>

      <Group title="Cost rules">
        <Switch
          checked={d.requireCheaper}
          disabled={off}
          onChange={(v) => set("requireCheaper", v)}
          label="Preferred provider only when it isn't dearer"
          description="Compares the two quotes; only quotes at or above the minimum confidence decide on cost."
        />
        <div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-3">
          <Field label="Never auto-book above" htmlFor="cr-max-rate" hint="₹1–5,000 as quoted. Blank = no cap.">
            <PrefixInput
              id="cr-max-rate"
              inputMode="decimal"
              placeholder="No cap"
              value={d.maxRateInr}
              disabled={off}
              onChange={(e) => set("maxRateInr", e.target.value)}
            />
          </Field>
          <Field label="Minimum quote confidence" htmlFor="cr-confidence" hint="Full: the provider's own all-in price incl. GST.">
            <Select
              id="cr-confidence"
              value={d.minRateConfidence}
              disabled={off}
              onChange={(e) => set("minRateConfidence", e.target.value as Draft["minRateConfidence"])}
            >
              <option value="full">Full only</option>
              <option value="partial">Partial or full</option>
            </Select>
          </Field>
          <Field label="Staff review above order value" htmlFor="cr-review" hint="₹100–10,00,000. Blank = never.">
            <PrefixInput
              id="cr-review"
              placeholder="Never"
              value={d.reviewAboveInr}
              disabled={off}
              onChange={(e) => set("reviewAboveInr", e.target.value)}
            />
          </Field>
        </div>
      </Group>

      <Group title="Service level">
        <p className="text-[13px] font-medium text-brand-ink">Delhivery service modes</p>
        <p className="mt-0.5 text-xs leading-4 text-admin-muted">At least one. Surface is the cheap one.</p>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {DELHIVERY_MODES.map((m) => {
            const checked = d.delhiveryModes.includes(m);
            return (
              <label key={m} className="inline-flex items-center gap-2 text-[13px] text-brand-ink">
                <input
                  type="checkbox"
                  checked={checked}
                  // The last ticked mode can't be cleared — the schema needs one.
                  disabled={off || (checked && d.delhiveryModes.length === 1)}
                  onChange={(e) =>
                    set("delhiveryModes", e.target.checked ? [...d.delhiveryModes, m] : d.delhiveryModes.filter((x) => x !== m))
                  }
                  className="h-4 w-4 shrink-0 rounded border-admin-line-strong accent-brand-ink"
                />
                {m}
              </label>
            );
          })}
        </div>
        <div className="mt-4">
          <Switch
            checked={d.shiprocketSurfacePreferred}
            disabled={off}
            onChange={(v) => set("shiprocketSurfacePreferred", v)}
            label="Price Shiprocket by its cheapest surface courier"
            description="Air only where surface is unavailable — how staff choose by hand today."
          />
        </div>
        <div className="mt-4 max-w-sm">
          <Field
            label="Shiprocket quotes and GST"
            htmlFor="cr-sr-gst"
            hint="Check one AWB in Shiprocket's wallet passbook: debit = quote → included; 18% more → excluded. Unknown keeps Shiprocket out of cost comparisons."
          >
            <Select
              id="cr-sr-gst"
              value={d.shiprocketRatesGst}
              disabled={off}
              onChange={(e) => set("shiprocketRatesGst", e.target.value as Draft["shiprocketRatesGst"])}
            >
              <option value="unknown">Unknown</option>
              <option value="included">Quote includes GST</option>
              <option value="excluded">GST added on top (+18%)</option>
            </Select>
          </Field>
        </div>
      </Group>

      <Group title="Parcel (as billed)">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {PARCEL_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`cr-parcel-${f.key}`}>
              <div className="relative">
                <Input
                  id={`cr-parcel-${f.key}`}
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  value={d.parcel[f.key]}
                  disabled={off}
                  onChange={(e) => set("parcel", { ...d.parcel, [f.key]: e.target.value })}
                  className="pr-10 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-admin-muted">{f.unit}</span>
              </div>
            </Field>
          ))}
        </div>
        <p className="mt-2 text-xs leading-4 text-admin-muted">Every order ships in one polybag today; quotes use this weight and size.</p>
      </Group>

      <Group title="Pickup">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field
            label="Delhivery pickup location"
            htmlFor="cr-pickup-location"
            hint={`Must match the name registered in Delhivery exactly. Blank uses DELHIVERY_PICKUP_LOCATION (${
              envFallback.pickupLocation ? "set" : "not set"
            }).`}
          >
            <Input
              id="cr-pickup-location"
              maxLength={80}
              placeholder="From the environment"
              value={d.delhiveryPickupLocation}
              disabled={off}
              onChange={(e) => set("delhiveryPickupLocation", e.target.value)}
            />
          </Field>
          <Field
            label="Warehouse pincode (for quotes)"
            htmlFor="cr-pincode"
            hint={`Blank uses SHIPROCKET_PICKUP_PINCODE (${envFallback.pickupPincode ? "set" : "not set"}).`}
          >
            <Input
              id="cr-pincode"
              inputMode="numeric"
              maxLength={6}
              placeholder="From the environment"
              value={d.pickupPincode}
              disabled={off}
              onChange={(e) => set("pickupPincode", e.target.value.replace(/\D/g, ""))}
              className="tabular-nums"
            />
          </Field>
        </div>
      </Group>

      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-admin-line px-4 py-3 sm:px-5">
          {error ? (
            <p role="alert" className="mr-auto text-xs text-tone-neg">
              {error}
            </p>
          ) : (
            dirty && <p className="mr-auto text-xs font-medium text-brand-ink">Unsaved changes</p>
          )}
          <Button type="submit" variant="secondary" loading={pending} disabled={!dirty}>
            Save
          </Button>
        </div>
      )}
    </form>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-b border-admin-line px-4 py-4 last-of-type:border-b-0 sm:px-5">
      <legend className="sr-only">{title}</legend>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">{title}</p>
      {children}
    </fieldset>
  );
}

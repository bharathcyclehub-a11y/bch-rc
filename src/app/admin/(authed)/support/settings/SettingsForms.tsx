"use client";

import { useState, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/admin/Button";
import { Field, Input, Select, Switch } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import {
  saveNoticeConfigAction,
  savePolicyAction,
  saveSlaAction,
  saveTrackingConfigAction,
  type SettingsResult,
} from "./actions";

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const PRIORITY_LABEL = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" } as const;
type PriorityKey = (typeof PRIORITIES)[number];

/** Number input that keeps what was typed until save (empty → NaN, which the server rejects). */
function num(s: string): number {
  return s.trim() === "" ? Number.NaN : Number(s);
}

function useSaver() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  function save(run: () => Promise<SettingsResult>, title: string) {
    setError(null);
    startTransition(async () => {
      const r = await run();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDirty(false);
      toast({ title, description: r.message, tone: "success" });
    });
  }
  return { pending, error, dirty, touch: () => setDirty(true), save };
}

function SaveRow({ canEdit, pending, error, dirty, label = "Save" }: { canEdit: boolean; pending: boolean; error: string | null; dirty: boolean; label?: string }) {
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-admin-line px-4 py-3 sm:px-5">
      {error ? (
        <p role="alert" className="mr-auto text-xs text-tone-neg">
          {error}
        </p>
      ) : (
        dirty && <p className="mr-auto text-xs font-medium text-brand-ink">Unsaved changes</p>
      )}
      <Button type="submit" variant="secondary" loading={pending} disabled={!dirty}>
        {label}
      </Button>
    </div>
  );
}

function NumberCell({
  id,
  value,
  onChange,
  disabled,
  step = "any",
  min,
  max,
  suffix,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  step?: string;
  min?: number;
  max?: number;
  suffix?: string;
  label: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={label}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn("text-right tabular-nums", suffix && "pr-12")}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-admin-muted">{suffix}</span>}
    </div>
  );
}

// ── SLA ─────────────────────────────────────────────────────────────────────

export type SlaValue = {
  supportStartHour: number;
  supportEndHour: number;
  firstResponseHours: Record<PriorityKey, number>;
  resolutionHours: Record<PriorityKey, number>;
};

export function SlaForm({ initial, canEdit }: { initial: SlaValue; canEdit: boolean }) {
  const s = useSaver();
  const [start, setStart] = useState(String(initial.supportStartHour));
  const [end, setEnd] = useState(String(initial.supportEndHour));
  const [first, setFirst] = useState(() => Object.fromEntries(PRIORITIES.map((p) => [p, String(initial.firstResponseHours[p])])) as Record<PriorityKey, string>);
  const [resolve, setResolve] = useState(() => Object.fromEntries(PRIORITIES.map((p) => [p, String(initial.resolutionHours[p])])) as Record<PriorityKey, string>);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        s.save(
          () =>
            saveSlaAction({
              supportStartHour: num(start),
              supportEndHour: num(end),
              firstResponseHours: Object.fromEntries(PRIORITIES.map((p) => [p, num(first[p])])),
              resolutionHours: Object.fromEntries(PRIORITIES.map((p) => [p, num(resolve[p])])),
            }),
          "SLA saved",
        );
      }}
    >
      <div className="space-y-5 p-4 sm:p-5">
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label="Support opens" htmlFor="sla-start" hint="IST hour, 0–23">
            <NumberCell id="sla-start" label="Support opens" value={start} step="1" min={0} max={23} suffix=":00" disabled={!canEdit} onChange={(v) => { setStart(v); s.touch(); }} />
          </Field>
          <Field label="Support closes" htmlFor="sla-end" hint="IST hour, 1–24">
            <NumberCell id="sla-end" label="Support closes" value={end} step="1" min={1} max={24} suffix=":00" disabled={!canEdit} onChange={(v) => { setEnd(v); s.touch(); }} />
          </Field>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">
                <th className="pb-2 pr-3 font-semibold">Priority</th>
                <th className="pb-2 pr-3 font-semibold">First response</th>
                <th className="pb-2 font-semibold">Resolution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-line">
              {PRIORITIES.map((p) => (
                <tr key={p}>
                  <td className="py-2 pr-3 font-medium text-brand-ink">{PRIORITY_LABEL[p]}</td>
                  <td className="py-2 pr-3">
                    <NumberCell id={`sla-fr-${p}`} label={`${PRIORITY_LABEL[p]} first response hours`} value={first[p]} step="0.5" min={0.5} max={720} suffix="h" disabled={!canEdit} onChange={(v) => { setFirst((f) => ({ ...f, [p]: v })); s.touch(); }} />
                  </td>
                  <td className="py-2">
                    <NumberCell id={`sla-rs-${p}`} label={`${PRIORITY_LABEL[p]} resolution hours`} value={resolve[p]} step="0.5" min={0.5} max={720} suffix="h" disabled={!canEdit} onChange={(v) => { setResolve((f) => ({ ...f, [p]: v })); s.touch(); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-4 text-admin-muted">
          Hours are support hours (counted only while support is open, every day). The published promise is a reply within 4 hours, 10 AM – 8 PM IST — keep Medium at or under that.
        </p>
      </div>
      <SaveRow canEdit={canEdit} pending={s.pending} error={s.error} dirty={s.dirty} />
    </form>
  );
}

// ── Policy ──────────────────────────────────────────────────────────────────

export type PolicyValue = {
  replacementWindowDays: number;
  returnWindowDays: number;
  evidence: Record<string, "REQUIRED" | "RECOMMENDED" | "NONE">;
  maxEvidenceFiles: number;
};

const REASON_LABEL: Record<string, string> = {
  TRANSIT_DAMAGE: "Damaged in transit",
  MANUFACTURING_DEFECT: "Manufacturing defect",
  WRONG_ITEM: "Wrong item",
  MISSING_ACCESSORY: "Missing item / accessory",
  CHANGE_OF_MIND: "Change of mind (return)",
};

export function PolicyForm({ initial, canEdit, readOnlyTerms }: { initial: PolicyValue; canEdit: boolean; readOnlyTerms: ReactNode }) {
  const s = useSaver();
  const [replacement, setReplacement] = useState(String(initial.replacementWindowDays));
  const [ret, setRet] = useState(String(initial.returnWindowDays));
  const [files, setFiles] = useState(String(initial.maxEvidenceFiles));
  const [evidence, setEvidence] = useState(initial.evidence);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        s.save(
          () => savePolicyAction({ replacementWindowDays: num(replacement), returnWindowDays: num(ret), maxEvidenceFiles: num(files), evidence }),
          "Policy values saved",
        );
      }}
    >
      <div className="space-y-5 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Replacement window" htmlFor="pol-repl" hint="Days after delivery">
            <NumberCell id="pol-repl" label="Replacement window days" value={replacement} step="1" min={1} max={60} suffix="days" disabled={!canEdit} onChange={(v) => { setReplacement(v); s.touch(); }} />
          </Field>
          <Field label="Return window" htmlFor="pol-ret" hint="Days after delivery (unopened)">
            <NumberCell id="pol-ret" label="Return window days" value={ret} step="1" min={1} max={60} suffix="days" disabled={!canEdit} onChange={(v) => { setRet(v); s.touch(); }} />
          </Field>
          <Field label="Evidence files per message" htmlFor="pol-files" hint="1–5 photos / videos">
            <NumberCell id="pol-files" label="Max evidence files" value={files} step="1" min={1} max={5} disabled={!canEdit} onChange={(v) => { setFiles(v); s.touch(); }} />
          </Field>
        </div>
        <div>
          <p className="text-[13px] font-medium text-brand-ink">Evidence rule per reason</p>
          <p className="mt-0.5 text-xs text-admin-muted">Required: a claim without a photo or video waits for one (status “Needs info”).</p>
          <ul className="mt-2 divide-y divide-admin-line rounded-lg border border-admin-line">
            {Object.keys(REASON_LABEL).map((r) => (
              <li key={r} className="flex items-center justify-between gap-3 px-3 py-2">
                <label htmlFor={`ev-${r}`} className="min-w-0 truncate text-[13px] text-brand-ink">
                  {REASON_LABEL[r]}
                </label>
                <Select
                  id={`ev-${r}`}
                  value={evidence[r] ?? "REQUIRED"}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setEvidence((all) => ({ ...all, [r]: e.target.value as PolicyValue["evidence"][string] }));
                    s.touch();
                  }}
                  className="w-40"
                >
                  <option value="REQUIRED">Required</option>
                  <option value="RECOMMENDED">Recommended</option>
                  <option value="NONE">Not needed</option>
                </Select>
              </li>
            ))}
          </ul>
        </div>
        {readOnlyTerms}
      </div>
      <SaveRow canEdit={canEdit} pending={s.pending} error={s.error} dirty={s.dirty} />
    </form>
  );
}

// ── Customer notifications ──────────────────────────────────────────────────

export type NoticeValue = {
  enabled: Record<string, boolean>;
  quietHours: { startHour: number; endHour: number } | null;
};

export function NoticeForm({
  initial,
  kinds,
  canEdit,
}: {
  initial: NoticeValue;
  kinds: Array<{ kind: string; label: string }>;
  canEdit: boolean;
}) {
  const s = useSaver();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [quiet, setQuiet] = useState(initial.quietHours !== null);
  const [qStart, setQStart] = useState(String(initial.quietHours?.startHour ?? 21));
  const [qEnd, setQEnd] = useState(String(initial.quietHours?.endHour ?? 9));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        s.save(
          () => saveNoticeConfigAction({ enabled, quietHours: quiet ? { startHour: num(qStart), endHour: num(qEnd) } : null }),
          "Notification settings saved",
        );
      }}
    >
      <ul className="divide-y divide-admin-line">
        {kinds.map((k) => (
          <li key={k.kind} className="px-4 py-3 sm:px-5">
            <Switch
              checked={!!enabled[k.kind]}
              disabled={!canEdit}
              onChange={(next) => {
                setEnabled((all) => ({ ...all, [k.kind]: next }));
                s.touch();
              }}
              label={k.label}
            />
          </li>
        ))}
      </ul>
      <div className="space-y-3 border-t border-admin-line px-4 py-4 sm:px-5">
        <Switch
          checked={quiet}
          disabled={!canEdit}
          onChange={(next) => {
            setQuiet(next);
            s.touch();
          }}
          label="Quiet hours"
          description="Non-urgent notices raised in this window wait until it ends (IST)."
        />
        {quiet && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <Field label="From" htmlFor="qh-start">
              <NumberCell id="qh-start" label="Quiet hours start" value={qStart} step="1" min={0} max={23} suffix=":00" disabled={!canEdit} onChange={(v) => { setQStart(v); s.touch(); }} />
            </Field>
            <Field label="Until" htmlFor="qh-end">
              <NumberCell id="qh-end" label="Quiet hours end" value={qEnd} step="1" min={0} max={23} suffix=":00" disabled={!canEdit} onChange={(v) => { setQEnd(v); s.touch(); }} />
            </Field>
          </div>
        )}
      </div>
      <SaveRow canEdit={canEdit} pending={s.pending} error={s.error} dirty={s.dirty} />
    </form>
  );
}

// ── Tracking ────────────────────────────────────────────────────────────────

export type TrackingField = {
  key: string;
  label: string;
  hint?: string;
  unit: string;
  group: string;
  min: number | null;
  max: number | null;
  int: boolean;
};

export function TrackingForm({
  initial,
  defaults,
  fields,
  canEdit,
}: {
  initial: Record<string, number>;
  defaults: Record<string, number>;
  fields: TrackingField[];
  canEdit: boolean;
}) {
  const s = useSaver();
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, String(initial[f.key])])) as Record<string, string>);
  const groups = [...new Set(fields.map((f) => f.group))];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        s.save(() => saveTrackingConfigAction(Object.fromEntries(fields.map((f) => [f.key, num(values[f.key])]))), "Tracking settings saved");
      }}
    >
      {groups.map((g) => (
        <fieldset key={g} className="border-b border-admin-line px-4 py-4 last:border-b-0 sm:px-5">
          <legend className="sr-only">{g}</legend>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">{g}</p>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {fields
              .filter((f) => f.group === g)
              .map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  htmlFor={`trk-${f.key}`}
                  hint={`${f.hint ? `${f.hint} · ` : ""}${f.min ?? "–"}–${f.max ?? "–"} ${f.unit} · default ${defaults[f.key]}`}
                >
                  <NumberCell
                    id={`trk-${f.key}`}
                    label={f.label}
                    value={values[f.key]}
                    step={f.int ? "1" : "any"}
                    min={f.min ?? undefined}
                    max={f.max ?? undefined}
                    suffix={f.unit}
                    disabled={!canEdit}
                    onChange={(v) => {
                      setValues((all) => ({ ...all, [f.key]: v }));
                      s.touch();
                    }}
                  />
                </Field>
              ))}
          </div>
        </fieldset>
      ))}
      <SaveRow canEdit={canEdit} pending={s.pending} error={s.error} dirty={s.dirty} />
    </form>
  );
}

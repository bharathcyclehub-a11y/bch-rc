/**
 * Admin-editable support configuration, stored in app_settings and merged
 * over the code defaults in rules.ts. Invalid stored values fall back to the
 * defaults field by field, so a bad edit can never break the support flows.
 */

import { getSetting } from "@/lib/settings";
import { DEFAULT_POLICY, DEFAULT_SLA, type Priority, type SlaConfig, type SupportPolicy } from "./rules";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

export async function loadSla(): Promise<SlaConfig> {
  const s = (await getSetting<Partial<SlaConfig>>("support.sla")) ?? {};
  const pick = (key: "firstResponseHours" | "resolutionHours") =>
    Object.fromEntries(
      PRIORITIES.map((p) => [p, num(s[key]?.[p], 0.5, 720) ?? DEFAULT_SLA[key][p]]),
    ) as Record<Priority, number>;
  const start = num(s.supportStartHour, 0, 23) ?? DEFAULT_SLA.supportStartHour;
  const end = num(s.supportEndHour, 1, 24) ?? DEFAULT_SLA.supportEndHour;
  return {
    supportStartHour: start < end ? start : DEFAULT_SLA.supportStartHour,
    supportEndHour: start < end ? end : DEFAULT_SLA.supportEndHour,
    firstResponseHours: pick("firstResponseHours"),
    resolutionHours: pick("resolutionHours"),
  };
}

export async function loadPolicy(): Promise<SupportPolicy> {
  const s = (await getSetting<Partial<SupportPolicy>>("support.policy")) ?? {};
  return {
    ...DEFAULT_POLICY,
    replacementWindowDays: num(s.replacementWindowDays, 1, 60) ?? DEFAULT_POLICY.replacementWindowDays,
    returnWindowDays: num(s.returnWindowDays, 1, 60) ?? DEFAULT_POLICY.returnWindowDays,
    replacementReasons: Array.isArray(s.replacementReasons) ? s.replacementReasons : DEFAULT_POLICY.replacementReasons,
    evidence: { ...DEFAULT_POLICY.evidence, ...(s.evidence ?? {}) },
    notCovered: Array.isArray(s.notCovered) ? s.notCovered.filter((x) => typeof x === "string") : DEFAULT_POLICY.notCovered,
    returnConditions: typeof s.returnConditions === "string" ? s.returnConditions : DEFAULT_POLICY.returnConditions,
    changeOfMindDeduction: typeof s.changeOfMindDeduction === "string" ? s.changeOfMindDeduction : DEFAULT_POLICY.changeOfMindDeduction,
    returnShipping: typeof s.returnShipping === "string" ? s.returnShipping : DEFAULT_POLICY.returnShipping,
    replacementNeedsReturn: typeof s.replacementNeedsReturn === "boolean" ? s.replacementNeedsReturn : DEFAULT_POLICY.replacementNeedsReturn,
    refundTimeline: { ...DEFAULT_POLICY.refundTimeline, ...(s.refundTimeline ?? {}) },
    maxEvidenceFiles: num(s.maxEvidenceFiles, 1, 10) ?? DEFAULT_POLICY.maxEvidenceFiles,
    maxEvidenceMb: num(s.maxEvidenceMb, 1, 20) ?? DEFAULT_POLICY.maxEvidenceMb,
  };
}

/** Days a RESOLVED ticket can be reopened before it closes automatically. */
export const REOPEN_WINDOW_DAYS = 7;
/** Evidence of CLOSED tickets is deleted after this many days. */
export const EVIDENCE_RETENTION_DAYS = 365;

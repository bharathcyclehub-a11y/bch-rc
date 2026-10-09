"use server";

/**
 * Support settings. Values live in app_settings (src/lib/settings.ts); the
 * readers (loadSla, loadPolicy, loadNoticeConfig, resolveTrackingConfig)
 * already fall back to code defaults field by field, and everything is
 * validated here before it's stored.
 *
 *   SLA, policy, notifications, tracking   support.settings (owner, manager)
 *   team roles                             OWNER only; the last active owner can't be removed
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { admins, events } from "@/db/schema";
import { requireAdmin, type AdminContext } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { logError } from "@/lib/logger";
import { NOTICE_KINDS } from "@/lib/notifications/customer-notice";
import { setSetting } from "@/lib/settings";
import { isMissingTableError, isUuid, rawSetting } from "@/lib/support/admin-queries";
import { trackingConfigSchema } from "@/lib/tracking/config";

export type SettingsResult = { ok: true; message?: string } | { ok: false; error: string };

const PATH = "/admin/support/settings";
const ROLES = ["OWNER", "MANAGER", "SUPPORT", "SUPPORT_SUPERVISOR", "WAREHOUSE", "FINANCE"] as const;

async function settingsGate(): Promise<AdminContext | null> {
  const ctx = await requireAdmin();
  return can(ctx.role, "support.settings") ? ctx : null;
}

function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? i.message : "Check the values and try again.";
}

function fail(scope: string, err: unknown): SettingsResult {
  if (isMissingTableError(err)) return { ok: false, error: "Settings storage isn't set up yet — apply the support / tracking migrations." };
  logError(scope, err);
  return { ok: false, error: "Couldn't save — try again." };
}

// ── SLA ─────────────────────────────────────────────────────────────────────

const hours = (what: string) => z.number({ error: `${what}: enter a number` }).min(0.5, `${what}: at least 0.5 h`).max(720, `${what}: at most 720 h`);
const perPriority = (what: string) =>
  z.object({ CRITICAL: hours(`${what} (critical)`), HIGH: hours(`${what} (high)`), MEDIUM: hours(`${what} (medium)`), LOW: hours(`${what} (low)`) });

const slaSchema = z
  .object({
    supportStartHour: z.number().int().min(0, "Start hour 0–23").max(23, "Start hour 0–23"),
    supportEndHour: z.number().int().min(1, "End hour 1–24").max(24, "End hour 1–24"),
    firstResponseHours: perPriority("First response"),
    resolutionHours: perPriority("Resolution"),
  })
  .refine((v) => v.supportStartHour < v.supportEndHour, "Support hours must start before they end.")
  .refine(
    (v) => (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).every((p) => v.firstResponseHours[p] <= v.resolutionHours[p]),
    "A first-response target can't be longer than its resolution target.",
  );

export async function saveSlaAction(input: unknown): Promise<SettingsResult> {
  const ctx = await settingsGate();
  if (!ctx) return { ok: false, error: "Your role can't change support settings." };
  const parsed = slaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await setSetting("support.sla", parsed.data, ctx.email);
    revalidatePath(PATH);
    return { ok: true, message: "New tickets use these targets. Existing tickets keep theirs." };
  } catch (err) {
    return fail("admin:support:settings-sla", err);
  }
}

// ── Policy (operational values only) ────────────────────────────────────────

const rule = z.enum(["REQUIRED", "RECOMMENDED", "NONE"]);
const policySchema = z.object({
  replacementWindowDays: z.number().int().min(1, "Replacement window: 1–60 days").max(60, "Replacement window: 1–60 days"),
  returnWindowDays: z.number().int().min(1, "Return window: 1–60 days").max(60, "Return window: 1–60 days"),
  evidence: z.object({
    TRANSIT_DAMAGE: rule,
    MANUFACTURING_DEFECT: rule,
    WRONG_ITEM: rule,
    MISSING_ACCESSORY: rule,
    CHANGE_OF_MIND: rule,
  }),
  // The upload pipeline accepts at most 5 files per message (src/lib/support/evidence.ts).
  maxEvidenceFiles: z.number().int().min(1, "Evidence files: 1–5").max(5, "Evidence files: 1–5"),
});

export async function savePolicyAction(input: unknown): Promise<SettingsResult> {
  const ctx = await settingsGate();
  if (!ctx) return { ok: false, error: "Your role can't change support settings." };
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    // Merge: commercial terms stored by someone else (if any) are kept as they are.
    const stored = await rawSetting("support.policy");
    await setSetting("support.policy", { ...stored, ...parsed.data }, ctx.email);
    revalidatePath(PATH);
    return { ok: true, message: "Applies to claims raised from now on." };
  } catch (err) {
    return fail("admin:support:settings-policy", err);
  }
}

// ── Customer notifications ──────────────────────────────────────────────────

const hour = z.number().int().min(0, "Hours are 0–23").max(23, "Hours are 0–23");
const noticeSchema = z
  .object({
    enabled: z.object(Object.fromEntries(NOTICE_KINDS.map((k) => [k, z.boolean()])) as Record<(typeof NOTICE_KINDS)[number], z.ZodBoolean>),
    quietHours: z.object({ startHour: hour, endHour: hour }).nullable(),
  })
  .refine((v) => !v.quietHours || v.quietHours.startHour !== v.quietHours.endHour, "Quiet hours must start and end at different times.");

export async function saveNoticeConfigAction(input: unknown): Promise<SettingsResult> {
  const ctx = await settingsGate();
  if (!ctx) return { ok: false, error: "Your role can't change support settings." };
  const parsed = noticeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await setSetting("notifications.config", parsed.data, ctx.email);
    revalidatePath(PATH);
    return { ok: true, message: "Customer notices follow these switches from now on." };
  } catch (err) {
    return fail("admin:support:settings-notices", err);
  }
}

// ── Tracking ────────────────────────────────────────────────────────────────

const trackingSchema = trackingConfigSchema
  .refine((v) => v.failureMaxMin >= v.failureBaseMin, "The longest retry gap can't be shorter than the first retry.")
  .refine((v) => v.noMovementEscalateHours >= v.noMovementHours, "Escalate 'no movement' only after it has been flagged.");

export async function saveTrackingConfigAction(input: unknown): Promise<SettingsResult> {
  const ctx = await settingsGate();
  if (!ctx) return { ok: false, error: "Your role can't change support settings." };
  const parsed = trackingSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i ? `${i.path.length ? `${String(i.path[0])}: ` : ""}${i.message}` : "Check the values." };
  }
  try {
    await setSetting("tracking.config", parsed.data, ctx.email);
    revalidatePath(PATH);
    revalidatePath("/admin/support/exceptions");
    return { ok: true, message: "The tracking worker picks this up on its next run." };
  } catch (err) {
    return fail("admin:support:settings-tracking", err);
  }
}

// ── Team roles (owner only) ─────────────────────────────────────────────────

class RoleChangeError extends Error {}

export async function updateAdminAccessAction(adminId: string, role: string, active: boolean): Promise<SettingsResult> {
  const ctx = await requireAdmin();
  if (ctx.role !== "OWNER") return { ok: false, error: "Only an owner can change team roles." };
  if (!isUuid(adminId)) return { ok: false, error: "Unknown team member." };
  if (!(ROLES as readonly string[]).includes(role)) return { ok: false, error: "Unknown role." };
  const nextRole = role as (typeof ROLES)[number];

  try {
    const result = await db.transaction(async (tx) => {
      const [target] = await tx.select().from(admins).where(eq(admins.id, adminId)).for("update");
      if (!target) throw new RoleChangeError("That team member no longer exists.");
      if (target.role === nextRole && target.active === active) return null;

      const losesOwner = target.role === "OWNER" && target.active && (nextRole !== "OWNER" || !active);
      if (losesOwner) {
        // Lock every active owner row so two owners can't demote each other at once.
        const owners = await tx
          .select({ id: admins.id })
          .from(admins)
          .where(and(eq(admins.role, "OWNER"), eq(admins.active, true)))
          .for("update");
        if (owners.length <= 1) throw new RoleChangeError("You can't remove the last active owner. Make someone else an owner first.");
      }

      await tx.update(admins).set({ role: nextRole, active }).where(eq(admins.id, adminId));
      await tx.insert(events).values({
        siteId: null,
        type: "ADMIN_ROLE_CHANGED",
        source: "admin",
        payload: {
          adminId,
          adminEmail: target.email,
          fromRole: target.role,
          toRole: nextRole,
          fromActive: target.active,
          toActive: active,
          actor: ctx.email,
        },
      });
      return target.email;
    });
    revalidatePath(PATH);
    return { ok: true, message: result ? `${result} updated` : "No change" };
  } catch (err) {
    if (err instanceof RoleChangeError) return { ok: false, error: err.message };
    return fail("admin:support:settings-roles", err);
  }
}

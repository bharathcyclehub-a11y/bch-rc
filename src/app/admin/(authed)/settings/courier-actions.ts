"use server";

/**
 * Courier routing settings (src/lib/couriers/settings.ts). The whole object is
 * validated against the same zod schema the reader uses and stored under
 * "couriers.routing" in app_settings; app_settings.updated_by records who
 * changed it (events rows need an order or site, so there is no event here).
 *
 *   save   shipping.settings (owner, manager)
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { COURIER_SETTINGS_KEY, courierSettingsSchema } from "@/lib/couriers/settings";
import { logError } from "@/lib/logger";
import { setSetting } from "@/lib/settings";
import { isMissingTableError } from "@/lib/support/admin-queries";

export type CourierSettingsResult = { ok: true; message?: string } | { ok: false; error: string };

const FIELD_LABEL: Record<string, string> = {
  mode: "Mode",
  preferred: "Preferred provider",
  fallback: "Fallback",
  maxRateInr: "Rate cap",
  minRateConfidence: "Minimum quote confidence",
  delhiveryModes: "Delhivery service modes",
  reviewAboveInr: "Staff review above",
  parcel: "Parcel",
  "parcel.weightGrams": "Parcel weight (g)",
  "parcel.lengthCm": "Parcel length (cm)",
  "parcel.breadthCm": "Parcel breadth (cm)",
  "parcel.heightCm": "Parcel height (cm)",
  delhiveryPickupLocation: "Delhivery pickup location",
  pickupPincode: "Warehouse pincode",
};

/** zod's message for a regex miss quotes the pattern — say what's wanted instead. */
const FIELD_MESSAGE: Record<string, string> = {
  pickupPincode: "enter 6 digits, or leave it blank",
};

export async function saveCourierSettingsAction(input: unknown): Promise<CourierSettingsResult> {
  const ctx = await requireAdmin();
  if (!can(ctx.role, "shipping.settings")) return { ok: false, error: "Your role can't change courier routing." };

  const parsed = courierSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    if (!i) return { ok: false, error: "Check the values and try again." };
    const top = String(i.path[0] ?? "");
    const label = FIELD_LABEL[i.path.map(String).join(".")] ?? FIELD_LABEL[top] ?? top;
    return { ok: false, error: `${label ? `${label}: ` : ""}${FIELD_MESSAGE[top] ?? i.message}` };
  }

  try {
    await setSetting(COURIER_SETTINGS_KEY, parsed.data, ctx.email);
    revalidatePath("/admin/settings");
    return { ok: true, message: "New bookings follow these settings within 30 seconds. Booked orders keep their courier." };
  } catch (err) {
    if (isMissingTableError(err)) return { ok: false, error: "Settings storage isn't set up yet — apply the support / tracking migrations." };
    logError("admin:settings:couriers", err);
    return { ok: false, error: "Couldn't save — try again." };
  }
}

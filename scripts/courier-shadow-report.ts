/**
 * READ-ONLY courier shadow report: what the routing engine would pick on a
 * set of lanes, with both providers' live prices side by side.
 *
 * For each lane it asks the REAL adapters (src/lib/couriers/delhivery.ts and
 * shiprocket.ts) for serviceability and a quote, on the default parcel
 * (DEFAULT_COURIER_SETTINGS.parcel at its chargeable weight) from our pickup
 * pincode (SHIPROCKET_PICKUP_PINCODE), then runs the pure `decideRoute` twice:
 *   (a) default settings, as if Delhivery were enabled and mode were auto;
 *   (b) the same with requireCheaper: true.
 * Savings are printed only when the engine found the quotes comparable.
 *
 * It books, cancels and schedules NOTHING, and never touches the database:
 * `@/db` and `@/lib/settings` are swapped for in-memory stubs before any
 * courier module loads (so routing settings are the code defaults and no
 * circuit-breaker state is read), and the database URLs are removed from the
 * environment so a failed swap aborts instead of connecting. Calls are spaced
 * at least 300 ms apart. Output holds lanes and amounts only.
 *
 *   Run (from the repo root):
 *     npx tsx --env-file=.env.prod scripts/courier-shadow-report.ts
 *     npx tsx --env-file=.env.prod scripts/courier-shadow-report.ts --lanes 600001:COD:1500,560072:Prepaid:999
 *   Lane = pincode:COD|Prepaid[:value ₹]. Value defaults to ₹1,499 (declared
 *   value, and the cash collected for COD).
 */

import fs from "node:fs";
import * as nodeModule from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ProviderAssessment, RoutingVerdict } from "../src/lib/couriers/routing";
import type { CourierSettings } from "../src/lib/couriers/settings";
import type { CourierAdapter, CourierProvider, CourierQuote, Serviceability } from "../src/lib/couriers/types";

// ── 1. Database firewall (runs before any app module is loaded) ─────────────

delete process.env.DATABASE_URL;
delete process.env.DATABASE_URL_POOLED;
// One-line adapter errors (src/lib/logger.ts prints stacks outside production).
(process.env as Record<string, string>).NODE_ENV = "production";

type ResolveResult = { url: string; format?: string | null; shortCircuit?: boolean };
type ResolveContext = { parentURL?: string; conditions?: string[] };
type RegisterHooks = (hooks: {
  resolve: (specifier: string, context: ResolveContext, next: (s: string, c?: ResolveContext) => ResolveResult) => ResolveResult;
}) => unknown;

function installDbStubs(): void {
  const registerHooks = (nodeModule as unknown as { registerHooks?: RegisterHooks }).registerHooks;
  if (typeof registerHooks !== "function") {
    throw new Error(`module.registerHooks is unavailable on Node ${process.version} (needs >= 22.15); refusing to run`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "courier-shadow-"));
  const write = (name: string, src: string) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, src);
    return pathToFileURL(file).href;
  };
  const dbStub = write(
    "db.cjs",
    `"use strict";
const deny = () => { throw new Error("courier-shadow-report: database access is disabled"); };
const db = new Proxy({}, { get: deny });
class DatabaseUnavailableError extends Error {}
module.exports = { db, schema: {}, withDbRetry: deny, DatabaseUnavailableError, __shadowStub: true };
`,
  );
  const settingsStub = write(
    "settings.cjs",
    `"use strict";
async function getSetting() { return null; }
async function setSetting() { throw new Error("courier-shadow-report: settings are read-only"); }
function invalidateSettingsCache() {}
module.exports = { getSetting, setSetting, invalidateSettingsCache, __shadowStub: true };
`,
  );
  const bySpecifier: Record<string, string> = { "@/db": dbStub, "@/lib/settings": settingsStub };
  const byPath: Array<[RegExp, string]> = [
    [/\/src\/db(\/index\.ts)?$/i, dbStub],
    [/\/src\/lib\/settings\.ts$/i, settingsStub],
  ];
  registerHooks({
    resolve(specifier, context, next) {
      const direct = bySpecifier[specifier];
      if (direct) return { url: direct, format: "commonjs", shortCircuit: true };
      const r = next(specifier, context);
      const hit = byPath.find(([re]) => re.test(r.url.replace(/\\/g, "/")));
      return hit ? { url: hit[1], format: "commonjs", shortCircuit: true } : r;
    },
  });
}

// ── 2. Lanes ────────────────────────────────────────────────────────────────

type Lane = { pincode: string; paymentMethod: "Prepaid" | "COD"; valueInr: number };

/** The owner's 12 Oct 2026 rate check. */
const DEFAULT_LANES = "600001:COD,600040:Prepaid,560091:COD,560072:Prepaid,570017:COD,641035:COD,803215:COD,600062:COD";
const DEFAULT_VALUE_INR = 1499;

function parseLanes(argv: string[]): Lane[] {
  const i = argv.findIndex((a) => a === "--lanes" || a.startsWith("--lanes="));
  const raw = i < 0 ? DEFAULT_LANES : argv[i].includes("=") ? argv[i].slice(8) : argv[i + 1] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((spec) => {
      const [pin, pay = "COD", value] = spec.split(":").map((x) => x.trim());
      if (!/^[1-9][0-9]{5}$/.test(pin)) throw new Error(`Bad lane "${spec}": pincode must be 6 digits`);
      const p = pay.toLowerCase();
      const paymentMethod = p === "cod" ? "COD" : p === "prepaid" || p === "ppd" ? "Prepaid" : null;
      if (!paymentMethod) throw new Error(`Bad lane "${spec}": payment must be COD or Prepaid`);
      const valueInr = value === undefined || value === "" ? DEFAULT_VALUE_INR : Number(value);
      if (!Number.isFinite(valueInr) || valueInr <= 0) throw new Error(`Bad lane "${spec}": value must be a positive ₹ amount`);
      return { pincode: pin, paymentMethod, valueInr };
    });
}

// ── 3. Helpers ──────────────────────────────────────────────────────────────

const GAP_MS = 300;
let lastCall = 0;
async function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    return await fn();
  } finally {
    lastCall = Date.now();
  }
}

const rs = (paise: number | null | undefined) => (paise == null ? "—" : `₹${(paise / 100).toFixed(2)}`);
const yn = (b: boolean | null) => (b === null ? "?" : b ? "Y" : "N");
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const errText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err))
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***")
    .replace(/Token\s+[A-Za-z0-9._-]+/g, "Token ***")
    .slice(0, 160);

type Probe = { sv: Serviceability | null; quote: CourierQuote | null; error: string | null };

async function probe(adapter: CourierAdapter, lane: Lane, origin: string, chargeableGrams: number, parcel: CourierSettings["parcel"]): Promise<Probe> {
  const out: Probe = { sv: null, quote: null, error: null };
  try {
    out.sv = await spaced(() => adapter.serviceability(lane.pincode));
    if (!out.sv) out.error = "serviceability check failed";
  } catch (err) {
    out.error = errText(err);
  }
  // Same rule as evaluateRouting: quote unless the lane is known unserviceable.
  if (out.sv?.serviceable === false) return out;
  try {
    out.quote = await spaced(() =>
      adapter.quote({
        originPincode: origin,
        pincode: lane.pincode,
        cod: lane.paymentMethod === "COD",
        codAmountInr: lane.paymentMethod === "COD" ? lane.valueInr : 0,
        declaredValueInr: lane.valueInr,
        parcel: { ...parcel, weightGrams: chargeableGrams },
      }),
    );
    if (!out.quote && !out.error) out.error = "no usable quote";
  } catch (err) {
    out.error = [out.error, `quote: ${errText(err)}`].filter(Boolean).join("; ");
  }
  return out;
}

// ── 4. Report ───────────────────────────────────────────────────────────────

async function main() {
  installDbStubs();

  // Prove the swap took before any courier call can read settings.
  const settingsMod = (await import("@/lib/settings")) as unknown as Record<string, unknown> & { default?: Record<string, unknown> };
  if (settingsMod.__shadowStub !== true && settingsMod.default?.__shadowStub !== true) {
    throw new Error("settings stub not in place; refusing to run");
  }

  const { decideRoute, parcelFacts } = await import("../src/lib/couriers/routing");
  const { getCourierAdapter } = await import("../src/lib/couriers/index");
  const { DEFAULT_COURIER_SETTINGS, delhiveryPickupLocation, warehousePincode } = await import("../src/lib/couriers/settings");

  const lanes = parseLanes(process.argv.slice(2));
  const base: CourierSettings = { ...DEFAULT_COURIER_SETTINGS, mode: "auto", delhiveryEnabled: true };
  const strict: CourierSettings = { ...base, requireCheaper: true };
  const facts = parcelFacts(base.parcel);
  const origin = warehousePincode(base);
  if (!facts) throw new Error("DEFAULT_COURIER_SETTINGS.parcel is invalid");
  if (!origin) throw new Error("SHIPROCKET_PICKUP_PINCODE is not set to a valid pincode");

  const dlv = getCourierAdapter("delhivery");
  const sr = getCourierAdapter("shiprocket");
  const notes: string[] = [];
  if (!dlv.isConfigured()) notes.push("DELHIVERY_API_TOKEN is not set: Delhivery is ineligible on every lane.");
  if (!sr.isConfigured()) notes.push("Shiprocket credentials are not set: Shiprocket is ineligible on every lane.");
  if (!delhiveryPickupLocation(base)) {
    notes.push("No Delhivery pickup location is configured; it is assumed present here (live routing would mark Delhivery not configured).");
  }
  notes.push("Circuit breakers are not read (no database): both providers are assumed healthy.");

  console.log(`Courier shadow report — ${new Date().toISOString()}`);
  console.log(
    `Origin ${origin} · parcel ${facts.weightGrams} g, ${facts.lengthCm}×${facts.breadthCm}×${facts.heightCm} cm` +
      ` → volumetric ${facts.volumetricGrams} g, chargeable ${facts.chargeableGrams} g`,
  );
  console.log(
    `Settings: defaults + mode auto, delhiveryEnabled · preferred ${base.preferred}, fallback ${base.fallback},` +
      ` minRateConfidence ${base.minRateConfidence}, Delhivery modes ${base.delhiveryModes.join("/")},` +
      ` Shiprocket surface-preferred ${base.shiprocketSurfacePreferred}`,
  );
  for (const n of notes) console.log(`Note: ${n}`);

  type Row = { lane: Lane; d: Probe; s: Probe; a: RoutingVerdict; b: RoutingVerdict };
  const rows: Row[] = [];

  for (const lane of lanes) {
    const d = await probe(dlv, lane, origin, facts.chargeableGrams, base.parcel);
    const s = await probe(sr, lane, origin, facts.chargeableGrams, base.parcel);

    const assess = (p: CourierProvider, adapter: CourierAdapter, r: Probe): ProviderAssessment => ({
      provider: p,
      enabled: adapter.isConfigured(),
      disabledReason: adapter.isConfigured() ? null : `${p} credentials are not configured`,
      healthy: true,
      serviceable: r.sv ? r.sv.serviceable : null,
      codAvailable: r.sv ? r.sv.codAvailable : null,
      quote: r.quote,
      bookingCommits: adapter.capabilities.awbOnBooking,
      error: r.error,
    });
    const assessments = [assess("delhivery", dlv, d), assess("shiprocket", sr, s)];
    const input = { pincode: lane.pincode, paymentMethod: lane.paymentMethod, orderValueInr: lane.valueInr, parcel: base.parcel, assessments };
    const a = decideRoute({ ...input, settings: base });
    const b = decideRoute({ ...input, settings: strict });
    rows.push({ lane, d, s, a, b });

    console.log(`\n── ${lane.pincode} · ${lane.paymentMethod} · ₹${lane.valueInr.toLocaleString("en-IN")} ${"─".repeat(40)}`);
    const dq = d.quote;
    console.log(
      `  Delhivery   serviceable ${yn(d.sv?.serviceable ?? null)}  COD ${yn(d.sv?.codAvailable ?? null)}` +
        (dq
          ? `  total ${rs(dq.totalPaise)} [${dq.confidence}, GST ${dq.taxIncluded === null ? "not stated" : dq.taxIncluded ? "incl." : "excl."}]` +
            `  zone ${dq.zone ?? "?"}  charged ${dq.chargedWeightGrams ?? "?"} g  ${dq.mode ?? ""}`
          : "  no quote"),
    );
    if (dq) {
      const c = dq.components;
      console.log(
        `              freight ${rs(c.freightPaise)} · COD ${rs(c.codPaise)} · fuel ${rs(c.fuelPaise)}` +
          ` · ODA ${rs(c.remoteAreaPaise)} · other ${rs(c.otherPaise)} · GST ${rs(c.taxPaise)}`,
      );
    }
    if (d.error) console.log(`              error: ${d.error}`);
    const sq = s.quote;
    console.log(
      `  Shiprocket  serviceable ${yn(s.sv?.serviceable ?? null)}  COD ${yn(s.sv?.codAvailable ?? null)}` +
        (sq
          ? `  ${sq.mode === "surface" ? "cheapest surface" : "cheapest (no surface)"}: ${sq.courierName ?? "?"}` +
            `  rate ${rs(sq.totalPaise)} [${sq.confidence}, GST ${sq.taxIncluded === null ? "NOT STATED" : sq.taxIncluded ? "incl." : "excl."}]`
          : "  no quote"),
    );
    if (sq) {
      const c = sq.components;
      console.log(
        `              freight ${rs(c.freightPaise)} · COD ${rs(c.codPaise)} · other ${rs(c.otherPaise)}` +
          `  zone ${sq.zone ?? "?"}  charged ${sq.chargedWeightGrams ?? "?"} g`,
      );
    }
    if (s.error) console.log(`              error: ${s.error}`);
    const v = (label: string, x: RoutingVerdict) =>
      console.log(`  ${label} → ${pad(x.recommended ?? "staff review", 10)} ${x.reasonCode}: ${x.reason}`);
    v("(a) auto          ", a);
    v("(b) requireCheaper", b);
    for (const [label, x] of [["(a)", a], ["(b)", b]] as const) {
      if (x.comparable && x.savingsPaise !== null) console.log(`  ${label} like-for-like saving: ${rs(x.savingsPaise)}`);
    }
    if (!a.comparable && !b.comparable) {
      const why =
        !dq || !sq
          ? "a quote is missing"
          : `Shiprocket's rate is ${sq.confidence} (GST not stated) vs Delhivery ${dq.confidence}; minRateConfidence is ${base.minRateConfidence}`;
      console.log(`  Savings: not comparable — ${why}`);
      if (dq && sq) {
        const gap = sq.totalPaise - dq.totalPaise;
        const gapIfGst = Math.round(sq.totalPaise * 1.18) - dq.totalPaise;
        console.log(
          `  Indicative only (not like-for-like): Shiprocket − Delhivery = ${rs(gap)} as quoted, ${rs(gapIfGst)} if Shiprocket's rate excludes 18% GST`,
        );
      }
    }
  }

  // ── Summary ──
  console.log(`\nSummary (₹, chargeable ${facts.chargeableGrams} g)`);
  const head = ["Lane", "DLV total", "DLV zone", "SR surface", "SR rate", "SR+18%", "(a)", "(b)", "Saving"];
  const widths = [17, 10, 8, 22, 9, 9, 22, 30, 8];
  const line = (cols: string[]) => console.log(cols.map((c, i) => pad(c, widths[i])).join(" "));
  line(head);
  line(widths.map((w) => "-".repeat(w)));
  for (const r of rows) {
    const saving = [r.a, r.b].find((x) => x.comparable && x.savingsPaise !== null)?.savingsPaise ?? null;
    line([
      `${r.lane.pincode} ${r.lane.paymentMethod === "COD" ? "COD" : "PPD"} ${r.lane.valueInr}`,
      r.d.quote ? rs(r.d.quote.totalPaise) : r.d.sv?.serviceable === false ? "unserv." : "—",
      r.d.quote?.zone ?? "—",
      (r.s.quote?.courierName ?? (r.s.sv?.serviceable === false ? "unserv." : "—")).slice(0, 22),
      r.s.quote ? rs(r.s.quote.totalPaise) : "—",
      r.s.quote ? rs(Math.round(r.s.quote.totalPaise * 1.18)) : "—",
      `${r.a.recommended ?? "review"} ${r.a.reasonCode}`.slice(0, 22),
      `${r.b.recommended ?? "review"} ${r.b.reasonCode}`.slice(0, 30),
      saving === null ? "n/c" : rs(saving),
    ]);
  }
  console.log(`\nn/c = not comparable like-for-like (no saving claimed). PPD = prepaid.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

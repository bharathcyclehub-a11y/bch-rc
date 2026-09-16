/**
 * LOCAL DEVELOPMENT DATABASE — applies every migration (drizzle journal +
 * src/db/migrations/manual) and loads clearly-fake sample data (example.com
 * emails, 90000-series phone numbers) so the storefront and admin run locally
 * with no production access.
 *
 * Refuses to run unless DATABASE_URL points at localhost, so it can never touch
 * the production database. Every run rebuilds the local database from scratch.
 *
 *   npm run dev:db          # terminal 1 — local Postgres (PGlite) on 127.0.0.1:54329
 *   npm run dev:db:setup    # migrations + sample data
 *   npm run dev             # terminal 2 — the admin signs in as ADMIN_DEV_EMAIL
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  addresses,
  admins,
  customers,
  events,
  inventory,
  orders,
  productOverrides,
  products,
  productVariants,
  reviews,
  sites,
  type NewOrder,
} from "../src/db/schema";
import { PRODUCTS } from "../src/lib/products";
import { THEME } from "../src/lib/theme";

const url = process.env.DATABASE_URL ?? "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  host = "";
}
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
  console.error(`Refusing to run: DATABASE_URL must point at a local database (got host "${host || "none"}").`);
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const db = drizzle(client);

// Deterministic PRNG (mulberry32) so every reset yields the same sample data.
let state = 20260915;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick<T>(list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}
function between(min: number, max: number): number {
  return Math.floor(min + rand() * (max - min + 1));
}
function weighted<K extends string>(weights: Record<K, number>): K {
  const entries = Object.entries(weights) as [K, number][];
  let r = rand() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[0][0];
}

const DAY = 86_400_000;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms);
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const orderId = () => "PRC-" + Array.from({ length: 8 }, () => pick([...ID_ALPHABET])).join("");

const ADMIN_EMAIL = (process.env.ADMIN_DEV_EMAIL || "dev@pocketrc.local").trim().toLowerCase();
const OPS_EMAIL = "syed@pocketrc.local";

const FIRST = ["Aarav", "Priya", "Rohit", "Sneha", "Karthik", "Ananya", "Vikram", "Meera", "Arjun", "Divya", "Rahul", "Tanvi", "Rohan", "Kabir", "Isha", "Aditya", "Nisha", "Farhan", "Pooja", "Siddharth"];
const LAST = ["Sharma", "Nair", "Verma", "Iyer", "Reddy", "Gupta", "Singh", "Joshi", "Patel", "Menon", "Mehta", "Rao", "Khan", "Das", "Kulkarni"];
const PLACES = [
  { city: "Mumbai", state: "Maharashtra", pincode: "400050" },
  { city: "Bengaluru", state: "Karnataka", pincode: "560038" },
  { city: "New Delhi", state: "Delhi", pincode: "110017" },
  { city: "Chennai", state: "Tamil Nadu", pincode: "600028" },
  { city: "Hyderabad", state: "Telangana", pincode: "500081" },
  { city: "Kolkata", state: "West Bengal", pincode: "700019" },
  { city: "Pune", state: "Maharashtra", pincode: "411004" },
  { city: "Jaipur", state: "Rajasthan", pincode: "302015" },
  { city: "Kochi", state: "Kerala", pincode: "682020" },
  { city: "Ahmedabad", state: "Gujarat", pincode: "380015" },
];
const STREETS = ["MG Road", "Hill Road", "Anna Salai", "Park Street", "FC Road", "Indiranagar 100ft Rd", "Banjara Hills Rd 12", "Linking Road"];
const COURIERS = ["Delhivery", "Blue Dart", "Xpressbees", "Ecom Express"];

async function ensureSites() {
  const brandTheme = {
    colors: THEME.colors,
    logo: { main: THEME.logoMain, dark: THEME.logoDark, badge: THEME.logoBadge, favicon: THEME.favicon },
    copy: { heroH1: THEME.heroH1, heroSub: THEME.heroSub, tagline: THEME.tagline },
  };
  const legal = {
    gstin: THEME.legal.gstin,
    legalName: THEME.legal.legalName,
    registeredAddress: THEME.legal.registeredAddress,
    supportPhone: THEME.phoneDisplay,
    supportEmail: THEME.email,
  };
  await db
    .insert(sites)
    .values([
      { id: "prc", name: THEME.brandName, domain: THEME.domain, scale: THEME.scaleFocus, orderIdPrefix: "PRC", brandTheme, ...legal },
      { id: "prc16", name: `${THEME.brandName} — Big (1:16)`, domain: "prc16.pocketrccars.com", scale: "1:16", orderIdPrefix: "PRC", brandTheme, ...legal },
    ])
    .onConflictDoNothing({ target: sites.id });
}

async function main() {
  console.log("→ Resetting the local database");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");

  // Same bookkeeping as drizzle's migrator (so `npm run db:migrate` stays in
  // sync), applied one migration at a time: 0008 seeds a coupon for site
  // "prc", so the sites rows must exist as soon as their table does.
  console.log("→ Applying migrations");
  await client.unsafe(
    "CREATE SCHEMA IF NOT EXISTS drizzle; CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);",
  );
  for (const m of readMigrationFiles({ migrationsFolder: "src/db/migrations" })) {
    await client.begin(async (tx) => {
      for (const stmt of m.sql) if (stmt.trim()) await tx.unsafe(stmt);
      await tx.unsafe("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [m.hash, m.folderMillis]);
    });
    const [{ ready }] = await client<{ ready: boolean }[]>`select to_regclass('public.sites') is not null as ready`;
    if (ready) await ensureSites();
  }
  const manualDir = path.join("src", "db", "migrations", "manual");
  for (const f of fs.readdirSync(manualDir).filter((n) => n.endsWith(".sql")).sort()) {
    await client.unsafe(fs.readFileSync(path.join(manualDir, f), "utf8"));
    console.log(`  ✓ manual/${f}`);
  }

  console.log("→ Loading sample data");
  await db.insert(admins).values([
    { authUserId: randomUUID(), email: ADMIN_EMAIL, name: "Local Dev", siteIds: ["prc", "prc16"], role: "OWNER", active: true },
    { authUserId: randomUUID(), email: OPS_EMAIL, name: "Syed (sample)", siteIds: ["prc", "prc16"], role: "MANAGER", active: true },
  ]);

  // ── Inventory: catalogue seed stock with a few deliberate low / sold-out rows.
  const tweaks: Record<string, number> = {
    "pocket-porsche:2": 2,
    "mini-bmw-m4:0": 0,
    "ferrari-drift:0": 0,
    "pocket-f1-classic:1": 3,
    "dares-azure:-": 4,
  };
  const invRows: { siteId: string; skuId: string; variantSlug: string; stock: number }[] = [];
  for (const sku of PRODUCTS) {
    if (sku.hidden || sku.comingSoon) continue; // teasers have no live stock — shows "no data"
    if (sku.colors?.length) {
      sku.colors.forEach((c, i) =>
        invRows.push({ siteId: "prc", skuId: sku.id, variantSlug: c.slug, stock: tweaks[`${sku.id}:${i}`] ?? c.stock }),
      );
    } else {
      invRows.push({ siteId: "prc", skuId: sku.id, variantSlug: "", stock: tweaks[`${sku.id}:-`] ?? (sku.scale === "1:16" ? 25 : 50) });
    }
  }
  await db.insert(inventory).values(invRows);

  await db.insert(productOverrides).values([
    { siteId: "prc", skuId: "pocket-thar", priceInr: 1299, updatedBy: OPS_EMAIL, updatedAt: ago(2 * DAY) },
    { siteId: "prc", skuId: "mini-bmw-m4", comingSoon: true, updatedBy: ADMIN_EMAIL, updatedAt: ago(6 * DAY) },
  ]);

  // ── Customers + saved addresses.
  const customerRows = Array.from({ length: 42 }, (_, i) => {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    const name = i === 5 ? "Venkata Subramanian Raghunathan" : i === 17 ? null : `${first} ${last}`;
    return {
      id: randomUUID(),
      phone: `90000${String(10000 + i * 37).slice(-5)}`,
      email: i % 4 === 3 || i === 17 ? null : `${first}.${last}${i}@example.com`.toLowerCase(),
      name,
      firstSiteId: "prc",
      createdAt: ago(between(1, 260) * DAY),
      place: PLACES[i % PLACES.length],
    };
  });
  await db.insert(customers).values(
    customerRows.map((c) => ({ id: c.id, phone: c.phone, email: c.email, name: c.name, firstSiteId: c.firstSiteId, createdAt: c.createdAt })),
  );
  await db.insert(addresses).values(
    customerRows
      .filter((_, i) => i % 5 !== 0)
      .map((c) => ({
        customerId: c.id,
        label: "Home",
        fullName: c.name ?? "Customer",
        phone: c.phone,
        line1: `${between(1, 220)}, ${pick(STREETS)}`,
        line2: pick(["", "Near metro station", "2nd floor"]) || null,
        city: c.place.city,
        state: c.place.state,
        pincode: c.place.pincode,
        isDefault: true,
      })),
  );

  // ── Orders across every status.
  type Status = NewOrder["status"] & string;
  const STATUS_WEIGHTS: Record<Status, number> = {
    DELIVERED: 30, SHIPPED: 14, PACKED: 7, PAID: 10, PENDING_COD_VERIFICATION: 5, PENDING: 6,
    FAILED: 8, ABANDONED: 8, CANCELLED: 5, RETURNED: 4, REFUNDED: 3,
  };
  const buyable = PRODUCTS.filter((p) => !p.hidden && !p.comingSoon && !p.internal && !p.bundle);
  const orderRows: NewOrder[] = [];
  for (let i = 0; i < 112; i++) {
    const c = customerRows[Math.floor(Math.pow(rand(), 1.8) * customerRows.length)]; // skew → repeat buyers
    const status = weighted(STATUS_WEIGHTS);
    const method = weighted({ UPI: 55, CARD: 14, COD: 26, NETBANKING: 5 } as const);
    const placed = NOW - Math.floor(Math.pow(rand(), 1.5) * 80 * DAY) - between(0, 3_600_000);
    const lines = Array.from({ length: rand() < 0.75 ? 1 : 2 }, () => {
      const sku = pick(buyable);
      const color = sku.colors?.length ? pick(sku.colors) : null;
      const qty = rand() < 0.85 ? 1 : 2;
      return {
        skuId: sku.id,
        variantSlug: color?.slug ?? null,
        name: sku.name,
        image: color?.image ?? sku.heroImage,
        unitPriceInr: sku.retailINR,
        qty,
        lineTotalInr: sku.retailINR * qty,
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.lineTotalInr, 0);
    const discount = rand() < 0.5 ? 100 : 0;
    const paidish = ["PAID", "PACKED", "SHIPPED", "DELIVERED", "RETURNED"].includes(status);
    const shipped = ["SHIPPED", "DELIVERED", "RETURNED"].includes(status);
    const paymentStatus =
      status === "FAILED" ? "FAILED"
        : status === "REFUNDED" ? "REFUNDED"
          : paidish && (method !== "COD" || status === "DELIVERED" || status === "RETURNED") ? "CAPTURED"
            : "PENDING";
    const manual = rand() < 0.1;
    const awb = shipped ? String(between(100000, 999999)) + String(between(100000, 999999)) : null;
    orderRows.push({
      id: orderId(),
      siteId: "prc",
      customerId: c.id,
      status,
      items: lines,
      shippingAddress: {
        fullName: c.name ?? "Customer",
        phone: c.phone,
        email: c.email,
        line1: `${between(1, 220)}, ${pick(STREETS)}`,
        line2: "",
        ...c.place,
      },
      subtotalInr: subtotal,
      discountInr: discount,
      totalInr: subtotal - discount,
      couponCode: discount ? "CODEPRC100" : null,
      paymentMethod: method,
      paymentStatus,
      awbCode: awb,
      courierName: awb ? pick(COURIERS) : null,
      trackingUrl: awb ? `https://shiprocket.co/tracking/${awb}` : null,
      source: pick(["direct", "organic", "social", "paid"]),
      createdVia: manual ? "ADMIN_MANUAL" : "CUSTOMER_WEB",
      createdByEmail: manual ? OPS_EMAIL : null,
      placedAt: new Date(placed),
      paidAt: paidish ? new Date(placed + 4 * 60_000) : null,
      packedAt: ["PACKED", "SHIPPED", "DELIVERED", "RETURNED"].includes(status) ? new Date(placed + 0.5 * DAY) : null,
      shippedAt: shipped ? new Date(placed + DAY) : null,
      deliveredAt: status === "DELIVERED" || status === "RETURNED" ? new Date(placed + 4 * DAY) : null,
      cancelledAt: status === "CANCELLED" ? new Date(placed + 3_600_000) : null,
      createdAt: new Date(placed),
    });
  }
  await db.insert(orders).values(orderRows);
  await client.unsafe(`
    UPDATE customers c SET
      total_orders = s.n,
      total_spent_inr = s.spent
    FROM (
      SELECT customer_id, count(*)::int AS n,
             coalesce(sum(total_inr) FILTER (WHERE status IN ('PAID','PACKED','SHIPPED','DELIVERED')), 0)::int AS spent
      FROM orders GROUP BY customer_id
    ) s
    WHERE s.customer_id = c.id`);

  // ── Audit trail samples (order + product activity).
  const recent = [...orderRows].sort((a, b) => +b.placedAt! - +a.placedAt!).slice(0, 20);
  await db.insert(events).values([
    ...recent.map((o) => ({ siteId: "prc", orderId: o.id, type: "ORDER_CREATED", payload: { total: o.totalInr }, source: "system", createdAt: o.placedAt! })),
    ...recent
      .filter((o) => o.paidAt)
      .map((o) => ({ siteId: "prc", orderId: o.id, type: "PAYMENT_CAPTURED", payload: { method: o.paymentMethod }, source: "webhook", createdAt: o.paidAt! })),
    { siteId: "prc", type: "INVENTORY_ADMIN_SET", payload: { skuId: "pocket-bmw", variantSlug: "blue", mode: "set", value: 18, before: 10, after: 18, by: OPS_EMAIL }, source: "admin", createdAt: ago(DAY + 3_600_000) },
    { siteId: "prc", type: "INVENTORY_ADMIN_ADJUST", payload: { skuId: "pocket-porsche", variantSlug: "yellow", mode: "adjust", value: -3, before: 5, after: 2, by: ADMIN_EMAIL }, source: "admin", createdAt: ago(5 * 3_600_000) },
    { siteId: "prc", type: "PRODUCT_OVERRIDE_SAVED", payload: { skuId: "pocket-thar", changes: [{ label: "Price", from: "₹1,399", to: "₹1,299" }], by: OPS_EMAIL }, source: "admin", createdAt: ago(2 * DAY) },
    { siteId: "prc", type: "PRODUCT_OVERRIDE_SAVED", payload: { skuId: "mini-bmw-m4", changes: [{ label: "Status", from: "Active", to: "Coming soon" }], by: ADMIN_EMAIL }, source: "admin", createdAt: ago(6 * DAY) },
  ]);

  await db.insert(reviews).values([
    { siteId: "prc", skuId: "pocket-bmw", rating: 5, title: "Kids love it", body: "Drifts great on tiles.", customerName: "Priya N.", customerCity: "Bengaluru", status: "pending", source: "post_purchase" },
    { siteId: "prc", skuId: "pocket-porsche", rating: 4, title: "Solid build", body: "Battery could be longer.", customerName: "Rohit V.", customerCity: "New Delhi", status: "pending", source: "post_purchase" },
    { siteId: "prc", skuId: "pocket-thar", rating: 5, title: "Perfect gift", body: "Arrived in 3 days.", customerName: "Sneha I.", customerCity: "Chennai", status: "pending", source: "post_purchase" },
    { siteId: "prc", skuId: "pocket-bmw", rating: 5, title: "Great value", body: "Better than expected.", customerName: "Arjun P.", customerCity: "Ahmedabad", status: "approved", approved: true, verifiedPurchase: true, source: "post_purchase" },
  ]);

  // ── Admin drafts (the new admin-only product records).
  const [draft] = await db
    .insert(products)
    .values({
      siteId: "prc",
      slug: "pocket-lambo-huracan",
      name: "Pocket Lamborghini Huracán",
      tagline: "V10 wedge silhouette · 2.4 GHz · LED headlights",
      bullets: ["Die-cast alloy wedge body", "2.4 GHz · race side-by-side", "USB-C · 14 min per charge"],
      badge: "NEW",
      priceInr: 1499,
      mrpInr: 2199,
      landingCostInr: 520,
      hidden: true,
      status: "draft",
      category: "mini64",
      scale: "1:64",
      description: "Sample local draft — not on the storefront.",
      tags: ["drift", "gift"],
      createdBy: ADMIN_EMAIL,
      updatedBy: ADMIN_EMAIL,
      createdAt: ago(DAY),
      updatedAt: ago(3 * 3_600_000),
    })
    .returning({ id: products.id });
  await db.insert(productVariants).values([
    { productId: draft.id, name: "Verde Green", slug: "verde-green", swatch: "#16a34a", sku: "PRC-LAM-GRN", openingStock: 20, sortOrder: 0 },
    { productId: draft.id, name: "Arancio Orange", slug: "arancio-orange", swatch: "#f97316", sku: "PRC-LAM-ORG", openingStock: 12, sortOrder: 1 },
    { productId: draft.id, name: "Nero Black", slug: "nero-black", swatch: "#111827", sku: "PRC-LAM-BLK", openingStock: 0, sortOrder: 2 },
  ]);
  await db.insert(products).values({
    siteId: "prc",
    slug: "pocket-beetle-classic-old",
    name: "Pocket Beetle Classic (old listing)",
    priceInr: 1199,
    mrpInr: 1699,
    hidden: true,
    status: "archived",
    category: "mini64",
    scale: "1:64",
    createdBy: OPS_EMAIL,
    updatedBy: OPS_EMAIL,
    createdAt: ago(40 * DAY),
    updatedAt: ago(20 * DAY),
  });
  await db.insert(events).values([
    { siteId: "prc", type: "PRODUCT_DRAFT_CREATED", payload: { productId: draft.id, name: "Pocket Lamborghini Huracán", by: ADMIN_EMAIL }, source: "admin", createdAt: ago(DAY) },
  ]);

  console.log(
    `✓ Local sample data: ${customerRows.length} customers, ${orderRows.length} orders, ${invRows.length} inventory rows, 2 drafts.\n` +
      `  Admin sign-in (next dev only): ${ADMIN_EMAIL}`,
  );
  await client.end();
}

main().catch(async (err) => {
  console.error("dev-db-setup failed:", err);
  await client.end({ timeout: 1 });
  process.exit(1);
});

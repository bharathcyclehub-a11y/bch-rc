/**
 * pocketrccars.com — Drizzle schema for the multi-tenant Postgres in Supabase (Mumbai).
 *
 * Architecture: ONE Postgres, N sites. Every per-site row carries `site_id`.
 * Customers + addresses are shared across all sites (phone is global identity).
 *
 * 12 tables: sites, customers, addresses, products, product_variants,
 * reviews, carts, orders, coupons, events, webhooks_inbound, admins.
 *
 * Source of truth for everything money-related. Razorpay / Shiprocket state
 * is mirrored here via webhooks; the DB row is canonical for the UI.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ============================================================
// ENUMS — keep these short; storefront text comes from a UI map
// ============================================================

export const orderStatusEnum = pgEnum("order_status", [
  "PENDING",
  "PENDING_COD_VERIFICATION",
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
  "FAILED",
  "ABANDONED",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "UPI",
  "CARD",
  "NETBANKING",
  "WALLET",
  "COD",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

/**
 * Where the order originated.
 *
 *  CUSTOMER_WEB    — the buyer self-served on pocketrccars.com checkout.
 *                    Default for every order, including all historical ones.
 *  ADMIN_MANUAL    — an admin (Sandeep/Syed/Hassan) created the order from
 *                    /admin/orders/new because the customer reached out via
 *                    WhatsApp/phone instead of using the website. Razorpay
 *                    payment link is auto-sent for payment.
 *
 * Used for per-operator sales attribution + a "Manual" filter chip on the
 * admin orders list.
 */
export const orderCreatedViaEnum = pgEnum("order_created_via", [
  "CUSTOMER_WEB",
  "ADMIN_MANUAL",
]);

export const couponTypeEnum = pgEnum("coupon_type", [
  "FLAT_INR",
  "PERCENT",
  "FREE_SHIPPING",
]);

export const adminRoleEnum = pgEnum("admin_role", [
  "OWNER",
  "MANAGER",
  "SUPPORT",
]);

// ============================================================
// 1. SITES — the 5 storefronts
// ============================================================

export const sites = pgTable("sites", {
  id: text("id").primaryKey(), // slug e.g. "prc", "rc43"
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  scale: text("scale").notNull(), // "1:64"
  orderIdPrefix: text("order_id_prefix").notNull(), // "PRC"
  brandTheme: jsonb("brand_theme").notNull().default({}),
  gstin: text("gstin"),
  legalName: text("legal_name"),
  registeredAddress: text("registered_address"),
  supportPhone: text("support_phone"),
  supportEmail: text("support_email"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ============================================================
// 2. CUSTOMERS — shared across all sites (phone = global identity)
// ============================================================

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull().unique(),
    email: text("email"),
    name: text("name"),
    /** Nullable: only set when customer signs up via Google / magic link. */
    authUserId: uuid("auth_user_id"),
    firstSiteId: text("first_site_id").references(() => sites.id),
    totalOrders: integer("total_orders").notNull().default(0),
    totalSpentInr: integer("total_spent_inr").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("customers_email_idx").on(t.email),
    index("customers_auth_user_idx").on(t.authUserId),
    index("customers_firstsite_created_idx").on(t.firstSiteId, t.createdAt),
  ],
);

// ============================================================
// 3. ADDRESSES
// ============================================================

export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: text("label"),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    pincode: text("pincode").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("addresses_customer_idx").on(t.customerId)],
);

// ============================================================
// 4. PRODUCTS
// ============================================================

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    bullets: text("bullets")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    badge: text("badge"),
    bodyShape: text("body_shape"),
    heroImage: text("hero_image"),
    heroVideo: text("hero_video"),
    altImages: text("alt_images")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    priceInr: integer("price_inr").notNull(),
    mrpInr: integer("mrp_inr").notNull(),
    landingCostInr: integer("landing_cost_inr"),
    specs: jsonb("specs").notNull().default({}),
    hidden: boolean("hidden").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("products_site_slug_unique").on(t.siteId, t.slug),
    index("products_site_idx").on(t.siteId),
  ],
);

// ============================================================
// 5. PRODUCT VARIANTS — color variants per product
// ============================================================

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // "Blue"
    slug: text("slug").notNull(), // "blue"
    swatch: text("swatch"), // hex or "gradient:from,to"
    /** Syed manages stock externally; we only flip available/sold-out. */
    inStock: boolean("in_stock").notNull().default(true),
    /** Per-variant price override. Null = use products.priceInr. */
    priceInrOverride: integer("price_inr_override"),
    image: text("image"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("variants_product_slug_unique").on(t.productId, t.slug)],
);

// ============================================================
// 5b. PRODUCT OVERRIDES — admin edits layered over the code catalog
// ============================================================
// The live catalogue is defined in code (src/lib/products.ts). Rather than a
// risky full migration of the catalogue into the DB, the admin edits a thin
// override row keyed by the code SKU id. Every field is NULLABLE — null means
// "no override, use the code value". Consumed by src/lib/product-overrides.ts
// (with a try/catch fallback so the storefront keeps working before this table
// exists / when the DB is unreachable).

export const productOverrides = pgTable(
  "product_overrides",
  {
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    skuId: text("sku_id").notNull(), // = code catalog Sku.id (e.g. "pocket-bmw")
    priceInr: integer("price_inr"), // null → code retailINR
    mrpInr: integer("mrp_inr"), // null → code mrpINR
    hidden: boolean("hidden"), // null → code value
    comingSoon: boolean("coming_soon"), // null → code value
    badge: text("badge"), // null → code badge; "" clears it
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.skuId] })],
);

// ============================================================
// 6. REVIEWS
// ============================================================

export const reviewStatusEnum = pgEnum("review_status", [
  "pending",
  "approved",
  "rejected",
]);

export const reviewSourceEnum = pgEnum("review_source", [
  "post_purchase",
  "admin_seed",
  "import",
]);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Legacy uuid path — nullable. Storefront uses sku_id (string) instead.
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    // Storefront key: site + SKU string from src/lib/products.ts.
    siteId: text("site_id").references(() => sites.id),
    skuId: text("sku_id"),
    customerId: uuid("customer_id").references(() => customers.id),
    // Verified-purchase link — only buyers with a real order_id can review
    // (R01 gate). Admin-seeded reviews leave this NULL.
    orderId: text("order_id").references(() => orders.id),
    rating: integer("rating").notNull(), // 1-5
    title: text("title"),
    body: text("body"),
    // Display fields (so PDP doesn't have to JOIN customers to render).
    customerName: text("customer_name"),
    customerCity: text("customer_city"),
    verifiedPurchase: boolean("verified_purchase").notNull().default(false),
    images: text("images")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Legacy boolean kept for back-compat. New code reads `status`. */
    approved: boolean("approved").notNull().default(false),
    status: reviewStatusEnum("status").notNull().default("pending"),
    source: reviewSourceEnum("source").notNull().default("post_purchase"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("reviews_product_idx").on(t.productId),
    index("reviews_site_sku_status_idx").on(t.siteId, t.skuId, t.status, t.createdAt),
    unique("reviews_order_sku_unique").on(t.orderId, t.skuId),
  ],
);

// ============================================================
// 7. CARTS — anonymous (session_token) + logged-in (customer_id)
// ============================================================

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    sessionToken: text("session_token").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    items: jsonb("items").notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("carts_site_session_unique").on(t.siteId, t.sessionToken)],
);

// ============================================================
// 8. ORDERS — the canonical record
// ============================================================

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(), // "PRC-A7K2M9PQ"
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    /** Client-generated idempotency key. UNIQUE — second submit returns the original order. */
    idempotencyKey: text("idempotency_key"),
    status: orderStatusEnum("status").notNull().default("PENDING"),
    /** Snapshot of line items at order time (name, image, price, variant). */
    items: jsonb("items").notNull(),
    /** Snapshot of shipping address at order time. */
    shippingAddress: jsonb("shipping_address").notNull(),
    subtotalInr: integer("subtotal_inr").notNull(),
    shippingInr: integer("shipping_inr").notNull().default(0),
    codFeeInr: integer("cod_fee_inr").notNull().default(0),
    /**
     * Partial-prepaid COD confirmation fee — Razorpay-captured upfront amount
     * for "Pay X now and rest Cash on Delivery". Zero for full-prepaid orders
     * and legacy pre-2026-06-13 COD orders. For new COD orders this equals
     * computeCodConfirmationFee(subtotalInr); the courier's COD-due value
     * sent to Shiprocket is `totalInr - confirmationFeeInr`.
     */
    confirmationFeeInr: integer("confirmation_fee_inr").notNull().default(0),
    discountInr: integer("discount_inr").notNull().default(0),
    totalInr: integer("total_inr").notNull(),
    couponCode: text("coupon_code"),
    /**
     * Marketing attribution, snapshotted onto the order at creation from the
     * buyer's FIRST-TOUCH analytics session (earliest analytics_sessions row
     * for their prc_vid). This is the half that turns "clicks per channel"
     * into "PAID ORDERS per channel/campaign" — the only attribution that
     * actually matters. `source` is the classified bucket (direct/organic/
     * social/paid/email/referral); the utm_* fields carry the raw campaign
     * tags if the inbound link was tagged. Defaults to 'direct' for orders
     * with no resolvable session (admin-manual, pre-feature rows).
     */
    source: text("source").notNull().default("direct"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    referrerHost: text("referrer_host"),
    /**
     * GST invoice number — sourced from Zoho Books (the accounting system of
     * record), NOT generated by us. Order ID (the row PK) is for reference;
     * this is the taxation document number. Null until an operator enters the
     * Zoho number on /pack/invoice/[id]; no final invoice is sent to the
     * customer before it's set. Zoho numbers are not a local sequential series
     * (Bharath Cycle Hub bills across multiple platforms from one pool).
     */
    invoiceNumber: text("invoice_number"),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("PENDING"),
    razorpayOrderId: text("razorpay_order_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    razorpaySignature: text("razorpay_signature"),
    /** Razorpay Payment Link ID — set when an admin creates a manual order
     *  and Razorpay generates a hosted payment-link URL. Separate from
     *  razorpay_order_id which is only used by the customer-self-service
     *  checkout flow. Webhook payload's `payment_link.id` maps back here. */
    razorpayPaymentLinkId: text("razorpay_payment_link_id"),
    shiprocketOrderId: text("shiprocket_order_id"),
    shiprocketShipmentId: text("shiprocket_shipment_id"),
    awbCode: text("awb_code"),
    courierName: text("courier_name"),
    trackingUrl: text("tracking_url"),
    /**
     * Manifest / pickup state — mirrors Shiprocket's lifecycle so an order
     * MOVES from "Ready to Ship" to "Pickups & Manifests" once its manifest
     * is generated (instead of showing in both). Set by printManifestAction /
     * schedulePickupAction in the /pack console.
     */
    manifestedAt: timestamp("manifested_at", { withTimezone: true }),
    manifestUrl: text("manifest_url"),
    pickupScheduledAt: timestamp("pickup_scheduled_at", { withTimezone: true }),
    notes: text("notes"),
    /**
     * Exactly-once guard for releasing reserved inventory + coupon usage back.
     * Flipped true atomically the first (and only) time an order's holds are
     * released on a terminal-unfulfilled transition (FAILED / ABANDONED /
     * CANCELLED / REFUNDED). The conditional UPDATE that flips it IS the claim.
     */
    holdsReleased: boolean("holds_released").notNull().default(false),
    /** Origin marker (see orderCreatedViaEnum). Default CUSTOMER_WEB so all
     *  historical rows + every customer-self-service order stays correct. */
    createdVia: orderCreatedViaEnum("created_via")
      .notNull()
      .default("CUSTOMER_WEB"),
    /** Email of the admin who created a manual order. NULL for self-service
     *  CUSTOMER_WEB rows. Used by the admin sales report to attribute revenue
     *  per operator. */
    createdByEmail: text("created_by_email"),
    placedAt: timestamp("placed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("orders_site_idx").on(t.siteId),
    index("orders_site_placed_idx").on(t.siteId, t.placedAt),
    index("orders_customer_idx").on(t.customerId),
    index("orders_status_idx").on(t.status),
    index("orders_razorpay_order_idx").on(t.razorpayOrderId),
    unique("orders_razorpay_payment_link_id_unique").on(t.razorpayPaymentLinkId),
    index("orders_created_via_idx").on(t.createdVia),
    index("orders_source_idx").on(t.source),
    index("orders_utm_campaign_idx").on(t.utmCampaign),
    index("orders_created_by_email_idx").on(t.createdByEmail),
    index("orders_awb_idx").on(t.awbCode),
    index("orders_shiprocket_shipment_idx").on(t.shiprocketShipmentId),
    unique("orders_idempotency_key_unique").on(t.idempotencyKey),
    // Reconciliation sweeps query (status, placed_at) for stale PENDING and
    // (status, paid_at) for PAID-without-shipment.
    index("orders_status_placed_idx").on(t.status, t.placedAt),
    index("orders_status_paid_idx").on(t.status, t.paidAt),
  ],
);

// ============================================================
// 8a. INVENTORY — atomic stock per (site_id, sku_id, variant_slug)
// ============================================================
// Order create runs:
//   UPDATE inventory SET stock = stock - $qty
//   WHERE site_id = $s AND sku_id = $k AND variant_slug = $v AND stock >= $qty
//   RETURNING stock;
// Zero rows back → reject (cannot oversell). Empty variantSlug = "" for SKUs
// without colour variants. Concurrency safe under Postgres' default isolation.

export const inventory = pgTable(
  "inventory",
  {
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    skuId: text("sku_id").notNull(),
    variantSlug: text("variant_slug").notNull().default(""),
    stock: integer("stock").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite PK is the single source of truth per (site, sku, variant) and
    // makes the seed UPSERT + atomic decrement safe. Declared here so Drizzle
    // never diffs it away (the constraint shipped in migration 0002).
    primaryKey({ columns: [t.siteId, t.skuId, t.variantSlug] }),
    // Hard floor: the gated UPDATE prevents oversell, this CHECK is the
    // last-line backstop so stock can never physically go negative.
    check("inventory_stock_nonneg", sql`${t.stock} >= 0`),
    index("inventory_site_sku_idx").on(t.siteId, t.skuId),
  ],
);

// ============================================================
// 8d. ANALYTICS SESSIONS — first-party, server-side visitor tracking
// ============================================================
// One row per visitor session, written by the edge middleware via a
// server-to-server call to /api/track (so ad-blockers never see it). A
// session is a 30-minute sliding window keyed by the `prc_sid` cookie; the
// stable `prc_vid` cookie (1 year) is the unique-visitor key. Both cookies
// are first-party and domain-scoped, so unique-visitor counts are naturally
// PER-SITE (the same person on two of our domains = two visitors, by design).
//
// Why sessions-only (no per-pageview table): the four dashboard metrics
// (visitors, conversion rate, live visitors, traffic sources) all derive from
// sessions, and prod runs one DB connection per Lambda. We UPSERT one row per
// pageview (incrementing pageviewCount) instead of inserting a row each time,
// halving write volume. Add a pageviews table later if path-level analytics
// is needed.
//
// Conversion rate is computed elsewhere as (paid orders ÷ sessions) over a
// date range — orders live in this same DB and are unblockable, so the
// numerator is exact; this table supplies an accurate denominator.

export const analyticsSessions = pgTable(
  "analytics_sessions",
  {
    /** The session UUID from the `prc_sid` cookie. Globally unique (crypto
     *  UUID), never a timestamp — distinct visitors starting in the same
     *  second must not collapse into one session. */
    id: text("id").primaryKey(),
    /** Stable visitor UUID from `prc_vid`. The unique-visitor key. */
    visitorId: text("visitor_id").notNull(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    /** Classified first-touch acquisition bucket: direct | organic | social |
     *  referral | paid | email | other. Last-click-with-precedence is applied
     *  at insert; first-touch is preserved (ON CONFLICT never overwrites it). */
    source: text("source").notNull().default("direct"),
    referrer: text("referrer"),
    referrerHost: text("referrer_host"),
    landingPath: text("landing_path"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    /** From Vercel's x-vercel-ip-country header. */
    country: text("country"),
    userAgent: text("user_agent"),
    /** Known crawler/bot UA → excluded from every dashboard count, but stored
     *  for debugging rather than dropped silently. */
    isBot: boolean("is_bot").notNull().default(false),
    pageviewCount: integer("pageview_count").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Bumped on every pageview within the 30-min window. Drives the
     *  "live visitors" card (last_seen within 5 min). */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Visitors + conversion denominator: scan a site's sessions in a date range.
    index("analytics_sessions_site_started_idx").on(t.siteId, t.startedAt),
    // Live visitors: most-recent activity per site.
    index("analytics_sessions_site_lastseen_idx").on(t.siteId, t.lastSeenAt),
    // Unique-visitor dedup across a range.
    index("analytics_sessions_visitor_idx").on(t.visitorId),
  ],
);

// ============================================================
// 8c. SHIPMENT JOBS — durable fulfillment queue (one job per order)
// ============================================================
// Exactly-once shipment creation. The PK on order_id means verify + webhook +
// COD-create + admin-retry all INSERT ... ON CONFLICT DO NOTHING → a single
// job ever exists per order. Workers claim a job by the atomic transition
// PENDING → PROCESSING (a conditional UPDATE), so only one worker runs it.
// Failed jobs back off and retry; a reconciliation cron drains the queue and
// re-enqueues any PAID order missing a job.

export const shipmentJobStatusEnum = pgEnum("shipment_job_status", [
  "PENDING",
  "PROCESSING",
  "DONE",
  "FAILED",
]);

export const shipmentJobs = pgTable(
  "shipment_jobs",
  {
    orderId: text("order_id")
      .primaryKey()
      .references(() => orders.id),
    status: shipmentJobStatusEnum("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    /** When the worker may next claim this job. Backoff pushes this forward. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when a worker transitions to PROCESSING. Lease for stuck-job reaping. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("shipment_jobs_claim_idx").on(t.status, t.nextAttemptAt),
  ],
);

// ============================================================
// 8b. NOTIFICATIONS OUTBOX — order/payment/shipment emails
// ============================================================

export const notificationsOutbox = pgTable(
  "notifications_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id").references(() => sites.id),
    orderId: text("order_id").references(() => orders.id),
    customerId: uuid("customer_id").references(() => customers.id),
    channel: text("channel").notNull(), // "email" | "whatsapp"
    template: text("template").notNull(), // ORDER_CONFIRMED | PAYMENT_CAPTURED | SHIPMENT_CREATED | DELIVERED
    /**
     * Idempotency key, typically `${orderId}:${template}`. UNIQUE — enqueue is
     * ON CONFLICT DO NOTHING so verify + webhook firing the same notification
     * can only ever create one outbox row. Also forwarded to Resend as its
     * Idempotency-Key so a double inline/cron send is deduped provider-side.
     */
    dedupKey: text("dedup_key"),
    /** Snapshot of recipient + variables at enqueue time. */
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    /** When the worker should next try this row. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    /**
     * Provider message id (Resend `email_id`) — set when we hand the message
     * to Resend. The /api/webhooks/resend receiver matches delivery events
     * back to this row by provider_id.
     */
    providerId: text("provider_id"),
    /**
     * ACTUAL delivery outcome from the provider's webhook — distinct from
     * sent_at (which only means "we handed it to Resend"). One of:
     * pending | sent | delivered | delayed | bounced | complained | failed.
     * `bounced`/`complained` mean the customer never got it → ops follow up
     * by phone.
     */
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    deliveryStatusAt: timestamp("delivery_status_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_pending_idx").on(t.sentAt, t.nextAttemptAt),
    index("notifications_order_idx").on(t.orderId),
    unique("notifications_dedup_key_unique").on(t.dedupKey),
  ],
);

// ============================================================
// 9. COUPONS
// ============================================================

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = applies to all sites */
    siteId: text("site_id").references(() => sites.id),
    code: text("code").notNull(),
    type: couponTypeEnum("type").notNull(),
    /** INR for FLAT_INR, percent×100 for PERCENT (e.g. 1500 = 15%) */
    value: integer("value").notNull(),
    minOrderInr: integer("min_order_inr").notNull().default(0),
    maxDiscountInr: integer("max_discount_inr"),
    /**
     * When set, this coupon is BOUND to a single catalog SKU id and only applies
     * if that SKU is in the cart. Null = applies to any cart (all existing
     * coupons). Used by the "Name your price" game so a bargain won on one car
     * can never be spent on another (which would bypass that car's discount
     * tier). Enforced in validateCoupon (preview) and redeemCoupon (authoritative).
     */
    constraintSkuId: text("constraint_sku_id"),
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").notNull().default(0),
    perCustomerLimit: integer("per_customer_limit"),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("coupons_site_code_unique").on(t.siteId, t.code)],
);

// ============================================================
// 9a. CUSTOMER COUPON REDEMPTIONS — per-customer-limit enforcement
// ============================================================
// Append-only ledger. Row inserted inside the order transaction so the
// per-customer count is consistent with the order it grants discount on.

export const customerCouponRedemptions = pgTable(
  "customer_coupon_redemptions",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    discountInr: integer("discount_inr").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("customer_coupon_lookup_idx").on(t.customerId, t.couponId),
  ],
);

// ============================================================
// 10. EVENTS — append-only audit log
// ============================================================

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id").references(() => sites.id),
    orderId: text("order_id").references(() => orders.id),
    customerId: uuid("customer_id").references(() => customers.id),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    source: text("source"), // "system" / "admin" / "webhook" / "user"
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("events_site_idx").on(t.siteId),
    index("events_order_idx").on(t.orderId),
    index("events_type_idx").on(t.type),
    index("events_created_idx").on(t.createdAt),
  ],
);

// ============================================================
// 10b. FUNNEL EVENTS — first-party "every user action" stream
// ============================================================
// High-volume, visitor/session-keyed behavioural telemetry that powers the
// conversion funnel + drop-off dashboard (page_view → product_view →
// add_to_cart → checkout_started → serviceability_checked → payment_* →
// purchase). Kept SEPARATE from `events` (which is the order-scoped audit log)
// so checkout telemetry never bloats the order history and can be pruned on a
// different schedule. No PII is stored here — only skuId, cart value, pincode
// (area-level), payment method, and failure reasons. First-party + business-
// essential, so it is captured without consent, exactly like analytics_sessions.
// `order_id` is intentionally NOT a foreign key: a funnel event can be recorded
// before the order row exists (or carry a client-supplied id), and a telemetry
// insert must never fail on an FK violation.

export const funnelEvents = pgTable(
  "funnel_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id").references(() => sites.id),
    /** prc_sid — 30-min session. */
    sessionId: text("session_id"),
    /** prc_vid — 1-year visitor. The unique-visitor key for funnel rates. */
    visitorId: text("visitor_id"),
    /** Funnel event type (see src/lib/funnel-events.ts FUNNEL_EVENTS). */
    type: text("type").notNull(),
    /** Page path where the event fired. */
    path: text("path"),
    /** Event-specific, NO PII: skuId, cartValueInr, itemCount, pincode,
     *  serviceable, codAvailable, paymentMethod, failureReason, etc. */
    metadata: jsonb("metadata").notNull().default({}),
    /** Set once an order exists. Loose (no FK) on purpose — see note above. */
    orderId: text("order_id"),
    isBot: boolean("is_bot").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("funnel_events_site_created_idx").on(t.siteId, t.createdAt),
    index("funnel_events_type_idx").on(t.type),
    index("funnel_events_session_idx").on(t.sessionId),
    index("funnel_events_visitor_idx").on(t.visitorId),
  ],
);

// ============================================================
// 11. WEBHOOKS INBOUND — idempotency on (source, external_id)
// ============================================================

export const webhooksInbound = pgTable(
  "webhooks_inbound",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // "razorpay" / "shiprocket"
    externalId: text("external_id").notNull(), // their event id for dedup
    payload: jsonb("payload").notNull(),
    processed: boolean("processed").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("webhooks_source_external_unique").on(t.source, t.externalId),
    index("webhooks_processed_idx").on(t.processed),
  ],
);

// ============================================================
// 11b. CHECKOUT LEADS — step-1 contact capture (pre-payment)
// ============================================================
// Written when a customer completes the DETAILS step of the 2-step checkout —
// i.e. they've entered name/phone/address — BEFORE they pay. This closes the
// gap where a lead was only ever captured once an order row existed (on the
// Pay click). Lets the team call / WhatsApp people who entered their contact
// yet never reached or completed payment.
//
// One OPEN row per customer (upsert on customer_id). Flipped to CONVERTED the
// moment that customer creates ANY order (paid OR payment-attempted), so the
// recovery list never double-counts someone already represented by an order
// row. Deliberately side-effect-free, unlike orders/create: NO stock hold, NO
// coupon redemption, NO Razorpay order — a half-filled lead must never touch
// inventory or money.
export const checkoutLeadStatusEnum = pgEnum("checkout_lead_status", [
  "OPEN",
  "CONVERTED",
]);

export const checkoutLeads = pgTable(
  "checkout_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    /** Shared customer identity (phone-keyed). UNIQUE → one lead per customer,
     *  upserted on each step-1 completion. */
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" })
      .unique(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    line1: text("line1"),
    line2: text("line2"),
    city: text("city"),
    state: text("state"),
    pincode: text("pincode"),
    /** Snapshot of the cart at the moment details were filled. */
    items: jsonb("items").notNull().default([]),
    subtotalInr: integer("subtotal_inr").notNull().default(0),
    status: checkoutLeadStatusEnum("status").notNull().default("OPEN"),
    /** Order this lead turned into, if any (set when status → CONVERTED). */
    convertedOrderId: text("converted_order_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("checkout_leads_site_created_idx").on(t.siteId, t.createdAt),
    index("checkout_leads_status_idx").on(t.status),
  ],
);

// ============================================================
// 11c. BARGAIN SESSIONS — "Name your price" negotiation game
// ============================================================
// Server-authoritative state for the exit-intent haggle game. The buyer gets
// N guesses against a HIDDEN floor (list × (1 − maxOff), jittered per session so
// there's no shareable magic number). A guess at/above the floor WINS at the
// guessed price; on win we mint a real single-use, short-TTL coupon in the
// `coupons` table and record its code here — so checkout, cart math and pricing
// stay untouched (a bargain is just "a coupon the buyer earned"). This table
// holds ONLY game state; it never touches money directly.
//
// UNIQUE(device_key, sku_id): one game per device per product. The row is
// upserted — after the cooldown window a fresh game overwrites the old one, so
// refreshing/replaying can't farm the floor. `status` is a plain text enum
// ('ACTIVE' | 'WON' | 'LOST') to keep the manual migration a single CREATE with
// no CREATE TYPE. floor_inr is written once at game start and never re-rolled.

export const bargainSessions = pgTable(
  "bargain_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    /** prc_vid (visitor cookie) when present, else a minted prc_bg cookie. The
     *  server-authoritative identity the 3-guess limit + cooldown are keyed to. */
    deviceKey: text("device_key").notNull(),
    skuId: text("sku_id").notNull(),
    /** List price the game opened against — snapshotted so a later catalog price
     *  change can't retroactively move the floor of a live game. */
    listInr: integer("list_inr").notNull(),
    /** SECRET reserve price. Guess ≥ this wins. Never sent to the client. */
    floorInr: integer("floor_inr").notNull(),
    attemptsUsed: integer("attempts_used").notNull().default(0),
    /** 'ACTIVE' | 'WON' | 'LOST'. Plain text (not pgEnum) on purpose. */
    status: text("status").notNull().default("ACTIVE"),
    /** The accepted price on a win (what the buyer pays for that unit). */
    wonPriceInr: integer("won_price_inr"),
    /** The single-use coupon minted on win (FK-free — it lives in `coupons`). */
    couponCode: text("coupon_code"),
    /** Won-coupon expiry = the 5-minute lock the countdown UI shows. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("bargain_device_sku_unique").on(t.deviceKey, t.skuId),
    index("bargain_sessions_site_created_idx").on(t.siteId, t.createdAt),
  ],
);

// ============================================================
// 12. ADMINS — cross-site dashboard access
// ============================================================

export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: uuid("auth_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** Sites this admin can manage. Owner gets all 5. Sandeep gets all. */
  siteIds: text("site_ids")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  role: adminRoleEnum("role").notNull().default("MANAGER"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ============================================================
// Inferred types for app code
// ============================================================

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Address = typeof addresses.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type Cart = typeof carts.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Coupon = typeof coupons.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type WebhookInbound = typeof webhooksInbound.$inferSelect;
export type AdminRow = typeof admins.$inferSelect;
export type NotificationRow = typeof notificationsOutbox.$inferSelect;
export type NewNotification = typeof notificationsOutbox.$inferInsert;
export type InventoryRow = typeof inventory.$inferSelect;
export type NewInventory = typeof inventory.$inferInsert;
export type ShipmentJob = typeof shipmentJobs.$inferSelect;
export type NewShipmentJob = typeof shipmentJobs.$inferInsert;
export type CustomerCouponRedemption = typeof customerCouponRedemptions.$inferSelect;
export type NewCustomerCouponRedemption = typeof customerCouponRedemptions.$inferInsert;
export type AnalyticsSession = typeof analyticsSessions.$inferSelect;
export type NewAnalyticsSession = typeof analyticsSessions.$inferInsert;
export type CheckoutLead = typeof checkoutLeads.$inferSelect;
export type NewCheckoutLead = typeof checkoutLeads.$inferInsert;
export type BargainSession = typeof bargainSessions.$inferSelect;
export type NewBargainSession = typeof bargainSessions.$inferInsert;

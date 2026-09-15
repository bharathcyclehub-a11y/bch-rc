/**
 * Admin auth helpers — used by /admin layout + admin API routes.
 *
 * Bootstrap pattern: when a user from ADMIN_FOUNDER_EMAILS signs in for
 * the first time, we auto-create their admins row with role=OWNER and
 * access to all sites. Once any owner exists, future admins are added
 * from the admin UI.
 */

import { cache } from "react";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, withDbRetry } from "@/db";
import { admins, sites } from "@/db/schema";
import { createClient } from "./supabase/server";

export type AdminContext = {
  authUserId: string;
  email: string;
  name: string | null;
  role: "OWNER" | "MANAGER" | "SUPPORT";
  siteIds: string[];
};

const FOUNDER_EMAILS = (process.env.ADMIN_FOUNDER_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * PHASE 3 — Founder bootstrap is a one-time setup mechanism, OFF by default.
 * Auto-provisioning of an OWNER admin from ADMIN_FOUNDER_EMAILS only happens
 * when ALLOW_FOUNDER_BOOTSTRAP === "true". Once the first owner exists, leave
 * this unset/false so a leaked/typo'd founder email can never silently mint a
 * new privileged account. Exported so the signin route enforces the same gate.
 */
export const FOUNDER_BOOTSTRAP_ENABLED =
  process.env.ALLOW_FOUNDER_BOOTSTRAP === "true";

/**
 * Single source of truth for "is this authenticated user an authorized,
 * active admin?". Reads the admins row; founder-bootstraps it on first
 * sign-in if the email is in ADMIN_FOUNDER_EMAILS. Returns the AdminContext
 * for an authorized active admin, or null for anyone else.
 *
 * Every DB call is wrapped in withDbRetry so a transient pooled-connection
 * drop ("Connection closed") on this critical path retries once instead of
 * throwing the whole admin section into the error boundary.
 *
 * Used by BOTH requireAdmin() (the layout/page gate) and the /api/admin/signin
 * route, so the two can never disagree about who may enter /admin.
 */
export async function resolveAdmin(user: {
  id: string;
  email: string;
  name: string | null;
}): Promise<AdminContext | null> {
  const email = user.email.toLowerCase();

  // Fast path: read first. The admin row exists in >99% of layout renders
  // (anyone who got past login has already been bootstrapped). One SELECT.
  let [row] = await withDbRetry(
    () => db.select().from(admins).where(eq(admins.email, email)),
    "admins.select",
  );

  // Slow path: only fall through to the founder bootstrap when the row is
  // genuinely missing AND bootstrap is explicitly enabled (PHASE 3). Avoids
  // the previous "INSERT … ON CONFLICT DO NOTHING" hitting the database on
  // every single admin-page render, and prevents indefinite auto-provisioning.
  if (!row && FOUNDER_EMAILS.includes(email) && FOUNDER_BOOTSTRAP_ENABLED) {
    const allSites = await withDbRetry(
      () => db.select({ id: sites.id }).from(sites),
      "sites.select",
    );
    const siteIds = allSites.map((s) => s.id);
    await withDbRetry(
      () =>
        db
          .insert(admins)
          .values({
            authUserId: user.id,
            email,
            name: user.name,
            siteIds,
            role: "OWNER",
            active: true,
          })
          .onConflictDoNothing({ target: admins.email }),
      "admins.bootstrap-insert",
    );
    [row] = await withDbRetry(
      () => db.select().from(admins).where(eq(admins.email, email)),
      "admins.select-after-bootstrap",
    );
  }

  if (!row || !row.active) return null;

  return {
    authUserId: user.id,
    email: row.email,
    name: row.name,
    role: row.role,
    siteIds: row.siteIds,
  };
}

/**
 * LOCAL DEVELOPMENT ONLY — act as ADMIN_DEV_EMAIL without Supabase, so the
 * admin runs against the local database (scripts/dev-db-setup.ts). Active only
 * under `next dev` (NODE_ENV=development) while Supabase is NOT configured and
 * ADMIN_DEV_EMAIL is set; the email must still be an active `admins` row in the
 * connected database. Production always runs NODE_ENV=production with Supabase
 * configured, so this path can never activate there.
 */
const DEV_ADMIN_EMAIL =
  process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_SUPABASE_URL
    ? process.env.ADMIN_DEV_EMAIL?.trim().toLowerCase() || null
    : null;

async function devAdminContext(email: string): Promise<AdminContext | null> {
  const [row] = await withDbRetry(
    () => db.select().from(admins).where(eq(admins.email, email)),
    "admins.select-dev",
  );
  if (!row || !row.active) return null;
  return {
    authUserId: row.authUserId,
    email: row.email,
    name: row.name,
    role: row.role,
    siteIds: row.siteIds,
  };
}

/**
 * Resolve the current admin context from the verified Supabase user.
 * Returns null if no authenticated user, no admin row, or the user is inactive.
 *
 * PHASE 1 — authorization decisions are based on getUser(), NOT getSession().
 * getUser() re-validates the JWT against Supabase Auth, so we never authorize
 * off an unverified cookie. getSession() decodes the cookie locally without
 * verification and must not gate access on its own.
 *
 * Wrapped in React cache() so the layout and the page that both call
 * requireAdmin() during the same request share a single verification + lookup
 * instead of each issuing its own round-trip.
 */
export const getAdminContext = cache(
  async (): Promise<AdminContext | null> => {
    if (DEV_ADMIN_EMAIL) return devAdminContext(DEV_ADMIN_EMAIL);
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    // No verified user (no session, expired, or tampered cookie) → not an
    // admin. This is an authorization "no", distinct from a DB outage, which
    // resolveAdmin() surfaces as a thrown DatabaseUnavailableError.
    if (error || !user || !user.email) return null;

    return resolveAdmin({
      id: user.id,
      email: user.email.toLowerCase(),
      name: (user.user_metadata?.name as string) || null,
    });
  },
);

/**
 * Use at the top of an admin server component. Redirects to /admin/login
 * if no session, or 404s if the user isn't an admin.
 */
export async function requireAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) redirect("/admin/login");
  return ctx;
}

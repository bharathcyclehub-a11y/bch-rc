/**
 * Drizzle client — used by Next.js server-side code (route handlers, server actions).
 *
 * Connection strategy:
 * - Runtime queries (API routes, server components) → pooled connection
 *   (port 6543) via Supabase Supavisor in transaction mode.
 * - Migrations (drizzle-kit push/generate) → direct connection (port 5432).
 *
 * Vercel-serverless tuning (the difference between "works" and intermittent
 * `Connection closed` storms):
 *
 *   max: 1
 *     One connection per Lambda instance. Concurrent requests on Vercel
 *     spawn new container instances, each with its own pool of size 1, so
 *     total concurrency is governed by Lambda fan-out, not per-instance
 *     pooling. Lambdas are short-lived; a per-instance pool >1 just holds
 *     idle connections that the Supabase pooler / Vercel NAT will reap
 *     under us — when the pool hands one back, the next query sees
 *     "Connection closed".
 *
 *   idle_timeout: 20
 *     Evict our side of any connection that's been idle 20 s. Aligned with
 *     a typical Lambda invocation. Without this we keep dead sockets.
 *
 *   connect_timeout: 10
 *     Fail fast if the pooler is unreachable rather than blocking the
 *     function for its default 30 s.
 *
 *   prepare: false
 *     Required by Supavisor / pgBouncer transaction mode — prepared
 *     statements don't survive across transactions on a pooled session.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { logError, logWarn } from "@/lib/logger";

const connectionString =
  process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;

// During `next build`, env-bound secrets can legitimately be absent — e.g. a
// Vercel *Preview* build where DATABASE_URL isn't set for that environment.
// The build only IMPORTS this module to collect route metadata; it never runs
// a query. So in build phase we tolerate a missing DSN and fall back to a
// non-connecting placeholder (postgres-js connects lazily, only on first
// query), letting the build succeed. At RUNTIME a missing DSN still throws
// loudly — a real serverless function with no DB config must fail fast.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

if (!connectionString && !isBuildPhase) {
  throw new Error(
    "DATABASE_URL_POOLED or DATABASE_URL must be set (see .env.local).",
  );
}

const effectiveDsn =
  connectionString ?? "postgresql://build:build@127.0.0.1:5432/build";

/**
 * PHASE 6 — startup validation of the runtime connection string.
 *
 * Runtime queries MUST go through the Supabase Supavisor pooler in
 * *transaction* mode, otherwise the serverless fan-out produces the
 * "Connection closed" storms documented above. The transaction pooler is
 * identified by:
 *   - host containing "pooler.supabase.com"  (Supavisor, not the direct db host)
 *   - port 6543                              (transaction mode; 5432 is session/direct)
 *
 * We fail loudly at runtime on an unambiguous misconfiguration (e.g. the
 * direct :5432 DSN pasted into the pooled slot). During `next build` we only
 * warn — the build must not be coupled to a specific deployment's DSN.
 */
function validateRuntimeDsn(dsn: string): string[] {
  const problems: string[] = [];
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return ["DATABASE_URL is not a parseable connection URL."];
  }
  const usingPooledVar = Boolean(process.env.DATABASE_URL_POOLED);
  const isPoolerHost = url.hostname.includes("pooler.supabase.com");
  const port = url.port || "5432";

  // Only enforce pooler/transaction-mode rules when the explicit pooled var is
  // the one in use. If only DATABASE_URL is set, the operator has opted out of
  // pooling knowingly (e.g. local dev / migrations) — warn, don't fail.
  if (usingPooledVar) {
    if (!isPoolerHost) {
      problems.push(
        `DATABASE_URL_POOLED host "${url.hostname}" is not a Supavisor pooler ` +
          `host (expected *.pooler.supabase.com). This looks like a direct ` +
          `connection and will cause "Connection closed" storms under serverless fan-out.`,
      );
    }
    if (port !== "6543") {
      problems.push(
        `DATABASE_URL_POOLED port is ${port}, expected 6543 (Supavisor ` +
          `transaction mode). Port 5432 is the session/direct endpoint.`,
      );
    }
  } else {
    logWarn(
      "db:config",
      "DATABASE_URL_POOLED is not set; runtime queries are using the direct " +
        "DATABASE_URL. Set the Supavisor transaction pooler (port 6543) for serverless.",
      { host: url.hostname, port },
    );
  }
  return problems;
}

if (connectionString) {
  const problems = validateRuntimeDsn(connectionString);
  if (problems.length > 0) {
    const summary = `Invalid database connection configuration:\n - ${problems.join("\n - ")}`;
    if (isBuildPhase) {
      // Don't break the build on a deployment-specific DSN; surface loudly in logs.
      logWarn("db:config", summary);
    } else {
      logError("db:config", new Error(summary));
      throw new Error(summary);
    }
  }
}

// Cache the postgres-js client on globalThis. Without this, Next.js dev
// HMR creates a fresh pool every time this module is re-evaluated (which
// happens whenever any file in its import graph changes); the old pool's
// TCP sockets linger in the background. Over a long dev session you
// accumulate orphaned sockets — the next time one is handed back to the
// app the server-side state is inconsistent and the first query on it
// hangs until Postgres' statement_timeout cancels it, surfacing as
// "PostgresError: canceling statement due to statement timeout" on a
// trivial indexed SELECT. In production each Lambda cold-start re-evaluates
// the module once, so the cache is a harmless no-op there.
//
// max_lifetime: 5 minutes. The Supabase Supavisor pooler holds idle
// upstream connections for a finite window. Without an aggressive
// max_lifetime, a long-lived Lambda instance can hand back a postgres-js
// connection whose Supavisor counterpart has already been reaped — same
// failure mode as the HMR-orphan case. Five minutes is well under any
// pooler keepalive threshold and frequent enough that no connection ever
// sees stale upstream state.
//
// max: 3 — small per-Lambda pool, big enough for one Promise.all of 4-5
// admin aggregates to genuinely parallelise.
//
// DATABASE_POOL_MAX overrides the pool size (unset in production → 3). The
// local dev database (scripts/dev-db-setup.ts, PGlite) is a single Postgres
// session, so it runs with 1 to keep concurrent queries from colliding.
const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof postgres>;
  __pgClientKey?: string;
};

const poolMax = Number(process.env.DATABASE_POOL_MAX) || 3;
// The dev cache is keyed by DSN + pool size so editing .env.local takes effect
// without restarting the dev server.
const clientKey = `${effectiveDsn}|${poolMax}`;

const queryClient =
  globalForDb.__pgClient && globalForDb.__pgClientKey === clientKey
    ? globalForDb.__pgClient
    : postgres(effectiveDsn, {
        prepare: false,
        max: poolMax,
        idle_timeout: 20,
        max_lifetime: 60 * 5,
        connect_timeout: 10,
      });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pgClient = queryClient;
  globalForDb.__pgClientKey = clientKey;
}

export const db = drizzle(queryClient, { schema });
export { schema };

/**
 * Thrown when a query fails with a transient connection error AND the single
 * retry also fails — i.e. the database is genuinely unreachable, not just a
 * stale socket. Callers can catch this to distinguish "DB outage" (show a
 * try-again message, keep the user where they are) from "not authorized"
 * (a clean null result). Never thrown for query/validation errors.
 */
export class DatabaseUnavailableError extends Error {
  readonly operation: string;
  constructor(operation: string, options?: { cause?: unknown }) {
    super(`Database unavailable during "${operation}"`, options);
    this.name = "DatabaseUnavailableError";
    this.operation = operation;
  }
}

/**
 * postgres-js throws these when it hands back a socket whose Supabase
 * Supavisor upstream was already reaped (see the connection-strategy notes
 * above), or when the pooler is unreachable. These are retryable.
 */
function isTransientConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    msg.includes("connection closed") ||
    msg.includes("connection_ended") ||
    msg.includes("connection terminated") ||
    msg.includes("econnreset") ||
    msg.includes("connect_timeout") ||
    msg.includes("connection timeout") ||
    // Postgres cancels a query that runs past statement_timeout under load.
    // Cosmetically a "permanent" error per the legacy classifier, but the
    // query itself isn't broken — a retry on a fresh connection often
    // succeeds when the pool isn't saturated. Stops the dashboard-under-load
    // failure mode from surfacing as a hard error to the operator.
    msg.includes("canceling statement due to statement timeout")
  );
}

/**
 * PHASE 4 — Retry a query exactly once on a transient pooled-connection drop,
 * with structured logging and a clear transient/permanent distinction.
 *
 * - Permanent errors (constraint violations, bad SQL, anything not a
 *   connection drop) are logged and rethrown immediately — never retried,
 *   never swallowed.
 * - Transient connection errors are retried exactly once on a fresh pool
 *   connection. The retry attempt is logged (warn).
 * - If the retry also fails transiently, we throw DatabaseUnavailableError so
 *   the caller can render a graceful "temporarily unavailable" UX instead of
 *   the generic crash boundary.
 *
 * Nothing is ever silently swallowed: every failure path emits a log line
 * tagged with the operation name, attempt number, and classification.
 *
 * @param operation short label for logs, e.g. "admins.select".
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  operation = "db-query",
): Promise<T> {
  const MAX_ATTEMPTS = 2; // initial try + exactly one retry
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientConnectionError(err)) {
        logError("db:query", err, { operation, attempt, classification: "permanent" });
        throw err;
      }
      if (attempt >= MAX_ATTEMPTS) {
        logError("db:query", err, {
          operation,
          attempt,
          classification: "transient-exhausted",
        });
        throw new DatabaseUnavailableError(operation, { cause: err });
      }
      logWarn("db:query", "transient connection error — retrying once", {
        operation,
        attempt,
        next_attempt: attempt + 1,
      });
    }
  }
  // Unreachable (loop either returns or throws) — satisfies the type checker.
  throw new DatabaseUnavailableError(operation);
}

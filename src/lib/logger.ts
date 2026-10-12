/**
 * Typed error logger. The only place we should write to console.error.
 *
 * - Strips full error objects → message + stack only (no upstream API tokens
 *   echoed in error.response.body bleeding into Vercel logs).
 * - Always attaches a scope so logs are greppable: `[order:create] ...`.
 * - Safelists context fields — pass orderId/customerId, never email/phone.
 * - Survives without Sentry; degrades to console.error.
 */

type LogContext = Record<string, string | number | boolean | null | undefined>;

function safeMessage(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    // Drizzle wraps driver errors ("Failed query: …") and keeps the real
    // Postgres / connection reason on `cause` — without it the log is useless.
    const cause = err.cause instanceof Error ? ` | cause: ${err.cause.message}` : "";
    return { message: `${err.message}${cause}`, stack: err.stack };
  }
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: "unserializable error" };
  }
}

export function logError(
  scope: string,
  err: unknown,
  context: LogContext = {},
): void {
  const { message, stack } = safeMessage(err);
  const ctx = Object.entries(context)
    .map(([k, v]) => `${k}=${v ?? "-"}`)
    .join(" ");
  console.error(`[${scope}] ${message}${ctx ? ` (${ctx})` : ""}`);
  if (stack && process.env.NODE_ENV !== "production") {
    console.error(stack);
  }
  // Future: forward to Sentry via @sentry/nextjs.captureException(err, { tags: { scope }, extra: context })
}

export function logWarn(scope: string, message: string, context: LogContext = {}): void {
  const ctx = Object.entries(context)
    .map(([k, v]) => `${k}=${v ?? "-"}`)
    .join(" ");
  console.warn(`[${scope}] ${message}${ctx ? ` (${ctx})` : ""}`);
}

export function logInfo(scope: string, message: string, context: LogContext = {}): void {
  const ctx = Object.entries(context)
    .map(([k, v]) => `${k}=${v ?? "-"}`)
    .join(" ");
  console.log(`[${scope}] ${message}${ctx ? ` (${ctx})` : ""}`);
}

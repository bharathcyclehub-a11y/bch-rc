/**
 * Env-value hygiene.
 *
 * Values pasted through dashboards (Vercel/GitHub secrets, `vercel env pull`)
 * routinely arrive carrying a UTF-8 BOM and a trailing "\r\n" — sometimes as
 * real control characters, sometimes as the literal two-character sequences
 * \r and \n that a double-quoted .env value preserves. Node hands those to us
 * verbatim, so `ORDER_ALERT_EMAILS` ends in an address Resend rejects and
 * `RESEND_WEBHOOK_SECRET` never matches the signature.
 *
 * Every read of a secret/recipient env var goes through `envStr` so one bad
 * paste can't silently disable alerts or webhooks again. Mirrors the defensive
 * parse already done for SHIPROCKET_PICKUP_PINCODE (see lib/shiprocket.ts).
 */

/** Read an env var with BOM, real CR/LF and literal "\r"/"\n" stripped. */
export function envStr(key: string): string {
  return sanitizeEnvValue(process.env[key]);
}

/** Exported for the same cleanup on values not read straight from process.env. */
export function sanitizeEnvValue(raw: string | undefined | null): string {
  return (raw ?? "")
    .replace(/﻿/g, "") // byte-order mark, anywhere in the value
    .replace(/\\[rn]/g, "") // literal backslash-r / backslash-n from quoted .env values
    .replace(/[\u0000-\u001F\u007F]/g, "") // real control chars incl. CR/LF
    .trim();
}

"use server";

/**
 * Order verification for the customer Support Centre.
 *
 *   verifyOrderAction  step 1 (send code) / resend / step 2 (confirm code)
 *   signOutSupportAction  clears the verified session
 *
 * Every branch re-validates its inputs from the FormData (the client-held
 * previous state is only used for the resend counter). Codes, emails and
 * phone numbers are never logged.
 */

import { redirect } from "next/navigation";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { clearSupportSession, setSupportSession } from "@/lib/support/session";
import { ORDER_ID_RE, confirmOrderVerification, normaliseOrderId, startOrderVerification } from "@/lib/support/verify";
import { TOO_MANY, allowAction, requestIpHash } from "../_lib/guard";

export type VerifyNext = "" | "claim" | "refund" | "delivery";

export type VerifyState = {
  step: "details" | "code";
  orderId: string;
  contact: string;
  next: VerifyNext;
  challengeId: string | null;
  /** Masked email the code went to. */
  destination: string | null;
  /** Increments on every code sent — restarts the client's resend timer. */
  sentCount: number;
  error: string | null;
  errorCode: string | null;
  notice: string | null;
};

const NextParam = z.enum(["claim", "refund", "delivery"]).catch("claim");

const StartInput = z.object({
  orderId: z
    .string()
    .trim()
    .max(20)
    .transform(normaliseOrderId)
    .refine((v) => ORDER_ID_RE.test(v)),
  contact: z.string().trim().min(4).max(120),
});

const ConfirmInput = z.object({
  challengeId: z.string().regex(/^[0-9a-f-]{36}$/i),
  code: z
    .string()
    .max(20)
    .transform((s) => s.replace(/\D/g, ""))
    .refine((s) => s.length === 6),
});

const text = (fd: FormData, key: string, max: number) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
};

const GENERIC = "Something went wrong on our side. Please try again in a minute.";

export async function verifyOrderAction(prev: VerifyState, fd: FormData): Promise<VerifyState> {
  const intent = fd.get("intent");
  const rawNext = text(fd, "next", 10);
  const next: VerifyNext = rawNext ? NextParam.parse(rawNext) : "";
  const sentCount = Number.isInteger(prev?.sentCount) ? prev.sentCount : 0;
  const orderIdRaw = text(fd, "orderId", 20).toUpperCase();
  const contactRaw = text(fd, "contact", 120);
  const base: VerifyState = {
    step: "details",
    orderId: orderIdRaw,
    contact: contactRaw,
    next,
    challengeId: null,
    destination: null,
    sentCount,
    error: null,
    errorCode: null,
    notice: null,
  };

  // ── Step 1 / resend: send a code to the email on the order ────────────
  if (intent === "start" || intent === "resend") {
    const resend = intent === "resend";
    const keepCodeStep = resend ? { step: "code" as const, challengeId: text(fd, "challengeId", 36) || null, destination: text(fd, "destination", 120) || null } : {};
    const parsed = StartInput.safeParse({ orderId: orderIdRaw, contact: contactRaw });
    if (!parsed.success) {
      return {
        ...base,
        error: "Enter your order ID (it looks like PRC-XXXXXXXX) and the phone number or email used at checkout.",
        errorCode: "INVALID",
      };
    }
    const { orderId, contact } = parsed.data;
    if (!(await allowAction("support:verify", 10, 15 * 60_000))) {
      return { ...base, ...keepCodeStep, orderId, contact, error: TOO_MANY, errorCode: "RATE_LIMITED" };
    }
    try {
      const r = await startOrderVerification({ orderId, contact, ipHash: await requestIpHash() });
      if (!r.ok) {
        return {
          ...base,
          ...(resend && r.code === "RATE_LIMITED" ? keepCodeStep : {}),
          orderId,
          contact,
          error: r.message,
          errorCode: r.code,
        };
      }
      return {
        ...base,
        step: "code",
        orderId,
        contact,
        challengeId: r.challengeId,
        destination: r.destination,
        sentCount: sentCount + 1,
        notice: resend ? "We've sent a new code. Use the newest email." : null,
      };
    } catch (err) {
      logError("support:verify-start", err);
      return { ...base, ...keepCodeStep, orderId, contact, error: GENERIC, errorCode: "ERROR" };
    }
  }

  // ── Step 2: check the code, then sign the customer in ─────────────────
  if (intent === "confirm") {
    const codeStep: VerifyState = {
      ...base,
      step: "code",
      challengeId: text(fd, "challengeId", 36) || null,
      destination: text(fd, "destination", 120) || null,
    };
    const parsed = ConfirmInput.safeParse({ challengeId: fd.get("challengeId"), code: fd.get("code") ?? "" });
    if (!parsed.success) {
      return { ...codeStep, error: "Enter the 6-digit code from the email.", errorCode: "INVALID" };
    }
    if (!(await allowAction("support:verify-confirm", 30, 15 * 60_000))) {
      return { ...codeStep, error: TOO_MANY, errorCode: "RATE_LIMITED" };
    }
    let orderId: string;
    try {
      const r = await confirmOrderVerification(parsed.data);
      if (!r.ok) return { ...codeStep, error: r.message, errorCode: r.code };
      await setSupportSession({ customerId: r.customerId, email: r.email, orderId: r.orderId });
      orderId = r.orderId;
    } catch (err) {
      logError("support:verify-confirm", err);
      return { ...codeStep, error: GENERIC, errorCode: "ERROR" };
    }
    redirect(`/support/order/${encodeURIComponent(orderId)}${next ? `?next=${next}#get-help` : ""}`);
  }

  return { ...base, error: GENERIC, errorCode: "ERROR" };
}

export async function signOutSupportAction(): Promise<void> {
  await clearSupportSession();
  redirect("/support/order");
}

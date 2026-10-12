/**
 * POST /api/support/assistant
 *
 * One turn of the automated support menu on /support/chat (guided rules, not
 * AI). Body: { text ≤ 500, state, transcript ≤ 20 }. The verified support
 * session is read here on the server — never taken from the body — so a
 * hand-off can only create a ticket for the customer who is signed in.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/logger";
import { getSupportSession } from "@/lib/support/session";
import { handleAssistantTurn } from "@/lib/support/assistant";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const Body = z.object({
  text: z.string().max(500),
  state: z
    .object({
      pending: z.literal("ORDER_ID").optional(),
      dissatisfied: z.number().int().min(0).max(20).optional(),
      lastIntent: z.string().max(30).optional(),
    })
    .default({}),
  transcript: z
    .array(z.object({ from: z.enum(["customer", "assistant"]), text: z.string().max(1000) }))
    .max(20)
    .default([]),
});

export async function POST(req: Request) {
  const limited = rateLimit(req, { scope: "support:assistant", limit: 30 });
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });

  try {
    const session = await getSupportSession();
    const { reply, state } = await handleAssistantTurn({
      text: parsed.data.text,
      state: parsed.data.state,
      transcript: parsed.data.transcript,
      session,
      channel: "CHAT",
    });
    return NextResponse.json({ reply, state }, { headers: NO_STORE });
  } catch (err) {
    logError("support:assistant", err);
    return NextResponse.json({ error: "unavailable" }, { status: 500, headers: NO_STORE });
  }
}

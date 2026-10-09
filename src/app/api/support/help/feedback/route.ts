/**
 * POST /api/support/help/feedback  { slug, helpful }
 *
 * "This worked" / "Still not working" counts on a help guide. Rate limited
 * per IP; only published guides are counted (recordArticleFeedback).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/logger";
import { recordArticleFeedback } from "@/lib/support/kb";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const Body = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/), helpful: z.boolean() });

export async function POST(req: Request) {
  const limited = rateLimit(req, { scope: "support:feedback", limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE });

  try {
    await recordArticleFeedback(parsed.data.slug, parsed.data.helpful);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    logError("support:feedback", err, { slug: parsed.data.slug });
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

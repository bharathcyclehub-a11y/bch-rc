import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectClaritySnapshot } from "@/lib/clarity-snapshots";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || Buffer.byteLength(auth) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await collectClaritySnapshot();
  return NextResponse.json(result, { status: result.status === "error" ? 503 : 200 });
}

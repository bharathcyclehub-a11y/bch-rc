/**
 * GET /api/support/track?id=PRC-XXXXXXXX
 *
 * Public delivery-status view for /support/track. Knowing an order id is
 * enough to see DELIVERY STATUS only — getPublicTrackingView() carries no
 * name, address, phone, items or amounts. Rate limited per IP to blunt id
 * enumeration; never cached, because the answer changes as the courier moves.
 */

import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/logger";
import { getPublicTrackingView } from "@/lib/tracking/view";

export const dynamic = "force-dynamic";

const ORDER_ID_RE = /^PRC-[A-Z0-9]{4,12}$/;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const limited = rateLimit(req, { scope: "support:track", limit: 30 });
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  const id = (new URL(req.url).searchParams.get("id") ?? "").trim().toUpperCase();
  if (!ORDER_ID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400, headers: NO_STORE });
  }

  try {
    const view = await getPublicTrackingView(id);
    if (!view) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (err) {
    logError("support:track", err, { orderId: id });
    return NextResponse.json({ error: "unavailable" }, { status: 500, headers: NO_STORE });
  }
}

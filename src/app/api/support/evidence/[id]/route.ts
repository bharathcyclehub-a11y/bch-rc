/**
 * GET /api/support/evidence/<attachmentId>?t=<ticketNumber>&k=<token>
 *
 * Serves a private ticket attachment after an access check:
 *   (a) the customer's verified support session owns the ticket, or
 *   (b) `t` + `k` are the ticket number and its secret link token, or
 *   (c) an admin with support.view.
 * Then redirects to a short-lived signed URL (Supabase) or streams the bytes
 * (local dev). Every "no" is the same 404 so the route never confirms that an
 * attachment exists. Never cached.
 */

import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/logger";
import { getAdminContext } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { getSupportSession } from "@/lib/support/session";
import { findTicketForCustomer } from "@/lib/support/tickets";
import { evidenceSource } from "@/lib/support/evidence";
import { getAttachmentAccess } from "@/lib/support/customer-queries";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

async function isSupportAdmin(): Promise<boolean> {
  try {
    const ctx = await getAdminContext();
    return !!ctx && can(ctx.role, "support.view");
  } catch {
    return false;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, { scope: "support:evidence", limit: 120 });
  if (limited) {
    limited.headers.set("Cache-Control", "private, no-store");
    return limited;
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  try {
    const att = await getAttachmentAccess(id);
    if (!att) return notFound();

    let allowed = false;
    const session = await getSupportSession();
    if (session && att.ticketCustomerId && att.ticketCustomerId === session.customerId) allowed = true;

    if (!allowed) {
      const url = new URL(req.url);
      const t = (url.searchParams.get("t") ?? "").slice(0, 12);
      const k = (url.searchParams.get("k") ?? "").slice(0, 64);
      if (t && k) {
        const ticket = await findTicketForCustomer(t, { token: k });
        allowed = !!ticket && ticket.id === att.ticketId;
      }
    }

    if (!allowed) allowed = await isSupportAdmin();
    if (!allowed) return notFound();

    const src = await evidenceSource(att.storagePath);
    if (!src) return notFound();
    if (src.kind === "url") {
      return NextResponse.redirect(src.url, { status: 302, headers: { ...NO_STORE, "Referrer-Policy": "no-referrer" } });
    }
    return new NextResponse(new Uint8Array(src.body), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": att.mimeType,
        "Content-Length": String(src.body.length),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    logError("support:evidence", err, { attachment: id });
    return NextResponse.json({ error: "unavailable" }, { status: 500, headers: NO_STORE });
  }
}

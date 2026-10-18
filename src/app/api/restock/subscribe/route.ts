import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { subscribeRestockAlert } from "@/lib/restock";
import { rateLimit } from "@/lib/rate-limit";
import { recordServerFunnelEvent } from "@/lib/funnel-server";

const BodySchema = z.object({
  skuId: z.string().min(1).max(80),
  variantSlug: z.string().max(40).nullable().optional(),
  channel: z.enum(["email", "whatsapp"]),
  contact: z.string().min(3).max(160),
  consent: z.boolean(),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { scope: "restock:subscribe", limit: 15 });
  if (limited) return limited;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid subscription details." },
      { status: 400 },
    );
  }

  const res = await subscribeRestockAlert({
    skuId: body.skuId,
    variantSlug: body.variantSlug ?? "",
    channel: body.channel,
    contact: body.contact,
    consent: body.consent,
  });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error ?? "Subscription failed." },
      { status: 400 },
    );
  }

  // Record non-PII funnel event
  await recordServerFunnelEvent(
    req,
    "restock_request",
    {
      skuId: body.skuId,
      variantSlug: body.variantSlug ?? "",
      channel: body.channel,
    },
    { path: `/product/${body.skuId}` },
  ).catch(() => {});

  return NextResponse.json({
    ok: true,
    deduplicated: Boolean(res.deduplicated),
  });
}

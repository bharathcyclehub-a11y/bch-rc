import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeRestockAlert } from "@/lib/restock";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { scope: "restock:unsubscribe", limit: 30 });
  if (limited) return limited;

  const token = req.nextUrl.searchParams.get("token") ?? "";
  const res = await unsubscribeRestockAlert(token);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Restock Alert Preferences — Pocket RC Cars</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#faf8f5;color:#111;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px">
  <div style="background:#fff;border:1px solid #e5e2dc;border-radius:16px;padding:32px;max-width:420px;text-align:center">
    <h1 style="font-size:20px;margin:0 0 12px">${
      res.ok ? "You've been unsubscribed" : "Unsubscribe link expired or invalid"
    }</h1>
    <p style="font-size:14px;color:#555;line-height:1.5;margin:0 0 24px">
      ${
        res.ok
          ? `You will no longer receive back-in-stock alerts${
              res.skuName ? ` for ${res.skuName}` : ""
            }.`
          : "This restock alert link has already been used or is invalid."
      }
    </p>
    <a href="/" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 20px;border-radius:999px">Back to Pocket RC Cars</a>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: res.ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { scope: "restock:unsubscribe", limit: 30 });
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token = body.token ?? req.nextUrl.searchParams.get("token") ?? "";
  const res = await unsubscribeRestockAlert(token);
  return NextResponse.json({ ok: res.ok, skuName: res.skuName });
}

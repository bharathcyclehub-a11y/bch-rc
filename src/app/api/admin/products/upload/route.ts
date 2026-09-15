/**
 * POST /api/admin/products/upload  (admin-gated, multipart/form-data "file")
 *
 * Uploads one product image for an admin DRAFT to Supabase Storage (public
 * bucket "product-images") and returns its public URL. Mirrors the review
 * upload pipeline: mime allow-list, size cap, sharp resize → WebP, EXIF
 * stripped. Catalogue (code) product images are not managed here.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { getAdminContext } from "@/lib/admin-auth";
import { can } from "@/lib/admin/permissions";
import { createAdminClient } from "@/lib/supabase/server";

const BUCKET = "product-images";
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request) {
  const ctx = await getAdminContext();
  if (!ctx) return NextResponse.json({ ok: false, reason: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "products.edit"))
    return NextResponse.json({ ok: false, reason: "You don't have permission to edit products." }, { status: 403 });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json(
      { ok: false, reason: "Image uploads need Supabase Storage, which isn't configured here. Paste an image URL instead." },
      { status: 503 },
    );

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ ok: false, reason: "Bad form data" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ ok: false, reason: "No file" }, { status: 400 });
  if (!ALLOWED.has(file.type))
    return NextResponse.json({ ok: false, reason: "Only JPG, PNG or WebP images." }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, reason: "Image must be under 8 MB." }, { status: 413 });

  let optimized: Buffer;
  try {
    optimized = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return NextResponse.json({ ok: false, reason: "Couldn't process that image — try another." }, { status: 422 });
  }

  const supabase = createAdminClient();
  // Idempotent: "already exists" is the common, harmless error.
  await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES });

  const path = `drafts/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.webp`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, optimized, { contentType: "image/webp", upsert: false });
  if (error) return NextResponse.json({ ok: false, reason: "Upload failed — try again." }, { status: 502 });

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}

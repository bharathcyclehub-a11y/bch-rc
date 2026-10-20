/**
 * POST /api/reviews/upload  (multipart/form-data, field "file")
 *
 * Uploads a single review photo to Supabase Storage and returns its public
 * URL. The URL is then submitted with the review body (see the `images` field
 * on /api/reviews/submit). Verified-buyer gating happens at SUBMIT time — an
 * uploaded image is inert until it's attached to an accepted review, so a
 * stray upload costs nothing but a stored file.
 *
 * Guardrails: per-IP rate limit, image mime allow-list, 5 MB cap.
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

const BUCKET = "review-images";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  const limited = rateLimit(req, { scope: "reviews:upload", limit: 20 });
  if (limited) return limited;

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ ok: false, reason: "Bad form data" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ ok: false, reason: "No file" }, { status: 400 });
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json(
      { ok: false, reason: "Only JPG, PNG or WebP images." },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, reason: "Image must be under 5 MB." },
      { status: 413 },
    );
  }

  const supabase = createAdminClient();
  // Idempotently ensure the bucket exists (public read). Ignoring the error
  // covers the common "already exists" case without an extra round trip.
  await supabase.storage
    .createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES })
    .catch(() => {});

  // Optimize before storing: a 5 MB phone photo is displayed at ~64px, so
  // resize to max 1200px, convert to WebP q80, and drop EXIF/GPS metadata
  // (sharp strips metadata by default; `.rotate()` bakes in the orientation
  // first so portrait photos don't end up sideways). Result is ~150-250 KB.
  // Existing stored review images are untouched — only new uploads run this.
  let optimized: Buffer;
  try {
    optimized = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "Couldn't process that image — try another." },
      { status: 422 },
    );
  }

  const path = `${crypto.randomUUID()}.webp`;
  const uploadBlob = new Blob([new Uint8Array(optimized)], { type: "image/webp" });
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, uploadBlob, { contentType: "image/webp", upsert: false });
  if (error) {
    return NextResponse.json(
      { ok: false, reason: error.message || "Upload failed" },
      { status: 502 },
    );
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}

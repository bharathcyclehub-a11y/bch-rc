/**
 * Ticket evidence (photos / short videos).
 *
 * Stored in the PRIVATE Supabase Storage bucket "support-evidence" — never a
 * public URL. Files are served only through /api/support/evidence/[id], which
 * checks the viewer (ticket owner or staff) and then redirects to a 10-minute
 * signed URL. Photos are re-encoded (WebP, max 2000 px) which also strips
 * EXIF/GPS metadata; videos are stored as uploaded.
 *
 * Without Supabase credentials (local dev on PGlite) files go to
 * ./.support-uploads instead, so the flow is testable offline.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/server";

export const EVIDENCE_BUCKET = "support-evidence";
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
export const MAX_EVIDENCE_FILES = 5;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

export const EVIDENCE_ACCEPT = [...IMAGE_TYPES, ...Object.keys(VIDEO_TYPES)].join(",");

const LOCAL_DIR = path.join(process.cwd(), ".support-uploads");
const supabaseConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type StoredEvidence = { storagePath: string; mimeType: string; sizeBytes: number; originalName: string };

export class EvidenceError extends Error {}

export async function storeEvidence(file: File, ticketId: string): Promise<StoredEvidence> {
  if (file.size === 0) throw new EvidenceError("That file is empty.");
  if (file.size > MAX_EVIDENCE_BYTES) throw new EvidenceError("Each file must be under 20 MB.");
  let body: Buffer;
  let mimeType: string;
  let ext: string;
  if (IMAGE_TYPES.has(file.type)) {
    try {
      body = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new EvidenceError("We couldn't read that photo. Try a JPG or PNG.");
    }
    mimeType = "image/webp";
    ext = "webp";
  } else if (VIDEO_TYPES[file.type]) {
    body = Buffer.from(await file.arrayBuffer());
    mimeType = file.type;
    ext = VIDEO_TYPES[file.type];
  } else {
    throw new EvidenceError("Only photos (JPG, PNG, WebP, HEIC) or videos (MP4, MOV) can be attached.");
  }

  const storagePath = `${ticketId}/${randomUUID()}.${ext}`;
  if (supabaseConfigured()) {
    const supabase = createAdminClient();
    await supabase.storage
      .createBucket(EVIDENCE_BUCKET, { public: false, fileSizeLimit: MAX_EVIDENCE_BYTES })
      .catch(() => {});
    const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(storagePath, body, { contentType: mimeType, upsert: false });
    if (error) throw new Error(`evidence upload failed: ${error.message}`);
  } else {
    const full = path.join(LOCAL_DIR, storagePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return { storagePath, mimeType, sizeBytes: body.length, originalName: file.name.slice(0, 120) };
}

/** A short-lived URL (Supabase) or the raw bytes (local dev). */
export async function evidenceSource(
  storagePath: string,
): Promise<{ kind: "url"; url: string } | { kind: "bytes"; body: Buffer } | null> {
  if (supabaseConfigured()) {
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, 600);
    return error || !data ? null : { kind: "url", url: data.signedUrl };
  }
  try {
    return { kind: "bytes", body: await readFile(path.join(LOCAL_DIR, path.normalize(storagePath).replace(/^(\.\.[/\\])+/, ""))) };
  } catch {
    return null;
  }
}

export async function deleteEvidence(storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return;
  if (supabaseConfigured()) {
    await createAdminClient().storage.from(EVIDENCE_BUCKET).remove(storagePaths);
  }
}

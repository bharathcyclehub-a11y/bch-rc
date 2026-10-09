"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, Camera, FileVideo, ImagePlus, X } from "lucide-react";
import { btnOutline } from "./ui";

export type PickedFile = { id: string; file: File; url: string | null; kind: "image" | "video" };

/**
 * Whole-submission cap: nginx (client_max_body_size 20m) and the server-action
 * body limit (20mb) reject anything bigger, so attachments stay under 19 MB.
 */
export const MAX_TOTAL_MB = 19;
export const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;
export const TOTAL_TOO_BIG = `Attachments add up to more than ${MAX_TOTAL_MB} MB — send fewer or smaller files (you can add more in a reply).`;
export const totalBytes = (files: PickedFile[]) => files.reduce((n, f) => n + f.file.size, 0);

const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const fmtMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;

/**
 * Phone photos are often 3–8 MB; evidence is re-encoded to ≤ 2000 px WebP on
 * the server anyway, so large JPEG/PNG/WebP photos are scaled down here first
 * (≤ 1600 px JPEG). That keeps uploads small on mobile data. Anything the
 * browser can't decode (e.g. HEIC outside Safari) is sent as it is.
 */
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 800_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

export default function EvidencePicker({
  files,
  onChange,
  accept,
  maxFiles,
  maxMb,
  rule,
  hint,
  disabled,
  label = "Photos or a short video",
}: {
  files: PickedFile[];
  onChange: (next: PickedFile[]) => void;
  accept: string;
  maxFiles: number;
  maxMb: number;
  rule: "REQUIRED" | "RECOMMENDED" | "NONE";
  hint?: string;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const browseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Revoke every preview URL this picker created when it unmounts.
  const urls = useRef<Set<string>>(new Set());
  useEffect(() => {
    const created = urls.current;
    return () => created.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const allowed = new Set(accept.split(",").map((s) => s.trim()).filter(Boolean));

  async function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    setProblem(null);
    const room = maxFiles - files.length;
    if (room <= 0) {
      setProblem(`You can attach up to ${maxFiles} files.`);
      return;
    }
    setBusy(true);
    const picked: PickedFile[] = [];
    const issues: string[] = [];
    let running = totalBytes(files);
    let overTotal = false;
    for (const raw of Array.from(list)) {
      if (picked.length >= room) {
        issues.push(`Only ${maxFiles} files can be attached — the rest were skipped.`);
        break;
      }
      const ext = raw.name.split(".").pop()?.toLowerCase() ?? "";
      const type = raw.type || EXT_TYPES[ext] || "";
      if (!allowed.has(type)) {
        issues.push(`${raw.name}: only photos (JPG, PNG, WebP, HEIC) or videos (MP4, MOV) can be attached.`);
        continue;
      }
      const file = type.startsWith("image/") ? await shrinkImage(raw) : raw;
      if (file.size > maxMb * 1024 * 1024) {
        issues.push(`${raw.name} is ${fmtMb(file.size)} — each file must be under ${maxMb} MB.`);
        continue;
      }
      if (file.size === 0) {
        issues.push(`${raw.name} is empty.`);
        continue;
      }
      if (running + file.size > MAX_TOTAL_BYTES) {
        overTotal = true;
        continue;
      }
      running += file.size;
      const kind = type.startsWith("video/") ? "video" : "image";
      let url: string | null = null;
      if (kind === "image") {
        url = URL.createObjectURL(file);
        urls.current.add(url);
      }
      picked.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, url, kind });
    }
    setBusy(false);
    if (overTotal) issues.push(TOTAL_TOO_BIG);
    if (issues.length) setProblem(issues.join(" "));
    if (picked.length) onChange([...files, ...picked]);
    if (browseRef.current) browseRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  function remove(target: PickedFile) {
    if (target.url) {
      URL.revokeObjectURL(target.url);
      urls.current.delete(target.url);
    }
    onChange(files.filter((f) => f.id !== target.id));
    setProblem(null);
  }

  const ruleText = rule === "REQUIRED" ? "Required" : rule === "RECOMMENDED" ? "Recommended" : "Optional";

  return (
    <fieldset className="min-w-0" aria-describedby={`${id}-hint`}>
      <legend className="text-sm font-semibold text-brand-ink">
        {label}{" "}
        <span className={rule === "REQUIRED" ? "text-brand-red" : "font-normal text-brand-ink-soft"}>({ruleText})</span>
      </legend>
      <p id={`${id}-hint`} className="mt-1 text-xs text-brand-ink-soft leading-relaxed">
        {hint ? `${hint} ` : ""}Up to {maxFiles} files, {maxMb} MB each and {MAX_TOTAL_MB} MB in total (JPG, PNG, WebP, HEIC, MP4 or MOV). Large photos are resized automatically.
      </p>

      <input
        ref={browseRef}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void add(e.currentTarget.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void add(e.currentTarget.files)}
      />

      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          disabled={disabled || busy || files.length >= maxFiles}
          onClick={() => browseRef.current?.click()}
          className={`${btnOutline} flex-1`}
        >
          <ImagePlus size={18} aria-hidden />
          {busy ? "Preparing…" : "Add photos or video"}
        </button>
        <button
          type="button"
          disabled={disabled || busy || files.length >= maxFiles}
          onClick={() => cameraRef.current?.click()}
          className={`${btnOutline} sm:w-auto`}
        >
          <Camera size={18} aria-hidden />
          Camera
        </button>
      </div>

      {problem && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm font-medium text-brand-red">
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
          {problem}
        </p>
      )}

      {files.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2" aria-label="Attached files">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-xl border border-brand-line bg-white p-2">
              <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-cream">
                {f.url ? (
                  // Local object-URL preview; next/image can't optimise blob: URLs.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FileVideo size={22} aria-hidden className="text-brand-ink-soft" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-brand-ink">{f.file.name}</span>
                <span className="block text-xs text-brand-ink-soft">
                  {fmtMb(f.file.size)} · {f.kind === "video" ? "Video" : "Photo"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(f)}
                disabled={disabled}
                aria-label={`Remove ${f.file.name}`}
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-brand-ink-soft hover:bg-brand-cream hover:text-brand-ink"
              >
                <X size={18} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "@/components/admin/Button";
import { Input } from "@/components/admin/Field";
import { useToast } from "@/components/admin/Toast";
import { MAX_IMAGES } from "@/lib/admin/product-schema";

/**
 * Draft media: upload (Supabase Storage via /api/admin/products/upload) or add
 * by URL/path; reorder with explicit buttons (works on touch and keyboard);
 * the first image is the primary image.
 */
export function MediaEditor({
  images,
  onChange,
  errors,
}: {
  images: string[];
  onChange: (next: string[]) => void;
  errors: Record<string, string>;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const full = images.length >= MAX_IMAGES;

  const move = (i: number, d: -1 | 1) => {
    const next = [...images];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    const added: string[] = [];
    for (const file of Array.from(files).slice(0, MAX_IMAGES - images.length)) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/admin/products/upload", { method: "POST", body: fd });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; reason?: string };
        if (data.ok && data.url) added.push(data.url);
        else toast({ title: `Couldn't upload ${file.name}`, description: data.reason ?? "Try again.", tone: "error" });
      } catch {
        toast({ title: `Couldn't upload ${file.name}`, description: "Check your connection.", tone: "error" });
      }
    }
    if (added.length) onChange([...images, ...added]);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function addUrl() {
    const v = url.trim();
    if (!v) return;
    if (!/^(https:\/\/|\/)/.test(v)) {
      toast({ title: "Use an https:// URL or a /path", tone: "error" });
      return;
    }
    onChange([...images, v]);
    setUrl("");
  }

  return (
    <div className="space-y-3">
      {images.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-admin-line-strong bg-admin-page px-4 py-8 text-center">
          <ImagePlus size={22} aria-hidden className="text-admin-muted" />
          <p className="mt-2 text-[13px] font-medium text-brand-ink">No images yet</p>
          <p className="mt-0.5 text-xs text-admin-muted">JPG, PNG or WebP · the first image is the primary image</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((src, i) => (
            <li
              key={`${src}-${i}`}
              className={cn(
                "relative aspect-square overflow-hidden rounded-lg border bg-admin-subtle",
                errors[`images.${i}`] ? "border-tone-neg" : "border-admin-line",
              )}
            >
              <Image src={src} alt={`Image ${i + 1}`} fill sizes="200px" className="object-contain p-2" unoptimized={/^https?:/.test(src)} />
              {i === 0 && (
                <span className="absolute left-2 top-2 rounded bg-brand-ink px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-white">
                  Primary
                </span>
              )}
              <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1 rounded-lg bg-white/95 p-0.5 ring-1 ring-admin-line">
                <div className="flex">
                  <IconButton size="sm" label="Move left" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowLeft size={14} aria-hidden />
                  </IconButton>
                  <IconButton size="sm" label="Move right" disabled={i === images.length - 1} onClick={() => move(i, 1)}>
                    <ArrowRight size={14} aria-hidden />
                  </IconButton>
                </div>
                <div className="flex">
                  {i > 0 && (
                    <IconButton size="sm" label="Make primary" onClick={() => onChange([src, ...images.filter((_, j) => j !== i)])}>
                      <Star size={14} aria-hidden />
                    </IconButton>
                  )}
                  <IconButton size="sm" label="Remove image" className="text-tone-neg" onClick={() => onChange(images.filter((_, j) => j !== i))}>
                    <Trash2 size={14} aria-hidden />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {Object.entries(errors)
        .filter(([k]) => k.startsWith("images."))
        .slice(0, 1)
        .map(([k, msg]) => (
          <p key={k} className="text-xs text-tone-neg" role="alert">
            Image {Number(k.split(".")[1]) + 1}: {msg}
          </p>
        ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<Upload size={15} aria-hidden />} onClick={() => fileRef.current?.click()} loading={uploading} disabled={full}>
          Upload images
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => upload(e.target.files)}
        />
        <span className="text-xs text-admin-muted">
          {images.length}/{MAX_IMAGES}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addUrl();
            }
          }}
          placeholder="…or paste an image URL or /products/… path"
          aria-label="Image URL"
          disabled={full}
        />
        <Button onClick={addUrl} disabled={full || !url.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

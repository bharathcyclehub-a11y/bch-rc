/**
 * Minimal Gemini image client used by the product-photo pipeline.
 *
 * The key is read from GEMINI_API_KEY in the gitignored .env.local — never
 * hardcoded, never logged, never shipped to the browser.
 *
 *   node --env-file=.env.local scripts/product-images/<runner>.mjs
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const sharp = createRequire(import.meta.url)("sharp");

const KEY = process.env.GEMINI_API_KEY;
const HOST = "https://generativelanguage.googleapis.com/v1beta";

/** Image model resolved from the live model list (see `listImageModels`). */
export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image";
/** Default output size; the cheaper flash image models may only do 1K. */
export const IMAGE_SIZE = process.env.GEMINI_IMAGE_SIZE ?? "2K";

function requireKey() {
  if (!KEY) throw new Error("GEMINI_API_KEY is not set. Add it to .env.local and run node with --env-file=.env.local.");
  return KEY;
}

export async function listImageModels() {
  const res = await fetch(`${HOST}/models?pageSize=200`, { headers: { "x-goog-api-key": requireKey() } });
  if (!res.ok) throw new Error(`models list failed: ${res.status} ${await res.text()}`);
  const { models = [] } = await res.json();
  return models.filter((m) => /image/i.test(m.name)).map((m) => m.name.replace("models/", ""));
}

/** Downscale a raw camera JPEG to something sensible to send as a reference. */
export async function referencePart(file, maxPx = 864) {
  const data = await sharp(file)
    .rotate()
    .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { inline_data: { mime_type: "image/jpeg", data: data.toString("base64") } };
}

export async function filePart(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { inline_data: { mime_type: mime, data: (await readFile(file)).toString("base64") } };
}

/**
 * Generate one image. `refs` are file paths used as visual references.
 * Returns { buffer, mime, text } — `text` is whatever the model said alongside.
 */
export async function generateImage({
  prompt,
  refs = [],
  model = IMAGE_MODEL,
  aspectRatio = "1:1",
  imageSize = IMAGE_SIZE,
  refMaxPx = 864,
}) {
  const parts = [];
  for (const ref of refs) {
    // A ref is a path, or { file, maxPx } when one image (the plate) needs more detail.
    const file = typeof ref === "string" ? ref : ref.file;
    parts.push(await referencePart(file, typeof ref === "string" ? refMaxPx : ref.maxPx ?? refMaxPx));
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio, imageSize },
    },
  };

  const payload = JSON.stringify(body);
  // Flash image models reject imageConfig sizes the Pro model accepts; drop the
  // block and let the model use its native size rather than failing the shot.
  const fallbackPayload = JSON.stringify({
    ...body,
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });
  const attempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await callOnce(model, payload);
    } catch (err) {
      if (/imageConfig|image_config|imageSize|image_size|aspect/i.test(String(err.message)) && err.retryable === false) {
        console.warn("  imageConfig rejected — retrying at the model's native size");
        return await callOnce(model, fallbackPayload);
      }
      // Rate limits, overloads and empty candidates are transient; bad requests are not.
      const retryable = err.retryable !== false;
      if (!retryable || attempt >= attempts) throw err;
      const wait = 15_000 * 2 ** (attempt - 1);
      console.warn(`  gemini attempt ${attempt} failed (${String(err.message).slice(0, 120)}) — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function callOnce(model, payload) {
  const res = await fetch(`${HOST}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": requireKey(), "content-type": "application/json" },
    body: payload,
  });
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`generateContent ${res.status}: ${detail.slice(0, 600)}`);
    // An empty prepaid balance is a 429 too, but waiting won't fix it.
    const billing = /credits are depleted|billing|prepayment/i.test(detail);
    err.retryable = !billing && (res.status === 429 || res.status >= 500);
    throw err;
  }

  const json = await res.json();
  const cand = json.candidates?.[0];
  const out = cand?.content?.parts ?? [];
  const img = out.find((p) => p.inlineData ?? p.inline_data);
  const text = out.filter((p) => p.text).map((p) => p.text).join("\n");
  if (!img) {
    throw new Error(
      `no image returned (finishReason=${cand?.finishReason ?? "?"}, block=${json.promptFeedback?.blockReason ?? "none"}): ${text.slice(0, 300)}`,
    );
  }
  const inline = img.inlineData ?? img.inline_data;
  const u = json.usageMetadata ?? {};
  console.log(
    `  usage: prompt ${u.promptTokenCount ?? "?"} + output ${u.candidatesTokenCount ?? "?"} = ${u.totalTokenCount ?? "?"} tokens (${model})`,
  );
  return { buffer: Buffer.from(inline.data, "base64"), mime: inline.mimeType ?? inline.mime_type, text, usage: u };
}

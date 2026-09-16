/**
 * Exact text measurement for the creative overlays. Renders the string with
 * the real font through librsvg and trims to the ink, so long product names
 * are sized to the pixel instead of by a per-character guess.
 */
import { createRequire } from "node:module";

const sharp = createRequire(import.meta.url)("sharp");
const REF_SIZE = 100;
const cache = new Map();

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rendered ink width of `text` at font-size 100, in px. */
export async function inkWidth(text, font) {
  const key = `${font}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const w = Math.ceil(REF_SIZE * Math.max(text.length, 1) * 1.1) + 40;
  const h = Math.ceil(REF_SIZE * 1.6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="20" y="${REF_SIZE * 1.2}" font-family="${font}" font-size="${REF_SIZE}" fill="#ffffff">${esc(text)}</text></svg>`;
  const { info } = await sharp(Buffer.from(svg)).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  cache.set(key, info.width);
  return info.width;
}

/** Largest font size (≤ maxSize) at which `text` fits inside `maxWidth`. */
export async function fitSize(text, maxWidth, maxSize, font) {
  const w = await inkWidth(text, font);
  return Math.min(maxSize, (maxWidth / w) * REF_SIZE * 0.985);
}

/**
 * Typography + logo overlays for the PRC product creatives.
 *
 * Gemini renders the *photograph* only; every piece of text and the PRC logo is
 * composited here from real assets so spelling and branding are always exact
 * (see the image-text quality rule in the brief).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fitSize } from "./measure.mjs";

const sharp = createRequire(import.meta.url)("sharp");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LOGO_WHITE = path.join(ROOT, "public/logo/prc-logo-white-tight.png");

export const LIME = "#c8ff00";
export const DISPLAY_FONT = "Arial Black";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Bottom-edge darkening so white type always reads. */
function scrimSvg(w, h, from = 0.55, stop = 0.42) {
  return `<defs><linearGradient id="scrim" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity="${from}"/>
    <stop offset="${stop}" stop-color="#000" stop-opacity="0"/>
  </linearGradient></defs>
  <rect x="0" y="0" width="${w}" height="${h}" fill="url(#scrim)"/>`;
}

/**
 * Hero lockup: bottom-scrim + centred product name + full-width lime rule.
 * `sub` is optional and sits under the name in regular weight.
 */
export async function heroOverlaySvg({ size, name, sub = "" }) {
  const pad = Math.round(size * 0.08);
  const rule = Math.max(3, Math.round(size * 0.011));
  const maxW = size - pad * 2;
  const upper = name.toUpperCase();
  const tracking = 0;
  const fs = await fitSize(upper, maxW, size * 0.1, DISPLAY_FONT);
  const subFs = Math.round(size * 0.028);
  const baseline = size - rule - Math.round(size * (sub ? 0.095 : 0.058));

  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  ${scrimSvg(size, size)}
  <text x="${size / 2}" y="${baseline}" text-anchor="middle"
        font-family="${DISPLAY_FONT}" font-size="${fs.toFixed(1)}" letter-spacing="${(fs * tracking).toFixed(2)}"
        fill="#ffffff">${esc(upper)}</text>
  ${
    sub
      ? `<text x="${size / 2}" y="${baseline + subFs * 1.55}" text-anchor="middle"
        font-family="Arial" font-size="${subFs}" fill="#e8e8e8" opacity="0.92">${esc(sub)}</text>`
      : ""
  }
  <rect x="0" y="${size - rule}" width="${size}" height="${rule}" fill="${LIME}"/>
</svg>`);
}

/** Small lime line-art icons for the features band. */
const ICONS = {
  speed: "M56 6 22 56h24l-8 42 36-52H48l8-40z",
  remote: "M22 30h60a14 14 0 0 1 14 14v30a14 14 0 0 1-14 14H22A14 14 0 0 1 8 74V44a14 14 0 0 1 14-14zm10 18v10H22v10h10v10h10V68h10V58H42V48H32zm40 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm12 12a6 6 0 1 0 0 12 6 6 0 0 0 0-12z",
  car: "M14 70h6a12 12 0 0 0 24 0h20a12 12 0 0 0 24 0h6V54l-12-6-14-18H40L24 48l-14 4v14h4zm18 12a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm44 0a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM46 36h16l10 12H36l10-12z",
  wing: "M10 44h84v10H10zM24 54h12v20H24zM68 54h12v20H68zM10 34h84v8H10z",
  battery: "M18 34h56a8 8 0 0 1 8 8v6h8v14h-8v6a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V42a8 8 0 0 1 8-8zm6 12v20h14V46H24z",
  shield: "M52 8 14 22v28c0 24 16 38 38 46 22-8 38-22 38-46V22L52 8zm0 16 24 9v17c0 15-10 25-24 31-14-6-24-16-24-31V33l24-9z",
  display: "M16 24h72a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8V32a8 8 0 0 1 8-8zm4 12v32h64V36H20zm8 8h10v16H28V44zm16 0h10v16H44V44z",
  spring: "M40 8h24v10H40zM40 86h24v10H40zM30 22h44l-44 12h44L30 46h44L30 58h44L30 70h44l-44 12h44v-4H36l38-10V64L36 54l38-10V40L36 30l38-10v-2H30z",
  disc: "M52 10a42 42 0 1 1 0 84 42 42 0 0 1 0-84zm0 12a30 30 0 1 0 0 60 30 30 0 0 0 0-60zm0 18a12 12 0 1 1 0 24 12 12 0 0 1 0-24zM30 48a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm44 0a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM48 26a4 4 0 1 1 8 0 4 4 0 0 1-8 0zm0 52a4 4 0 1 1 8 0 4 4 0 0 1-8 0z",
};

/**
 * Top information band used on the FEATURES creative: up to three
 * verified benefits, lime icon + white title + grey caption, on black.
 */
export async function featuresOverlaySvg({ size, items }) {
  const h = Math.round(size * 0.138);
  const pad = Math.round(size * 0.022);
  const gutter = Math.round(size * 0.018); // breathing room either side of a divider
  const colW = (size - pad * 2) / items.length;
  const rule = Math.max(2, Math.round(size * 0.004));
  const iconBox = Math.round(h * 0.4);
  const iconGap = Math.round(size * 0.014);

  // Every column gets the same type size — the tightest one that fits them all.
  const textW = colW - iconBox - iconGap - gutter;
  const titleFs = Math.min(
    ...(await Promise.all(items.map((it) => fitSize(it.title.toUpperCase(), textW, size * 0.0215, DISPLAY_FONT)))),
  );
  const capFs = Math.min(
    ...(await Promise.all(items.map((it) => fitSize(it.caption, textW, size * 0.0155, "Arial")))),
  );

  const cols = items
    .map((it, i) => {
      const x = pad + i * colW;
      const ix = x + (i ? gutter / 2 : 0);
      const iy = Math.round((h - iconBox) / 2);
      const tx = ix + iconBox + iconGap;
      const s = (iconBox / 104).toFixed(4);
      return `<g transform="translate(${ix} ${iy}) scale(${s})">
        <path d="${ICONS[it.icon] ?? ICONS.car}" fill="${LIME}"/></g>
      <text x="${tx}" y="${h / 2 - titleFs * 0.15}" font-family="${DISPLAY_FONT}" font-size="${titleFs.toFixed(1)}" fill="#ffffff">${esc(it.title.toUpperCase())}</text>
      <text x="${tx}" y="${h / 2 + capFs * 1.55}" font-family="Arial" font-size="${capFs.toFixed(1)}" fill="#b9bfc4">${esc(it.caption)}</text>
      ${i ? `<rect x="${(x - gutter / 2).toFixed(1)}" y="${h * 0.24}" width="${Math.max(1, Math.round(size * 0.0016))}" height="${h * 0.52}" fill="${LIME}" opacity="0.55"/>` : ""}`;
    })
    .join("\n");

  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${size}" height="${h}" fill="#000000"/>
  ${cols}
  <rect x="0" y="${h}" width="${size}" height="${rule}" fill="${LIME}"/>
</svg>`);
}

/** Labels + lime divider for the two-up FRONT / REAR angles creative. */
export function anglesOverlaySvg({ size, top = "FRONT VIEW", bottom = "REAR VIEW" }) {
  const half = size / 2;
  const rule = Math.max(4, Math.round(size * 0.009));
  const pad = Math.round(size * 0.042);
  const big = Math.round(size * 0.052);
  const small = Math.round(size * 0.026);
  const label = (text, y) => {
    const [first, ...rest] = text.split(" ");
    return `<text x="${pad}" y="${y}" font-family="${DISPLAY_FONT}" font-size="${big}" fill="${LIME}">${esc(first)}</text>
    <text x="${pad}" y="${y + small * 1.55}" font-family="${DISPLAY_FONT}" font-size="${small}" fill="#ffffff">${esc(rest.join(" "))}</text>`;
  };
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
  </linearGradient></defs>
  <rect x="0" y="0" width="${size}" height="${half * 0.42}" fill="url(#t)"/>
  <rect x="0" y="${half}" width="${size}" height="${half * 0.42}" fill="url(#t)"/>
  ${label(top, pad + big * 0.8)}
  ${label(bottom, half + pad + big * 0.8)}
  <rect x="0" y="${half - rule / 2}" width="${size}" height="${rule}" fill="${LIME}"/>
</svg>`);
}

/** Headline block for the LIFESTYLE creative: lime heading top, name bottom. */
export async function lifestyleOverlaySvg({ size, headline, headlineSub = "", name, nameSub = "" }) {
  const pad = Math.round(size * 0.06);
  const maxW = size - pad * 2;
  const hFs = await fitSize(headline.toUpperCase(), maxW, size * 0.095, DISPLAY_FONT);
  const nFs = await fitSize(name.toUpperCase(), maxW, size * 0.082, DISPLAY_FONT);
  const subFs = Math.round(size * 0.0255);
  const nameBase = size - pad - (nameSub ? subFs * 1.5 : 0);
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="bot" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0.62"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size * 0.3}" fill="url(#top)"/>
  <rect x="0" y="${size * 0.64}" width="${size}" height="${size * 0.36}" fill="url(#bot)"/>
  <text x="${pad}" y="${pad + hFs * 0.82}" font-family="${DISPLAY_FONT}" font-size="${hFs.toFixed(1)}" fill="${LIME}">${esc(headline.toUpperCase())}</text>
  ${headlineSub ? `<text x="${pad}" y="${pad + hFs * 0.82 + subFs * 1.5}" font-family="Arial" font-size="${subFs}" fill="#ffffff">${esc(headlineSub)}</text>` : ""}
  <text x="${pad}" y="${nameBase}" font-family="${DISPLAY_FONT}" font-size="${nFs.toFixed(1)}" fill="${LIME}">${esc(name.toUpperCase())}</text>
  ${nameSub ? `<text x="${pad}" y="${nameBase + subFs * 1.45}" font-family="Arial" font-size="${subFs}" fill="#ffffff">${esc(nameSub)}</text>` : ""}
</svg>`);
}

/** Compose the white PRC logo into the top-right corner. */
export async function logoLayer(size, { widthPct = 0.185, pad = 0.05 } = {}) {
  const w = Math.round(size * widthPct);
  const logo = await sharp(LOGO_WHITE).resize({ width: w }).png().toBuffer();
  const { width, height } = await sharp(logo).metadata();

  // Soft dark halo from the logo's own alpha, so white type reads on bright skies.
  const bleed = Math.round(w * 0.12);
  const mask = await sharp(logo).extractChannel(3).linear(0.85, 0).png().toBuffer();
  const shadow = await sharp({ create: { width, height, channels: 3, background: "#000000" } })
    .joinChannel(mask)
    .png()
    .toBuffer();
  const halo = await sharp(shadow)
    .extend({ top: bleed, bottom: bleed, left: bleed, right: bleed, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(Math.max(2, w * 0.03))
    .png()
    .toBuffer();
  const input = await sharp(halo).composite([{ input: logo, left: bleed, top: bleed }]).png().toBuffer();

  const margin = Math.round(size * pad);
  return { input, left: size - w - margin - bleed, top: margin - bleed };
}

/**
 * Take a generated photograph and produce the final square creative.
 * Returns the composed sharp pipeline (caller decides the output format).
 */
export async function composeHero({ image, size, name, sub }) {
  const base = await sharp(image).resize(size, size, { fit: "cover", position: "centre" }).toBuffer();
  const logo = await logoLayer(size);
  return sharp(base).composite([{ input: await heroOverlaySvg({ size, name, sub }) }, logo]);
}

export { sharp };

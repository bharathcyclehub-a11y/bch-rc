/**
 * Build the four PRC product creatives for one product.
 *
 *   node --env-file=.env.local scripts/product-images/make.mjs <spec.json> [shot] [--tag v1] [--recompose]
 *
 * shot: hero | features | angles | lifestyle | variants | all   (default: all)
 *
 * Gemini renders photographs only. Every piece of text and the PRC logo is
 * composited afterwards from real assets, so spelling is always exact.
 * --recompose re-lays text over photographs already generated for the tag.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateImage, IMAGE_MODEL } from "./gemini.mjs";
import {
  composeHero,
  featuresOverlaySvg,
  anglesOverlaySvg,
  lifestyleOverlaySvg,
  sharp,
} from "./compose.mjs";

const args = process.argv.slice(2);
const specPath = args[0];
if (!specPath) throw new Error("usage: make.mjs <spec.json> [hero|features|angles|lifestyle|variants|all] [--tag v1] [--recompose]");
const shot = args[1] && !args[1].startsWith("--") ? args[1] : "all";
const tag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : "v1";
const recompose = args.includes("--recompose");

const spec = JSON.parse(await readFile(specPath, "utf8"));
const size = spec.size ?? 1254;
const outDir = path.resolve(spec.outDir ?? path.join(path.dirname(specPath), "out"));
await mkdir(outDir, { recursive: true });

const rel = (r) => path.resolve(path.dirname(specPath), r);

const DEFAULT_REMOTE =
  "the remote control that is supplied with it, exactly as it appears in the reference photographs";
const DEFAULT_REMOTE_LAYOUT =
  "the vehicle fills only the LEFT two-thirds of the frame and the remote stands upright on its base in the RIGHT third, closer to the camera and smaller, with a clear gap of empty floor at least one wheel wide between the remote and the nearest part of the vehicle";

/** Shared fidelity contract — the product must survive every edit untouched. */
function preamble(hasPlate, description) {
  const store = spec.storeKind ?? "remote-control TOY VEHICLES";
  const head = hasPlate
    ? `You are retouching a product photograph for an Indian e-commerce store that sells ${store}.

THE FIRST IMAGE IS THE PRODUCT PLATE. The remaining images are extra views of the same physical item.

Your job is a BACKGROUND REPLACEMENT AND RELIGHT, nothing more. Cut the product out of the first image and place it into a new environment. The product itself must survive the edit completely untouched: identical silhouette, identical proportions, identical colours, identical decals, stripes, numbers and printed graphics (same colour, same size, same position), identical wheels and tyres, identical lights, grille, bumpers, racks, cages, spare wheels and accessories, identical panel lines, identical ride height. Anything attached to it in the plate stays; anything absent from the plate stays absent.

If your instinct is to "improve" or "correct" a detail because it does not look like the real full-size vehicle this toy imitates — DO NOT. The toy is the truth. Copy it.

Remove from the plate ONLY the original background, the surface it stood on, any hand, stand, box or clutter, and the remote control (unless this shot explicitly asks to show the remote).`
    : `You are a commercial product photographer shooting for an Indian e-commerce store that sells ${store}. The attached photographs are the ACTUAL PHYSICAL PRODUCT and are your only source of truth.`;

  return `${head}

THE PRODUCT:
${description}

${spec.scaleNote ?? "- It must read as a scale MODEL, not a real vehicle: keep its moulded-plastic body, its toy wheels and tyres and its model-scale detailing exactly as photographed."}
- No people, no hands, no other vehicles, and no brand logos anywhere in the scene.
${spec.notes ? `\nPAY SPECIAL ATTENTION:\n${spec.notes}\n` : ""}`;
}

const NO_TEXT =
  "CRITICAL: render NO text, NO lettering, NO numbers, NO watermark, NO logo, NO caption and NO graphic overlay anywhere in the scene. Printed decals that physically exist on the product itself stay exactly as they are. Output a clean photograph.";

async function gen({ key, prompt, aspectRatio = "1:1", description = spec.productDescription }) {
  const rawFile = path.join(outDir, `${spec.slug}-${key}-${tag}-raw.png`);
  if (recompose) {
    console.log(`  reusing ${path.basename(rawFile)}`);
    return readFile(rawFile);
  }
  const plateFile = spec.plates?.[key] ? rel(spec.plates[key]) : null;
  const list = (spec.refsByShot?.[key] ?? spec.refs ?? []).map(rel);
  const refs = [...(plateFile ? [{ file: plateFile, maxPx: 1536 }] : []), ...list].slice(0, 5);
  const check = spec.finalCheck
    ? `\nFINAL CHECK BEFORE YOU OUTPUT — look at your own image and fix any of these that is wrong:\n${spec.finalCheck}\n`
    : "";
  const { buffer } = await generateImage({
    prompt: `${preamble(Boolean(plateFile), description)}\n${prompt}\n${check}\n${NO_TEXT}`,
    refs,
    aspectRatio,
  });
  await writeFile(rawFile, buffer);
  return buffer;
}

async function save(pipeline, name) {
  const file = path.join(outDir, `${spec.slug}-${name}-${tag}`);
  const buf = await pipeline.png().toBuffer();
  await writeFile(`${file}.png`, buf);
  await sharp(buf).webp({ quality: 88, effort: 6 }).toFile(`${file}.webp`);
  console.log(`  ${path.basename(file)}.webp`);
}

const heroPrompt = (scene) => `THE SHOT — premium e-commerce hero:
- Square 1:1. The product is the unmistakable subject, at a low three-quarter hero angle near model eye-level. Keep the pose it has in the plate; you may lower the camera a little and re-scale it in the square.
- The ENTIRE model is inside the frame with breathing room left and right — nothing cropped by any edge.
- Environment: ${scene}
- Cinematic advertising light: strong key raking across the body, rim light separating it from the background, believable contact shadow and ground interaction.
- Background atmospheric and clearly out of focus; the model itself razor sharp.
- Keep the bottom 22% of the frame calm and darker (ground, shadow or bokeh only) and the top-right corner free of busy detail — type and the logo go there afterwards.`;

// ---------------------------------------------------------------- shot 1: hero
async function hero() {
  const buffer = await gen({ key: "hero", prompt: heroPrompt(spec.scenes.hero) });
  await save(await composeHero({ image: buffer, size, name: spec.heroText ?? spec.name }), "01-hero");
}

// ------------------------------------------- colour variants (selector images)
async function variants() {
  for (const v of spec.variants ?? []) {
    const key = `variant-${v.slug}`;
    spec.plates = { ...spec.plates, [key]: v.plate };
    spec.refsByShot = { ...spec.refsByShot, [key]: v.refs ?? [] };
    const buffer = await gen({ key, prompt: heroPrompt(v.scene ?? spec.scenes.hero), description: v.productDescription });
    await save(await composeHero({ image: buffer, size, name: spec.heroText ?? spec.name }), `01-hero-${v.slug}`);
  }
}

// ------------------------------------------------------------ shot 2: features
async function features() {
  const buffer = await gen({
    key: "features",
    prompt: spec.shotOverrides?.features ?? `THE SHOT — "what you get" package photograph:
- Square 1:1. Show the vehicle TOGETHER WITH ${spec.remote ?? DEFAULT_REMOTE}. ${spec.packageExtra ?? ""}
- Arrange them as a SET WITH CLEAR SPACE BETWEEN THEM: ${spec.featuresLayout ?? `the vehicle sits behind and to the left, angled three-quarter towards the camera and dominant; ${spec.remoteLayout ?? DEFAULT_REMOTE_LAYOUT}`}. They must NOT touch, overlap or merge — leave plain floor visible between them. Both sharp and clearly readable.
- Reproduce the remote exactly as photographed — same shape, same colours, same controls. Do not restyle it or add screens, lights or logos.
- Nothing else in the picture: no charger, no cable, no batteries, no box, no tools.
- Environment: ${spec.scenes.features}
- Studio-grade advertising light with clean speculars and a soft reflection beneath both items.
- Keep the TOP 18% of the frame dark and empty — a black information band is laid over it afterwards. Nothing important may sit there.`,
  });
  const base = sharp(await sharp(buffer).resize(size, size, { fit: "cover" }).toBuffer()).composite([
    { input: await featuresOverlaySvg({ size, items: spec.features }) },
  ]);
  await save(base, "02-features");
}

// -------------------------------------------------------------- shot 3: angles
const DEFAULT_ANGLES = [
  {
    key: "front",
    label: "FRONT VIEW",
    view: "FRONT three-quarter view, slightly above bumper height, so the face of the vehicle — grille, lights and bumper — and the full width of the body read clearly",
  },
  {
    key: "rear",
    label: "REAR VIEW",
    view: "REAR three-quarter view, slightly above bumper height, so the tail lights, the rear bodywork and anything mounted at the back read clearly",
  },
];

async function angles() {
  const views = spec.angles ?? DEFAULT_ANGLES;
  const halves = [];
  for (const { key, view } of views) {
    const buffer = await gen({
      key,
      aspectRatio: "16:9",
      prompt: `THE SHOT — catalogue angle photograph:
- A ${view}. Keep the angle the product has in the plate.
- The whole vehicle sits inside the frame, centred, with clear margin at both sides and above it.
- Environment: ${spec.scenes.angles}
- Even, controlled studio lighting: a broad soft key, gentle rim light, a crisp contact shadow and a subtle reflection in the floor.
- The purpose is for a customer to understand the physical product, so every detail must be legible. Background simple and unobtrusive.`,
    });
    halves.push(await sharp(buffer).resize(size, Math.round(size / 2), { fit: "cover", position: "centre" }).toBuffer());
  }
  const base = sharp({ create: { width: size, height: size, channels: 3, background: "#0b0b0c" } }).composite([
    { input: halves[0], top: 0, left: 0 },
    { input: halves[1], top: Math.round(size / 2), left: 0 },
    { input: anglesOverlaySvg({ size, top: views[0].label, bottom: views[1].label }) },
  ]);
  await save(base, "03-angles");
}

// ----------------------------------------------------------- shot 4: lifestyle
async function lifestyle() {
  const buffer = await gen({
    key: "lifestyle",
    prompt: spec.shotOverrides?.lifestyle ?? `THE SHOT — cinematic lifestyle / action photograph:
- Square 1:1. The model in its element: ${spec.scenes.lifestyle}
- Dynamic, slightly low camera. Convey motion honestly — motion blur in the background and on the ground, the model itself sharp.
- Rich cinematic grade, dramatic natural light, real atmosphere appropriate to the surface.
- The whole model stays inside the frame.
- Keep the top-left area and the bottom 26% of the frame calm enough for headline type to be laid over them afterwards.`,
  });
  const base = sharp(await sharp(buffer).resize(size, size, { fit: "cover" }).toBuffer()).composite([
    { input: await lifestyleOverlaySvg({ size, ...spec.lifestyleText, name: spec.lifestyleText?.name ?? spec.name }) },
  ]);
  await save(base, "04-lifestyle");
}

const shots = { hero, features, angles, lifestyle, variants };
console.log(`${spec.name} · ${IMAGE_MODEL} · ${shot}${recompose ? " · recompose" : ""}`);
for (const [name, fn] of Object.entries(shots)) {
  if (shot === "all" || shot === name) await fn();
}

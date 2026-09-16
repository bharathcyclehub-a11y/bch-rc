/**
 * Category-thumbnail generator: puts a product on the same white background +
 * soft embossed grey ring used by the existing hub category tiles.
 *
 *   node --env-file=.env.local scripts/product-images/category-thumb.mjs <productPlate> <styleRef> <out.png>
 *
 * Image 1 is the product plate (must survive untouched); image 2 is an existing
 * category tile used ONLY for background, ring, framing and lighting.
 */
import { writeFile } from "node:fs/promises";
import { generateImage } from "./gemini.mjs";

const [plate, styleRef, out] = process.argv.slice(2);
if (!plate || !styleRef || !out) throw new Error("usage: category-thumb.mjs <productPlate> <styleRef> <out.png>");

const prompt = `Create a square e-commerce CATEGORY THUMBNAIL.

IMAGE 1 is the PRODUCT: a remote-control scale model vehicle. It must appear exactly as photographed — identical body shape, proportions, colours, decals, graphics, wheels, tyres, lights, racks, wings and accessories. Do not restyle, simplify, recolour or "correct" anything. It stays a scale model, not a real vehicle.

IMAGE 2 is the STYLE REFERENCE ONLY. Copy its presentation exactly and ignore its product:
- a clean pure white background,
- ONE THIN, SUBTLE circular ring centred in the frame, exactly like the reference: very light grey, a faint soft emboss, a band only about 3% of the frame wide, diameter about 85% of the frame. NOT a thick grey donut, NOT a heavy frame.
- the product LARGE and dead centre over the ring at a front three-quarter angle, filling 88-92% of the frame width (a tall vehicle may be limited by height instead), overlapping the ring on both sides the way the reference product does. Tall, boxy vehicles such as off-road trucks must STILL span about 90% of the frame width — do not shrink them to keep the roof inside the ring,
- bright, even studio lighting with a soft contact shadow directly under the wheels.

Remove everything else from image 1: its floor, walls, reflections and background.

CRITICAL: no text, no numbers added, no logo, no watermark, no border, no scenery. Only the white background, the grey ring, the product and its soft shadow.`;

const { buffer } = await generateImage({
  prompt,
  refs: [{ file: plate, maxPx: 1536 }, styleRef],
  aspectRatio: "1:1",
  imageSize: "1K",
});
await writeFile(out, buffer);
console.log(`written ${out}`);


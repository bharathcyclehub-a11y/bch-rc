/**
 * Run make.mjs over a folder of product specs with bounded concurrency.
 *
 *   node --env-file=.env.local scripts/product-images/batch.mjs <specDir> [--shot all] [--tag v1] [--concurrency 3] [--only a,b]
 *
 * Each product logs to <outDir>/<slug>.log; a summary prints at the end.
 */
import { readdir, readFile, mkdir, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);

const specDir = path.resolve(args[0] ?? "");
const shot = opt("shot", "all");
const tag = opt("tag", "v1");
const concurrency = Number(opt("concurrency", "3"));
const only = opt("only", "")?.split(",").filter(Boolean);

const files = (await readdir(specDir)).filter((f) => f.endsWith(".json")).sort();
const queue = [];
for (const f of files) {
  const spec = JSON.parse(await readFile(path.join(specDir, f), "utf8"));
  if (only.length && !only.includes(spec.slug)) continue;
  queue.push({ file: path.join(specDir, f), spec });
}

console.log(`${queue.length} products · shot=${shot} · tag=${tag} · concurrency=${concurrency}`);
const results = [];

async function runOne({ file, spec }) {
  const outDir = path.resolve(spec.outDir ?? path.join(specDir, "out"));
  await mkdir(outDir, { recursive: true });
  const log = await open(path.join(outDir, `${spec.slug}.log`), "a");
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, path.join(here, "make.mjs"), file, shot, "--tag", tag],
      { stdio: ["ignore", log.fd, log.fd], env: process.env },
    );
    child.on("exit", resolve);
  });
  await log.close();
  const secs = Math.round((Date.now() - started) / 1000);
  results.push({ slug: spec.slug, ok: code === 0, secs });
  console.log(`${code === 0 ? "done" : "FAILED"}  ${spec.slug}  (${secs}s)`);
}

const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
  while (queue.length) await runOne(queue.shift());
});
await Promise.all(workers);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} succeeded${failed.length ? ` — failed: ${failed.map((r) => r.slug).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);

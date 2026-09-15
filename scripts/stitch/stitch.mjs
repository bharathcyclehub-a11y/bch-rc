#!/usr/bin/env node
/**
 * Google Stitch MCP client — zero-dependency CLI used for the admin design
 * workflow (generate → inspect → refine → pull). Talks JSON-RPC to the Stitch
 * MCP endpoint over node:https (no fetch: undici's 300 s header timeout is
 * shorter than a screen generation can take).
 *
 * The key is read from STITCH_API_KEY in the gitignored .env.local — never
 * hardcode it, never prefix it with NEXT_PUBLIC_, never import this from app code.
 *
 *   node --env-file=.env.local scripts/stitch/stitch.mjs tools
 *   node --env-file=.env.local scripts/stitch/stitch.mjs call <tool> '<json-args>'
 *   node --env-file=.env.local scripts/stitch/stitch.mjs call <tool> @args.json
 *   node --env-file=.env.local scripts/stitch/stitch.mjs pull <projectId> <screenId> <outDir> <name>
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const KEY = process.env.STITCH_API_KEY;
const ENDPOINT = new URL(process.env.STITCH_HOST ?? "https://stitch.googleapis.com/mcp");

if (!KEY) {
  console.error("STITCH_API_KEY is not set. Add it to .env.local and run with --env-file=.env.local.");
  process.exit(1);
}

function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.setTimeout(15 * 60 * 1000, () => req.destroy(new Error("Stitch request timed out after 15 min")));
    req.on("error", reject);
    req.end(body);
  });
}

let rpcId = 0;
async function rpc(method, params) {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params });
  const res = await request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-goog-api-key": KEY,
      "content-length": Buffer.byteLength(payload),
    },
    body: payload,
  });
  const text = res.body.toString("utf8");
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 600)}`);
  // Streamable-HTTP servers may answer as SSE; the last data: line is the reply.
  const json = String(res.headers["content-type"] ?? "").includes("text/event-stream")
    ? JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5))
    : JSON.parse(text);
  if (json.error) throw new Error(`RPC ${json.error.code}: ${json.error.message}`);
  return json.result;
}

export async function callTool(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
  if (result.isError) throw new Error(text || `Stitch tool ${name} failed`);
  if (result.structuredContent) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Every { downloadUrl } nested anywhere in a get_screen payload, keyed by its parent field. */
function findDownloads(node, trail = [], out = []) {
  if (!node || typeof node !== "object") return out;
  if (typeof node.downloadUrl === "string") out.push({ field: trail.join("."), url: node.downloadUrl, mime: node.mimeType });
  for (const [k, v] of Object.entries(node)) findDownloads(v, [...trail, k], out);
  return out;
}

async function download(url, file) {
  let res = await request(url);
  if (res.status === 401 || res.status === 403) res = await request(url, { headers: { "x-goog-api-key": KEY } });
  if (res.status >= 300 && res.status < 400 && res.headers.location) res = await request(res.headers.location);
  if (res.status !== 200) throw new Error(`Download ${res.status} for ${file}`);
  fs.writeFileSync(file, res.body);
  return res.body.length;
}

export async function pull(projectId, screenId, outDir, name) {
  const screen = await callTool("get_screen", { name: `projects/${projectId}/screens/${screenId}` });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(screen, null, 2));
  for (const d of findDownloads(screen)) {
    const isHtml = /html|code/i.test(d.field) || d.mime === "text/html";
    // Screenshots are FIFE URLs; request a crisp render instead of the default thumbnail.
    const url = isHtml || d.url.includes("=") ? d.url : `${d.url}=w1600`;
    const file = path.join(outDir, `${name}${isHtml ? ".html" : ".png"}`);
    const bytes = await download(url, file);
    console.log(`pulled ${d.field} → ${file} (${bytes} bytes)`);
  }
}

async function main([cmd, ...rest]) {
  if (cmd === "tools") {
    const { tools } = await rpc("tools/list", {});
    for (const t of tools) console.log(t.name);
  } else if (cmd === "call") {
    const [tool, raw = "{}"] = rest;
    const args = raw.startsWith("@") ? JSON.parse(fs.readFileSync(raw.slice(1), "utf8")) : JSON.parse(raw);
    console.log(JSON.stringify(await callTool(tool, args), null, 2));
  } else if (cmd === "pull") {
    const [projectId, screenId, outDir, name] = rest;
    await pull(projectId, screenId, outDir, name ?? screenId);
  } else {
    console.error("Usage: stitch.mjs tools | call <tool> '<json>'|@file | pull <projectId> <screenId> <outDir> <name>");
    process.exit(2);
  }
}

// Run as a CLI only when executed directly, so runners can import callTool/pull.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

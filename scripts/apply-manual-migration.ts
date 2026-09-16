/**
 * Apply a manual SQL migration over the POOLED Supabase connection (the direct
 * host is unreachable from this machine). Idempotent by construction — the SQL
 * files in src/db/migrations/manual/ use CREATE TABLE IF NOT EXISTS etc.
 *
 *   npx tsx --env-file=.env.local scripts/apply-manual-migration.ts src/db/migrations/manual/<file>.sql
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const file = process.argv[2];
if (!file) {
  console.error("usage: apply-manual-migration.ts <path-to.sql>");
  process.exit(1);
}

/** Strip comments, split on `;` at statement level. Good enough for plain DDL. */
function statements(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function tableInfo(name: string) {
  const rows = (await db.execute(sql`
    SELECT c.relname,
           c.relrowsecurity AS rls_enabled,
           (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies,
           (SELECT count(*)::int FROM information_schema.columns col
              WHERE col.table_name = c.relname AND col.table_schema = 'public') AS columns
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${name}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

async function main() {
  const sqlText = readFileSync(file, "utf8");
  // These migrations contain plain DDL. Verify the objects in THIS file,
  // rather than the unrelated product_overrides table from the original script.
  const tables = [...sqlText.matchAll(/CREATE TABLE IF NOT EXISTS (?:public\.)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]);
  const indexes = [...sqlText.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]);
  if (tables.length === 0 && indexes.length === 0) {
    throw new Error("No supported CREATE TABLE/INDEX targets found to verify.");
  }
  const stmts = statements(sqlText);
  console.log(`\nApplying ${stmts.length} statement(s) from ${file}\n`);

  for (const s of stmts) {
    const head = s.replace(/\s+/g, " ").slice(0, 72);
    try {
      await db.execute(sql.raw(s));
      console.log(`  ok    ${head}...`);
    } catch (e) {
      console.log(`  FAIL  ${head}...`);
      console.log(`        ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }

  for (const table of tables) {
    const after = await tableInfo(table);
    if (!after) throw new Error(`VERIFY FAILED: ${table} is absent`);
    // Enforce RLS only when this migration explicitly enables it.
    const enablesRls = new RegExp(`ALTER TABLE (?:public\\.)?${table} ENABLE ROW LEVEL SECURITY`, "i").test(sqlText);
    if (enablesRls && after.rls_enabled !== true) throw new Error(`VERIFY FAILED: ${table} RLS is not enabled`);
    console.log(`  verified table ${table}${enablesRls ? " (RLS enabled)" : ""}`);
  }
  for (const index of indexes) {
    const [row] = await db.execute(sql`
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${index}
    `);
    if (!row) throw new Error(`VERIFY FAILED: ${index} is absent`);
    console.log(`  verified index ${index}`);
  }
  console.log("\nVERIFIED: all migration targets exist.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("THROW:", e);
  process.exit(1);
});

// Startup probe — verifies that every database table the app reads or
// writes actually exists before the server accepts traffic. Fails loud
// with a clear message instead of letting routes 500 at request time.
//
// To add a new required table, append it to REQUIRED_TABLES. The probe
// runs once at boot from server/index.ts.

import { sql } from "drizzle-orm";
import { db } from "./db";

interface RequiredTable {
  schema: string;
  table: string;
  // The migration file (or `drizzle-kit push` instruction) that creates
  // this table. Surfaced in the error so the operator knows exactly what
  // to run.
  migrationHint: string;
}

const REQUIRED_TABLES: RequiredTable[] = [
  { schema: "inventor_geyser", table: "users", migrationHint: "npx drizzle-kit push (schema: shared/schema.ts)" },
  { schema: "inventor_geyser", table: "inventors_users", migrationHint: "npx drizzle-kit push" },
  { schema: "inventor_geyser", table: "projects", migrationHint: "npx drizzle-kit push" },
  { schema: "inventor_geyser", table: "agent_data", migrationHint: "npx drizzle-kit push" },
  { schema: "inventor_geyser", table: "idea_snapshots", migrationHint: "npx drizzle-kit push" },
  { schema: "inventor_geyser", table: "prior_art_searches", migrationHint: "npx drizzle-kit push" },
  { schema: "inventor_geyser", table: "pannu_records", migrationHint: "npx drizzle-kit push" },
  { schema: "inventor_geyser", table: "human_inputs", migrationHint: "psql $DATABASE_URL -f migrations/0001_human_inputs.sql  (or: npx drizzle-kit push)" },
  { schema: "inventor_geyser", table: "project_families", migrationHint: "psql $DATABASE_URL -f migrations/0004_project_families.sql" },
  { schema: "inventor_geyser", table: "project_family_artifacts", migrationHint: "psql $DATABASE_URL -f migrations/0004_project_families.sql" },
  { schema: "inventor_geyser", table: "project_family_context_files", migrationHint: "psql $DATABASE_URL -f migrations/0005_family_context_files.sql" },
];

export async function probeSchema(): Promise<void> {
  const missing: RequiredTable[] = [];
  for (const t of REQUIRED_TABLES) {
    const res = await db.execute(sql`
      SELECT to_regclass(${`${t.schema}.${t.table}`}) AS exists
    `);
    const exists = (res as any).rows?.[0]?.exists;
    if (!exists) missing.push(t);
  }

  if (missing.length === 0) return;

  const lines = missing.map((m) => `  - ${m.schema}.${m.table}    → run: ${m.migrationHint}`);
  const message =
    `Database schema is missing required tables:\n${lines.join("\n")}\n\n` +
    `The server will not start until these are created. Apply the migration(s) above and restart.`;
  console.error("\n" + "=".repeat(72));
  console.error("[schema-probe] STARTUP FAILED");
  console.error("=".repeat(72));
  console.error(message);
  console.error("=".repeat(72) + "\n");
  throw new Error(`Schema probe failed: ${missing.length} required table(s) missing`);
}

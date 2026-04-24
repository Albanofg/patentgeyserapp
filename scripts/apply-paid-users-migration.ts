// One-off migration for Phase 1 paid-projects: adds paid_users table,
// adds projects.paid_user_id, and drops NOT NULL on projects.user_id.
// Safe to re-run; every statement is IF [NOT] EXISTS guarded.
import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const SQL = `
CREATE TABLE IF NOT EXISTS paid_users (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password text NOT NULL,
  two_factor_enabled boolean DEFAULT false,
  two_factor_method text,
  totp_secret text,
  pending_two_factor_code text,
  pending_two_factor_expiry timestamp,
  two_factor_verified_at timestamp,
  last_login_at timestamp,
  project_limit integer NOT NULL DEFAULT 1,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS paid_user_id varchar REFERENCES paid_users(id) ON DELETE CASCADE;

ALTER TABLE projects ALTER COLUMN user_id DROP NOT NULL;
`;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      await client.query(SQL);
      console.log("Migration applied.");
      const { rows: r1 } = await client.query(
        "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='projects' AND column_name IN ('user_id','paid_user_id') ORDER BY column_name"
      );
      console.log("projects owner cols:", r1);
      const { rows: r2 } = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name='paid_users' ORDER BY ordinal_position"
      );
      console.log("paid_users cols:", r2.map((r) => r.column_name).join(", "));
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

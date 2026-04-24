import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const SQL = `
ALTER TABLE prior_art_searches
  ADD COLUMN IF NOT EXISTS paid_user_id varchar REFERENCES paid_users(id) ON DELETE CASCADE;

ALTER TABLE prior_art_searches ALTER COLUMN user_id DROP NOT NULL;
`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(SQL);
const r = await pool.query(
  "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='prior_art_searches' AND column_name IN ('user_id','paid_user_id')"
);
console.log(r.rows);
await pool.end();

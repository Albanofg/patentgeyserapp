import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query("ALTER TABLE paid_users ALTER COLUMN project_limit SET DEFAULT 0");
const r = await pool.query(
  "SELECT column_default FROM information_schema.columns WHERE table_name='paid_users' AND column_name='project_limit'"
);
console.log(r.rows);
await pool.end();

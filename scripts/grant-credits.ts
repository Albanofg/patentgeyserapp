import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const email = process.argv[2];
const delta = Number(process.argv[3]);
if (!email || !Number.isInteger(delta)) {
  console.error("Usage: tsx scripts/grant-credits.ts <email> <delta>  (delta can be negative)");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query(
  `UPDATE paid_users
   SET project_limit = GREATEST(0, project_limit + $2), updated_at = now()
   WHERE lower(email) = lower($1)
   RETURNING email, project_limit`,
  [email, delta]
);
if (r.rows.length === 0) {
  console.error("No paid user with that email");
  process.exit(1);
}
console.log(r.rows[0]);
await pool.end();

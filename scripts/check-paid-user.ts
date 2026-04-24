import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const email = process.argv[2] || "albanofgonzalez@gmail.com";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query(
  "SELECT id, email, project_limit, created_at FROM paid_users WHERE lower(email)=lower($1)",
  [email]
);
console.log("paid_users:", r.rows);
if (r.rows[0]) {
  const p = await pool.query(
    "SELECT id, title, paid_user_id, created_at FROM projects WHERE paid_user_id = $1",
    [r.rows[0].id]
  );
  console.log("projects:", p.rows);
}
const leg = await pool.query("SELECT id, email FROM users WHERE lower(email)=lower($1)", [email]);
console.log("legacy users (should be empty):", leg.rows);
await pool.end();

import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const email = process.argv[2];
if (!email) {
  console.error("Usage: tsx scripts/convert-to-paid.ts <email>");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const normalized = email.toLowerCase().trim();

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const { rows: legacy } = await client.query(
    "SELECT id, email, password, two_factor_enabled, two_factor_method, totp_secret FROM users WHERE lower(email)=$1",
    [normalized]
  );
  if (legacy.length === 0) throw new Error("No legacy user with that email");
  const u = legacy[0];

  const { rows: projCount } = await client.query(
    "SELECT count(*)::int AS n FROM projects WHERE user_id = $1",
    [u.id]
  );
  if (projCount[0].n > 0) {
    throw new Error(`User has ${projCount[0].n} existing project(s). Cannot auto-convert; move manually.`);
  }

  const { rows: inserted } = await client.query(
    `INSERT INTO paid_users (email, password, two_factor_enabled, two_factor_method, totp_secret, project_limit)
     VALUES ($1, $2, $3, $4, $5, 1)
     RETURNING id, email, project_limit`,
    [u.email, u.password, u.two_factor_enabled, u.two_factor_method, u.totp_secret]
  );

  await client.query("DELETE FROM users WHERE id = $1", [u.id]);
  await client.query("COMMIT");
  console.log("Converted:", inserted[0]);
} catch (e) {
  await client.query("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}

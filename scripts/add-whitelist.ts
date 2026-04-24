import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const email = process.argv[2];
if (!email) {
  console.error("Usage: tsx scripts/add-whitelist.ts <email>");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const res = await pool.query(
  `INSERT INTO email_whitelist (email, note, status)
   VALUES ($1, 'added via script', 'active')
   ON CONFLICT (email) DO UPDATE SET status='active'
   RETURNING email, status`,
  [email.toLowerCase().trim()]
);
console.log(res.rows);
await pool.end();

import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Limit drizzle-kit to schemas this app actually owns. Without this, push
  // would also see (and try to drop) tables in `public` and other schemas
  // that belong to other apps sharing the same Neon database — the twin
  // lawyer app's verified_practitioners / patents / etc. live elsewhere.
  // Never widen this list without confirming the new schema is owned by
  // this app.
  schemaFilter: ["inventor_geyser", "inventor_geyser_admin"],
});

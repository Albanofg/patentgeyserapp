// Stub — overwritten by `npm run build:vercel` (esbuild bundle of server-entry/vercel.ts).
// Committed so Vercel's function validation finds api/index.js before the build runs.
export default function handler(_req, res) {
  res.status(500).json({ message: "Build output missing — run `npm run build:vercel`." });
}

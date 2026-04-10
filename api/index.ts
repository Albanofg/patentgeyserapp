import { app, ensureInitialized } from "../server/app";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureInitialized();
  app(req, res);
}

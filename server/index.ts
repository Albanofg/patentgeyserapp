import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { probeSchema } from "./schema-probe";
import { backfillAllFamilyProjects } from "./lib/families";

const app = express();

// Trust proxy - required for production deployments behind reverse proxy (Replit, Heroku, etc.)
// This is critical for secure cookies to work properly
app.set('trust proxy', 1);

// CORS is not needed since frontend and backend are served from same origin
// Only enable in development if needed
if (process.env.NODE_ENV === "development") {
  app.use(cors({
    origin: "http://localhost:5000",
    credentials: true,
  }));
}

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  // Family context-file uploads ship the PDF base64-encoded inside JSON.
  // A 15 MB PDF expands to ~20 MB base64 — bumping the JSON limit accordingly.
  limit: '25mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '25mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Fail loud at boot if any required table is missing. We do this here
  // (not inside individual query sites) so the failure mode is honest —
  // the app refuses to serve traffic against a half-migrated database.
  await probeSchema();

  // One-shot, fire-and-forget refresh of every Project that belongs to a
  // family. Existing artifact-cache rows may have been written with an
  // older truncation rule; rebuilding them in the background converges the
  // cache to the current storage shape without blocking startup or any
  // request path. Idempotent — safe to run on every boot.
  backfillAllFamilyProjects()
    .then((r) => console.log(`[families] startup backfill refreshed=${r.refreshed} failed=${r.failed}`))
    .catch((err) => console.error("[families] startup backfill error", err));

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "127.0.0.1",
  }, () => {
    log(`serving on port ${port}`);
  });
})();

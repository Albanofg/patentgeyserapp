import express, { type Express, type Response } from "express";
import path from "path";
import { devPublicDir, watchClient } from "../build-client";
import { log } from "./log";

// Open tabs subscribe to this stream. Each build gets a new id, and a tab
// reloads when the id it hears differs from the first one it got. That covers
// both client rebuilds and server restarts (the reconnect brings a new id).
const RELOAD_PATH = "/__dev/reload";
const RELOAD_SCRIPT = `<script>
  let buildId;
  new EventSource("${RELOAD_PATH}").onmessage = (e) => {
    if (buildId && buildId !== e.data) location.reload();
    buildId = e.data;
  };
</script>`;

export async function setupDevClient(app: Express) {
  const tabs = new Set<Response>();
  let buildId = String(Date.now());

  app.get(RELOAD_PATH, (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    res.write(`data: ${buildId}\n\n`);
    tabs.add(res);
    req.on("close", () => tabs.delete(res));
  });

  await watchClient(RELOAD_SCRIPT, () => {
    buildId = String(Date.now());
    for (const tab of tabs) tab.write(`data: ${buildId}\n\n`);
    log("client built", "esbuild");
  });

  app.use(express.static(devPublicDir, { index: false }));

  // fall through to index.html so client-side routes load the app
  app.use((_req, res) => {
    res.sendFile(path.join(devPublicDir, "index.html"));
  });
}

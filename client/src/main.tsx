import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// After a Vercel deploy, old tabs hold the previous index.html which points
// at hashed JS chunks the CDN no longer serves. When the app lazy-loads one
// of those chunks, Vite throws "Failed to fetch dynamically imported module"
// and the route renders a blank page. Detect those errors and reload once
// to pick up the new index.html — but only once per session, so a genuinely
// broken chunk doesn't trap the user in a reload loop.
const STALE_RELOAD_KEY = "pg:stale-chunk-reloaded";

function isChunkLoadError(message: unknown): boolean {
  if (typeof message !== "string") return false;
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("error loading dynamically imported module") ||
    (message.includes("Failed to load module script") &&
      message.includes("MIME type"))
  );
}

function reloadOnceForStaleChunk(source: string) {
  if (typeof window === "undefined") return;
  if (window.sessionStorage.getItem(STALE_RELOAD_KEY) === "1") return;
  window.sessionStorage.setItem(STALE_RELOAD_KEY, "1");
  console.warn(`[pg] Stale chunk detected (${source}); reloading to pick up latest deploy.`);
  window.location.reload();
}

window.addEventListener("error", (e) => {
  if (isChunkLoadError(e.message)) reloadOnceForStaleChunk("window.error");
});
window.addEventListener("unhandledrejection", (e) => {
  const reason: any = e.reason;
  const msg = reason?.message ?? String(reason ?? "");
  if (isChunkLoadError(msg)) reloadOnceForStaleChunk("unhandledrejection");
});

// Successful navigation should clear the marker so future deploys can retry.
if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    // Slight delay so the marker survives the reload itself; clear once the
    // new bundle has fully booted.
    setTimeout(() => window.sessionStorage.removeItem(STALE_RELOAD_KEY), 5000);
  });
}

createRoot(document.getElementById("root")!).render(<App />);

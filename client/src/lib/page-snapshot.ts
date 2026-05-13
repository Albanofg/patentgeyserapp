/**
 * Page-snapshot registry.
 *
 * Each route can register a function that returns a structured snapshot of
 * what's currently on the page — the items the user sees, their stable ids,
 * unsaved form values, and which item is focused. The AI Helper reads from
 * this registry on every send so the model always knows what the user is
 * looking at without having to ask.
 *
 * Pages that haven't been wired up yet fall back to a `<main>` innerText
 * scrape via `getCurrentPageSnapshot()`. That keeps every page workable
 * without claiming reliability on pages that haven't been explicitly
 * snapshotted.
 */

import { useEffect, useRef } from "react";

export type PageSnapshotItem = {
  /** Stable id the model uses to reference this item, e.g. "Concept 21". */
  id: string;
  /** Short category tag, e.g. "extracted_idea", "key_concept", "prior_art". */
  type: string;
  /** Optional status tag, e.g. "approved", "pending", "rejected". */
  status?: string;
  /** Structured payload — strings, arrays, or objects the model can read. */
  content: any;
};

export type PageSnapshot = {
  /** Human-readable name of the page, e.g. "Inspect & Refine Ideas (Stage 1)". */
  pageName: string;
  /** The pathname (so the model can correlate with currentLocation). */
  route: string;
  /** One- to three-sentence description of what the user is doing here. */
  description?: string;
  /** Addressable items rendered on the page, in display order. */
  items?: PageSnapshotItem[];
  /** Unsaved form values keyed by field id. */
  drafts?: Record<string, string>;
  /** Id of the currently focused item, if any. */
  focused?: string;
  /** Source flag — set to "structured" by registered hooks, "fallback" by the scraper. */
  source?: "structured" | "fallback";
  /** Capture timestamp (set automatically). */
  capturedAt?: string;
};

// Module-level singleton — only one route renders at a time so this is fine.
let currentGetter: (() => PageSnapshot) | null = null;

function setGetter(getter: (() => PageSnapshot) | null) {
  currentGetter = getter;
}

/**
 * Register a snapshot for the current route. Pass the latest snapshot object
 * directly (use `useMemo` if you need stable identity); the hook keeps the
 * registry pointed at the freshest value so reads always reflect current state.
 *
 * Cleans up automatically on unmount.
 */
export function usePageSnapshot(snapshot: PageSnapshot) {
  const ref = useRef(snapshot);
  ref.current = snapshot;

  useEffect(() => {
    setGetter(() => ({
      ...ref.current,
      source: ref.current.source ?? "structured",
      capturedAt: new Date().toISOString(),
    }));
    return () => setGetter(null);
    // We intentionally never re-bind the getter — the ref handles freshness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Best-effort fallback scrape used when no page has registered a snapshot.
 * Reads `<main>` text and walks form fields for their live values.
 */
function fallbackScrape(): PageSnapshot {
  const route = typeof window !== "undefined" ? window.location.pathname : "";
  let mainText = "";
  const drafts: Record<string, string> = {};

  if (typeof document !== "undefined") {
    const main = document.querySelector("main");
    if (main) {
      // innerText collapses whitespace and respects visibility, which is what we want.
      mainText = (main as HTMLElement).innerText.trim();
    }
    const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "main input, main textarea",
    );
    inputs.forEach((el, i) => {
      if (!el.value) return;
      const key =
        el.getAttribute("data-snapshot-id") ||
        el.id ||
        el.getAttribute("name") ||
        `field_${i}`;
      drafts[key] = el.value;
    });
  }

  return {
    pageName: route,
    route,
    description:
      "Fallback scrape — this page has not registered a structured snapshot. " +
      "Treat the body text as the visible content.",
    items: mainText
      ? [{ id: "page_body", type: "scraped_text", content: mainText }]
      : [],
    drafts,
    source: "fallback",
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Read the latest page snapshot. Returns the registered snapshot if a page
 * has wired one up; otherwise falls back to a `<main>` scrape.
 */
export function getCurrentPageSnapshot(): PageSnapshot {
  if (currentGetter) {
    try {
      return currentGetter();
    } catch (err) {
      // Registered getter threw — fall through to the scrape fallback.
      console.warn("[page-snapshot] registered getter threw:", err);
    }
  }
  return fallbackScrape();
}

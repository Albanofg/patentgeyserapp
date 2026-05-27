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
  /**
   * Whether the user can edit this item's text on the current page. The helper
   * uses this to decide whether suggesting "paste this into the box" is valid
   * advice or a hallucinated affordance. When omitted, the server treats it as
   * `false` — affordances must be opted into, never assumed.
   */
  editable?: boolean;
  /**
   * If editable, the field id (matching a key in `drafts`) the user would
   * type into. Lets the helper say "edit the box labeled X" with precision.
   */
  editTarget?: string;
};

export type PageSnapshotAction = {
  /** Stable action id, e.g. "save-selection", "validate-inventorship". */
  id: string;
  /** Exact label rendered on the button, e.g. "Save Selection". */
  label: string;
  /**
   * Visual prominence. `primary` = the main CTA, `secondary` = supporting,
   * `destructive` = removes work. Helps the helper rank guidance.
   */
  kind?: "primary" | "secondary" | "destructive";
  /** Whether the action can be invoked right now. */
  enabled: boolean;
  /**
   * If `enabled` is false, the short reason. The helper should explain this
   * to the user verbatim instead of guessing why a button is greyed out.
   */
  reason?: string;
  /**
   * If clicking this action navigates the user somewhere, the target route.
   * Lets the helper preview what happens next without asking.
   */
  navigatesTo?: string;
};

export type PageSnapshot = {
  /** Human-readable name of the page, e.g. "Inspect & Refine Ideas (Stage 1)". */
  pageName: string;
  /**
   * The AI Helper's authoritative prompt-phase for this page (1–8), per
   * LAW_DECLARED_PHASE_AUTHORITATIVE in qa-assistant.md. The page is the only
   * thing that truly knows which phase the inventor is in, so it declares it
   * here and the server consumes it directly as `currentLocation.stage` rather
   * than guessing from the URL. Pages whose URL digit already equals their
   * phase still declare it for explicitness; pages that host more than one
   * phase (e.g. the Showcase = Genus & Species 7 / final draft 8) compute it
   * from their live sub-state. Omit on non-workflow surfaces — the server then
   * falls back to its URL/DB derivation.
   */
  phase?: number;
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
  /**
   * Actions (buttons, links) that actually exist on this page. The helper
   * MUST NOT suggest invoking an action that isn't in this list. An empty
   * array means "the page has no actions the user can take" — explicit, not
   * a "we don't know" signal. Fallback scrapes always set this to [] so the
   * helper never invents affordances from a fallback snapshot.
   */
  actions?: PageSnapshotAction[];
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
      "Treat the body text as the visible content. Do not assume any buttons, " +
      "edit fields, or other affordances exist beyond what is explicitly listed.",
    items: mainText
      ? [{ id: "page_body", type: "scraped_text", content: mainText, editable: false }]
      : [],
    drafts,
    // Fallback never claims actions exist. The helper must not invent buttons.
    actions: [],
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

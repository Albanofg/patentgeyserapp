// Whitespace-tolerant text matching for provisional-draft sections.
//
// Single source of truth shared by:
//   - the Showcase draft search (client/src/pages/agent5.tsx find-bar)
//   - the AI Helper's proposeDraftEdits validation (server/modules/module0/qa-assistant.ts)
//   - the apply-draft-edit endpoint (server/routes.ts)
//
// All three must agree on what "this text occurs in that section" means,
// otherwise the helper proposes an edit the apply endpoint can't find (or
// vice versa) and the inventor is stranded mid-fix.

/**
 * Find every occurrence of `query` in `text`, case-insensitively and
 * whitespace-tolerantly: any run of whitespace (spaces, line breaks, paragraph
 * breaks) on either side matches any run on the other. This is what lets a
 * phrase quoted from the draft still match when line breaks were mangled in
 * transit (chat → clipboard → single-line input) or when the draft re-wrapped.
 *
 * Returns [start, end) ranges in the ORIGINAL text so highlights and splices
 * stay exact.
 */
export function findDraftMatches(text: string, query: string): Array<{ start: number; end: number }> {
  const needle = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (!needle) return [];
  // Normalized haystack with a map from each normalized char back to its
  // original index (a collapsed whitespace run maps to the run's first char).
  const lower = text.toLowerCase();
  let norm = "";
  const map: number[] = [];
  let inWs = false;
  for (let i = 0; i < lower.length; i++) {
    if (/\s/.test(lower[i])) {
      if (!inWs && norm.length > 0) { norm += " "; map.push(i); }
      inWs = true;
    } else {
      norm += lower[i]; map.push(i); inWs = false;
    }
  }
  const matches: Array<{ start: number; end: number }> = [];
  let idx = norm.indexOf(needle);
  while (idx !== -1) {
    // The needle is trimmed, so its last char is non-whitespace and maps to an
    // exact original index — end is that index + 1.
    matches.push({ start: map[idx], end: map[idx + needle.length - 1] + 1 });
    idx = norm.indexOf(needle, idx + needle.length);
  }
  return matches;
}

export type DraftEditStatus = "ready" | "whole_section" | "not_found" | "ambiguous" | "already_applied";

/**
 * Classify a proposed edit against the current section text. `find` empty (or
 * whitespace-only) means "replace the entire section". Otherwise the anchor
 * must occur exactly once for the edit to be applied unambiguously.
 */
export function classifyDraftEdit(sectionText: string, find: string, replace?: string): { status: DraftEditStatus; matchCount: number } {
  if (!find || !find.trim()) return { status: "whole_section", matchCount: 0 };
  const matches = findDraftMatches(sectionText, find);
  if (matches.length === 0) {
    // The anchor is gone. If the replacement text is already present, the edit
    // was already applied (a prior click, or the model re-proposed a done edit)
    // — surface that as a calm "already applied", not a scary "not found".
    if (replace && findDraftMatches(sectionText, replace).length > 0) {
      return { status: "already_applied", matchCount: 0 };
    }
    return { status: "not_found", matchCount: 0 };
  }
  if (matches.length > 1) return { status: "ambiguous", matchCount: matches.length };
  return { status: "ready", matchCount: 1 };
}

/**
 * Apply a single edit to a section's text. Returns the new text, or an error
 * status when the anchor is missing/ambiguous. Whole-section edits replace
 * everything. Callers decide what to do with errors (the apply endpoint
 * returns 409; the helper's validator reports the status back to the model).
 */
export function applyDraftEdit(
  sectionText: string,
  find: string,
  replace: string,
): { ok: true; text: string } | { ok: false; status: DraftEditStatus; matchCount: number } {
  const { status, matchCount } = classifyDraftEdit(sectionText, find);
  if (status === "whole_section") return { ok: true, text: replace };
  if (status !== "ready") return { ok: false, status, matchCount };
  const [m] = findDraftMatches(sectionText, find);
  return { ok: true, text: sectionText.slice(0, m.start) + replace + sectionText.slice(m.end) };
}

// UPL (Unauthorized Practice of Law) output lint.
//
// The AI Helper must never opine on the legal strength, validity, patentability,
// enforceability, or examination/litigation prospects of an inventor's specific
// patent — that is the unauthorized practice of law. The prompt requests this
// register; this module ENFORCES it deterministically on the helper's outgoing
// text, because a self-contradicting prompt can't be trusted to police itself.
//
// See qa-assistant.UPL-compliance-draft.md for the policy this implements.
//
// USAGE / ROLLOUT: run in "flag" mode first — log findings, do NOT block — to
// gather false positives in real sessions and tune the lexicon. Only switch the
// `block`-tier to actually withhold/rewrite once the false-positive rate is
// known. `hasBlockingFindings()` is provided for when that switch is flipped.

export type UPLSeverity = "block" | "review";

export interface UPLRule {
  // Case-insensitive matcher. Keep patterns specific to limit false positives.
  pattern: RegExp;
  severity: UPLSeverity;
  // Why this phrasing is a legal conclusion (shown to whoever tunes the lexicon).
  note: string;
  // Suggested technical-register replacement, when there is a clean one.
  suggestion?: string;
}

export interface UPLFinding {
  term: string; // the exact matched substring
  index: number; // start offset in the scanned text
  severity: UPLSeverity;
  note: string;
  suggestion?: string;
}

// The lexicon. `block` = high-confidence legal conclusions that should never
// reach the inventor. `review` = context-dependent terms worth flagging but not
// necessarily blocking. Counsel/product can tune this list — it is the single
// source of truth for the banned register.
export const UPL_LEXICON: UPLRule[] = [
  // ── block: direct legal conclusions about the patent ──────────────────────
  { pattern: /\bdefensib(?:le|ility)\b/gi, severity: "block", note: "asserts legal strength", suggestion: "harder for a competitor to replicate / technically distinct" },
  { pattern: /\bpatentab(?:le|ility)\b/gi, severity: "block", note: "legal conclusion about patent status" },
  { pattern: /\benforceab(?:le|ility)\b/gi, severity: "block", note: "validity/enforcement opinion" },
  { pattern: /\bvalidity\b/gi, severity: "block", note: "validity opinion" },
  { pattern: /\bsurvives?\s+(?:the\s+)?examination\b/gi, severity: "block", note: "predicts an examination outcome" },
  { pattern: /\bthe\s+examiner\s+will\b/gi, severity: "block", note: "predicts examiner behavior" },
  { pattern: /\bwill\s+be\s+(?:allowed|granted)\b/gi, severity: "block", note: "predicts grant" },
  { pattern: /\blegally\s+(?:durable|strong|sound|enforceable)\b/gi, severity: "block", note: "legal-strength opinion", suggestion: "thorough / well-specified / broad in technical scope" },
  { pattern: /\bholds?\s+up\s+in\s+court\b/gi, severity: "block", note: "litigation-outcome opinion" },
  { pattern: /\binfring(?:e|es|ed|ement|ing)\b/gi, severity: "block", note: "enforcement opinion" },
  { pattern: /\bdesign(?:ing)?\s+around\b/gi, severity: "block", note: "enforcement/circumvention framing", suggestion: "an additional implementation approach in the description" },
  { pattern: /\bcircumvention\s+vector\b/gi, severity: "block", note: "enforcement/circumvention framing", suggestion: "an additional implementation approach in the description" },
  { pattern: /(?:§|section)\s*101\b/gi, severity: "block", note: "cites statute to the inventor (legal prediction)" },
  { pattern: /\beligib(?:le|ility)\b/gi, severity: "block", note: "patent-eligibility legal conclusion" },
  { pattern: /\bDesjardins\b/gi, severity: "block", note: "cites case law to the inventor" },
  { pattern: /\bguarantee(?:s|d)?\s+(?:a\s+|your\s+)?patent\b/gi, severity: "block", note: "assures a legal outcome" },
  { pattern: /\bweaving\b[^.]{0,40}\bdefensib/gi, severity: "block", note: "the originally-flagged defensibility assurance" },
  { pattern: /\b(?:legally\s+)?protect(?:s|ed)?\s+you\b/gi, severity: "block", note: "assures legal protection" },

  // ── review: context-dependent; flag, don't necessarily block ──────────────
  { pattern: /\bmoat\b/gi, severity: "review", note: "defensibility metaphor — check context", suggestion: "technical barrier to replication" },
  { pattern: /\bdefend(?:s|ing)?\b/gi, severity: "review", note: "may imply legal defense — check context" },
  { pattern: /\bstrong\s+patent\b/gi, severity: "review", note: "strength claim — check context" },
  { pattern: /\bbroad\s+claims?\b/gi, severity: "review", note: "'claims' is separately banned; check phrasing" },
  { pattern: /\bcircumvent(?:s|ed|ing)?\b/gi, severity: "review", note: "enforcement framing — check context" },
  { pattern: /\bAlice\b/gi, severity: "review", note: "possible case-law reference — check context" },
];

/**
 * Scan helper output for banned-register language. Returns one finding per
 * match, in order of appearance. Pure and deterministic.
 */
export function scanForUPL(text: string): UPLFinding[] {
  if (!text) return [];
  const findings: UPLFinding[] = [];
  for (const rule of UPL_LEXICON) {
    // Clone with a global flag so matchAll is safe and we never mutate the
    // shared rule's lastIndex.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
    for (const m of text.matchAll(re)) {
      findings.push({
        term: m[0],
        index: m.index ?? 0,
        severity: rule.severity,
        note: rule.note,
        suggestion: rule.suggestion,
      });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

/** True if the text contains any `block`-tier UPL language. */
export function hasBlockingUPL(text: string): boolean {
  return scanForUPL(text).some((f) => f.severity === "block");
}

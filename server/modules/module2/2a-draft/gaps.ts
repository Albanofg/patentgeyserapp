// ─────────────────────────────────────────────────────────────────────────
// SECTION 3 gap parser — Gate 2 of the gap-ledger rebuild (generative lock).
//
// The 2a draft prompt (draft.md, OUTPUT_FORMAT) emits four sections; SECTION 3
// ("CANDIDATES FOR INVENTOR CONFIRMATION") carries three bulleted sub-streams:
//   - Granularity Gap Coaching Prompts   → class missing_mechanism (BLOCKS)
//   - Inferred Subsystem Candidates       → class inferred_subsystem (proposal)
//   - Novelty Claim Candidates            → class novelty_candidate  (proposal)
// Today that section is generated on every run and silently discarded. This
// parser turns it into structured gap records so the ledger can persist them.
//
// Pure function, no I/O — the route assembles the full row (projectId, origin)
// and writes via storage. Tolerant by design: the prompt fixes the section
// labels but not the exact sub-header rendering, so parsing is best-effort.
// On anything it can't recognise it returns fewer rows rather than guessing —
// never throws. If this proves brittle, the planned refinement is to have 2a
// emit SECTION 3 as a structured block (a prompt/LEAP edit, out of scope here).

import type { GapClass } from "@shared/schema";

export interface ParsedGap {
  gapClass: GapClass;
  description: string;
  blockedModules: string[];
}

// Downstream modules that must refuse to fabricate over an open
// missing_mechanism gap (read by the enforcement layer in later gates).
// Only missing_mechanism blocks; the two AI-proposal classes never do.
const MECHANISM_BLOCKED_MODULES = ["module5", "module4b", "module4-pannu"];

interface StreamDef {
  gapClass: GapClass;
  blockedModules: string[];
  headerRe: RegExp; // anchored, tested against a prefix-stripped line
}

// Order matters only for first-match precedence; the three phrases don't overlap.
const STREAMS: StreamDef[] = [
  { gapClass: "missing_mechanism", blockedModules: MECHANISM_BLOCKED_MODULES, headerRe: /^granularity\s+gap/i },
  { gapClass: "inferred_subsystem", blockedModules: [], headerRe: /^inferred\s+subsystem/i },
  { gapClass: "novelty_candidate", blockedModules: [], headerRe: /^novelty\b/i },
];

const SECTION3_RE = /^[#*_>\s]*SECTION\s*3\b/i;
const SECTION4_RE = /^[#*_>\s]*SECTION\s*4\b/i;
const BULLET_RE = /^\s*(?:[-*•‣◦]|\d+[.)])\s+(.*)$/;

// Strip leading markdown/quote/bullet-bold markers and any "1." / "1)" numbering.
// Note: "-" is intentionally NOT stripped, so "- foo" bullets are never mistaken
// for sub-headers.
function stripPrefix(line: string): string {
  return line.replace(/^[#*_>\s]*\(?\s*(?:\d+[.)]\s*)?/, "").trim();
}

// A line is a sub-header only if it STARTS with a stream phrase and carries
// little trailing content (headers are short; bullets that merely mention a
// phrase are long). The 120-char budget allows a short parenthetical gloss.
function matchStreamHeader(line: string): StreamDef | null {
  const s = stripPrefix(line);
  for (const st of STREAMS) {
    if (st.headerRe.test(s)) {
      const remainder = s.replace(st.headerRe, "").replace(/^[\s:）)\-–—.]+/, "").trim();
      if (remainder.length <= 120) return st;
    }
  }
  return null;
}

// Pull the SECTION 3 body (lines AFTER its header, up to SECTION 4 / EOF).
// The header line itself is excluded because it lists all three stream names
// in a parenthetical, which would otherwise be misread as sub-headers.
function sliceSection3Body(text: string): string[] | null {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION3_RE.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (SECTION4_RE.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end);
}

// Extract bulleted items from a stream block (header line already excluded).
// Continuation lines (non-bullet, non-blank) fold into the current item so a
// gap whose justification wraps across lines stays one record.
function extractItems(blockLines: string[]): string[] {
  const items: string[] = [];
  let current: string | null = null;
  for (const line of blockLines) {
    const m = line.match(BULLET_RE);
    if (m) {
      if (current !== null) items.push(current);
      current = m[1];
    } else if (current !== null) {
      const t = line.trim();
      if (t) current += " " + t;
    }
  }
  if (current !== null) items.push(current);
  return items.map((s) => s.trim()).filter((s) => s.length >= 8);
}

const MAX_GAPS = 200; // backstop against a pathological parse

export function parseSection3Gaps(draftText: string): ParsedGap[] {
  if (!draftText || typeof draftText !== "string") return [];
  const body = sliceSection3Body(draftText);
  if (body === null) return [];

  const headers: Array<{ line: number; stream: StreamDef }> = [];
  for (let i = 0; i < body.length; i++) {
    const st = matchStreamHeader(body[i]);
    if (st) headers.push({ line: i, stream: st });
  }
  if (headers.length === 0) return [];

  const gaps: ParsedGap[] = [];
  const seen = new Set<string>();
  for (let h = 0; h < headers.length; h++) {
    const from = headers[h].line + 1;
    const to = h + 1 < headers.length ? headers[h + 1].line : body.length;
    const stream = headers[h].stream;
    for (const description of extractItems(body.slice(from, to))) {
      const key = `${stream.gapClass}::${description}`;
      if (seen.has(key)) continue;
      seen.add(key);
      gaps.push({ gapClass: stream.gapClass, description, blockedModules: stream.blockedModules });
      if (gaps.length >= MAX_GAPS) return gaps;
    }
  }
  return gaps;
}

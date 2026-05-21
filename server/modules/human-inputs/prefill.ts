// Pannu pre-fill engine. Returns the user's verbatim typing grouped by
// Pannu factor so the answer fields can be filled from prior work instead
// of asking the user to retype.
//
// DETERMINISTIC code — no AI. Two read paths feed it:
//
//   1. `human_inputs` ledger — preferred, has explicit tags and per-row
//      timestamps.
//
//   2. Fallback synthesis from existing tables: `agent_data` blobs and the
//      user-role rows in `coach_messages`. This path matters for any project
//      created before the ledger writers existed AND for surfaces that
//      still don't have writers wired (Module 1-inspect, Module 2b custom
//      idea, AI Helper chat). Without this fallback, POHC would say "no
//      earlier notes" on every factor of a newly-finished project — which
//      is false by construction (the concepts had to come from somewhere).
//
// Both paths emit the same `PrefillSource` shape so the UI doesn't care
// which one a given row came from.

import { and, asc, eq, sql } from "drizzle-orm";
import { listHumanInputs } from "./ledger";
import {
  PANNU_FACTORS,
  PANNU_FACTOR_TAGS,
  friendlySourceLabel,
  type PannuFactor,
} from "./tags";
import { db } from "../../db";
import { agentData } from "@shared/schema";
import type { HumanInput } from "@shared/schema";
import {
  runFactorSummarizer,
  fallbackFactorQuestion,
  factorDefinition,
  type PohcFactor,
} from "../module4/4c-pannu/pannu";

export interface PrefillSource {
  inputId: string;
  source: string;
  sourceLabel: string;
  sourceRefId: string | null;
  text: string;
  capturedAt: string | null;
}

export interface PrefillFactor {
  factor: PannuFactor;
  draft: string;
  coverage: number; // total character count across contributing rows
  sources: PrefillSource[];
  // Summarizer fields (present when AI polishing ran for this factor)
  summarized?: boolean;
  quote_seeds?: string[];
  raw_draft?: string; // the deterministic concatenation pre-summarization
  // Populated when the AI polishing step failed (network / parse / validation).
  // The UI uses raw_draft as the inserted fallback and surfaces this string
  // as a toast so the user knows polishing didn't run.
  summarizerError?: string | null;
}

export interface PrefillResult {
  conceptId: string | null;
  factors: Record<PannuFactor, PrefillFactor>;
}

// Tunable: a factor with this many chars of source material is considered
// "well-covered" — the UI uses this to show a confident green-ish state.
export const COVERAGE_STRONG_THRESHOLD = 250;
export const COVERAGE_WEAK_THRESHOLD = 60;

// Internal source shape that both read paths produce before being grouped
// by factor. Carries the same fields as PrefillSource plus a list of
// factor names this row should feed (so a single source row can contribute
// to multiple factors when its content is multi-purpose).
interface RawSource {
  inputId: string;
  source: string;
  sourceLabel: string;
  sourceRefId: string | null;
  text: string;
  capturedAt: string | null;
  factors: PannuFactor[];
}

export async function buildPannuPrefill(args: {
  projectId: string;
  conceptId?: string | null;
  claimText?: string | null;
  factorQuestions?: Partial<Record<PannuFactor, string>>;
  // When true, run the AI summarizer; when false, return the deterministic
  // concatenation only (legacy behavior).
  summarize?: boolean;
  // When set, only this factor is summarized. The other two return the
  // deterministic concatenation. Lets the UI summarize-on-click without
  // burning Flash calls on factors the user isn't editing.
  summarizeFactor?: PannuFactor | null;
}): Promise<PrefillResult> {
  const fromLedger = await readFromLedger(args);
  const fromAgentData = await readFromAgentData(args);
  // coach_messages is intentionally NOT used as a prefill source. The
  // leap-message mirror already writes substantive AI Helper answers into
  // the human_inputs ledger with factor tags. Re-reading coach_messages
  // here dragged in conversational navigation ("should I approve all 3?",
  // "concept 2?", etc.) and double-counted the qualified answers.
  const fromCoach: RawSource[] = [];

  console.log("[pannu prefill]", {
    projectId: args.projectId,
    conceptId: args.conceptId ?? null,
    ledgerRows: fromLedger.length,
    agentDataRows: fromAgentData.length,
    coachRows: fromCoach.length,
    agentDataSample: fromAgentData.slice(0, 3).map((r) => ({
      source: r.source,
      sourceRefId: r.sourceRefId,
      factors: r.factors,
      textChars: r.text.length,
    })),
  });

  // Defense in depth: drop short / conversational fragments before grouping.
  // 80 chars is the floor; navigational chatter ("ok", "concept 2?",
  // "move to the fifth one", "should I approve all 3?") sits well below it.
  const MIN_SOURCE_CHARS = 80;
  const all = [...fromLedger, ...fromAgentData, ...fromCoach].filter(
    (r) => r.text.trim().length >= MIN_SOURCE_CHARS,
  );
  const factors = groupByFactor(all);

  console.log("[pannu prefill] grouped", {
    conception: { sources: factors.conception.sources.length, coverage: factors.conception.coverage },
    quality: { sources: factors.quality.sources.length, coverage: factors.quality.coverage },
    known_concepts: { sources: factors.known_concepts.sources.length, coverage: factors.known_concepts.coverage },
  });

  // Optional AI polishing pass. Runs SEQUENTIALLY across the three factors
  // (one Flash call at a time) to keep model load predictable and to avoid
  // hammering the provider with three concurrent large-payload requests.
  // Each factor falls back to its deterministic concatenation if the
  // summarizer fails or if there are no sources.
  if (args.summarize) {
    const claimText = (args.claimText ?? "").trim();
    const factorEntries: PohcFactor[] = args.summarizeFactor
      ? [args.summarizeFactor]
      : ["conception", "quality", "known_concepts"];
    for (const factor of factorEntries) {
      const f = factors[factor];
      if (!f.sources || f.sources.length === 0) continue;
      const rawSourceText = f.sources.map((s) => s.text).join("\n\n");
      const sourceBreakdown = f.sources.map((s) => ({
        text: s.text,
        tag: factor,
        source: s.source,
        charCount: s.text.length,
      }));
      const question = args.factorQuestions?.[factor] || fallbackFactorQuestion(factor);
      const usingFallbackQuestion = !args.factorQuestions?.[factor];
      console.log("[pannu summarizer] firing", {
        factor,
        usingFallbackQuestion,
        factor_question: question,
        claim_text_chars: claimText.length,
        sources: f.sources.length,
        raw_source_chars: rawSourceText.length,
        source_origins: f.sources.map((s) => s.source),
      });
      const result = await runFactorSummarizer({
        factor,
        factor_question: question,
        factor_definition: factorDefinition(factor),
        claim_text: claimText,
        raw_source_text: rawSourceText,
        source_breakdown: sourceBreakdown,
      });
      console.log("[pannu summarizer] result", {
        factor,
        success: result.success,
        draft_chars: result.success ? result.result.draft.length : 0,
        error: result.success ? null : result.error,
      });
      if (result.success) {
        factors[factor] = {
          ...f,
          raw_draft: f.draft,
          draft: result.result.draft,
          summarized: true,
          quote_seeds: result.result.quote_seeds,
          summarizerError: null,
        };
      } else {
        // Network / parse / validation failure — fall back to the clean
        // deterministic concatenation so the field is never empty, and
        // surface the cause via summarizerError for client-side toasting.
        factors[factor] = {
          ...f,
          raw_draft: f.draft,
          summarized: false,
          summarizerError: `Summarizer call failed: ${result.error}. Raw notes inserted.`,
        };
      }
    }
  }

  return {
    conceptId: args.conceptId ?? null,
    factors,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Source 1: explicit `human_inputs` ledger
// ───────────────────────────────────────────────────────────────────────────

async function readFromLedger(args: {
  projectId: string;
  conceptId?: string | null;
}): Promise<RawSource[]> {
  // Read project-wide regardless of conceptId. The page passes an internal
  // key-concept id ("concept-1-...") that doesn't line up with the "Concept N"
  // scoping the ledger writers use, so concept-scoped reads here silently
  // dropped every real row. Per product direction, repeating the same
  // evidence across concepts is acceptable — tracing back matters more.
  //
  const rows = await listHumanInputs({
    projectId: args.projectId,
    conceptId: null,
  });
  const out: RawSource[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.tags) || row.tags.length === 0) continue;
    const factors = factorsForTags(row.tags);
    if (factors.length === 0) continue;
    out.push({
      inputId: row.id,
      source: row.source,
      sourceLabel: friendlySourceLabel(row.source),
      sourceRefId: row.sourceRefId ?? null,
      text: row.answerText,
      capturedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      factors,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Source 2: existing `agent_data` blobs
// ───────────────────────────────────────────────────────────────────────────

async function readFromAgentData(args: {
  projectId: string;
  conceptId?: string | null;
}): Promise<RawSource[]> {
  const rows = await db
    .select()
    .from(agentData)
    .where(eq(agentData.projectId, args.projectId))
    .orderBy(asc(agentData.agentNumber));

  const out: RawSource[] = [];
  const ts = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

  for (const row of rows) {
    const data = (row.data ?? {}) as any;
    const updatedAt = ts((row.updatedAt ?? row.createdAt) as any);

    // Module 1 — initial idea description
    if (row.agentNumber === 1) {
      const ideaSummary: string = (data.ideaSummary || data.currentIdea || data.originalIdea || "").toString();
      if (ideaSummary.trim()) {
        out.push({
          inputId: `agentData-${row.id}-ideaSummary`,
          source: "module1/initial-idea",
          sourceLabel: friendlySourceLabel("module1/initial-idea"),
          sourceRefId: null,
          text: ideaSummary,
          capturedAt: updatedAt,
          factors: ["conception", "known_concepts"],
        });
      }
      // Approved/extracted ideas the user kept in Module 1 (user-curated set)
      const approved: any[] = Array.isArray(data.approvedIdeas)
        ? data.approvedIdeas
        : Array.isArray(data.extractedIdeas)
          ? data.extractedIdeas.filter((i: any) => i?.status !== "discarded")
          : [];
      for (const idea of approved) {
        const text = (idea?.editedContent || idea?.text || idea?.item || idea?.title || idea?.description || "").toString();
        if (!text.trim()) continue;
        out.push({
          inputId: `agentData-${row.id}-idea-${idea?.id || idea?.number || text.slice(0, 20)}`,
          source: "module1/inspect",
          sourceLabel: friendlySourceLabel("module1/inspect"),
          sourceRefId: idea?.id ? String(idea.id) : null,
          text,
          capturedAt: updatedAt,
          factors: ["conception", "quality"],
        });
      }
    }

    // Module 2 — additionalNotes, refinementFeedback, extractedIdeas, customIdeas
    if (row.agentNumber === 2) {
      const additionalNotes: string = (data.additionalNotes || "").toString();
      if (additionalNotes.trim()) {
        out.push({
          inputId: `agentData-${row.id}-additionalNotes`,
          source: "module2/additional-notes",
          sourceLabel: friendlySourceLabel("module2/additional-notes"),
          sourceRefId: null,
          text: additionalNotes,
          capturedAt: updatedAt,
          factors: ["conception", "quality"],
        });
      }
      const refinement: string = (data.refinementFeedback || "").toString();
      if (refinement.trim()) {
        out.push({
          inputId: `agentData-${row.id}-refinement`,
          source: "module2/refinement",
          sourceLabel: friendlySourceLabel("module2/refinement"),
          sourceRefId: null,
          text: refinement,
          capturedAt: updatedAt,
          factors: ["conception", "quality"],
        });
      }
      const extracted: any[] = Array.isArray(data.extractedIdeas) ? data.extractedIdeas : [];
      for (const idea of extracted) {
        if (idea?.selected === false) continue;
        const text = (idea?.text || idea?.title || idea?.description || "").toString();
        if (!text.trim()) continue;
        out.push({
          inputId: `agentData-${row.id}-extracted-${idea?.id || text.slice(0, 20)}`,
          source: idea?.userAdded ? "module2/extracted-ideas" : "module2/extracted-ideas",
          sourceLabel: friendlySourceLabel("module2/extracted-ideas"),
          sourceRefId: idea?.id ? String(idea.id) : null,
          text,
          capturedAt: updatedAt,
          // Extracted ideas are quality / conception material when user-kept
          factors: ["quality", "conception"],
        });
      }
    }

    // Module 4 — per-concept user notes. Every note becomes a candidate
    // for every concept (the user explicitly OK'd repeating the same
    // material across concepts — the goal is tracing back, not gating).
    if (row.agentNumber === 4) {
      const userNotes = (data.userNotes ?? {}) as Record<string, string>;
      for (const [idx, note] of Object.entries(userNotes)) {
        const noteStr = (note ?? "").toString();
        if (!noteStr.trim()) continue;
        const conceptLabel = `Concept ${Number(idx) + 1}`;
        out.push({
          inputId: `agentData-${row.id}-userNote-${idx}`,
          source: "module4a/concept-notes",
          sourceLabel: friendlySourceLabel("module4a/concept-notes"),
          sourceRefId: conceptLabel,
          text: noteStr,
          capturedAt: updatedAt,
          factors: ["known_concepts", "quality"],
        });
      }
      // Strategic directive (AI-generated, but the user reviewed/accepted
      // it on the page — counts as part of the project's record). Skipped
      // here because it's AI content, not user typing. We surface user
      // notes only.
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Source 3: user-role rows in `coach_messages` (AI Helper chat)
// ───────────────────────────────────────────────────────────────────────────

async function readFromCoachMessages(args: {
  projectId: string;
  conceptId?: string | null;
}): Promise<RawSource[]> {
  // We don't have a direct drizzle declaration for coachMessages in this
  // module's scope (it lives inside module0/qa-assistant.ts), so we query
  // via raw SQL — cheap and read-only. We pull user-role messages only;
  // assistant messages are AI-generated and don't belong in POHC evidence.
  try {
    const res = await db.execute(sql`
      SELECT id, content, current_location, created_at
      FROM inventor_geyser.coach_messages
      WHERE project_id = ${args.projectId}
        AND role = 'user'
      ORDER BY created_at ASC
    `);
    const rows = ((res as any).rows ?? []) as Array<{
      id: string;
      content: string;
      current_location: any;
      created_at: Date | string | null;
    }>;
    const out: RawSource[] = [];
    for (const r of rows) {
      const text = (r.content ?? "").toString().trim();
      if (!text) continue;
      // Accept every user chat message as POHC source material. The user
      // explicitly OK'd same-content-across-concepts; the conceptId from
      // the page is an internal key-concept id that doesn't match anything
      // in chat text anyway, so scoping here just dropped real evidence.
      out.push({
        inputId: `coach-${r.id}`,
        source: "module0/qa-assistant",
        sourceLabel: friendlySourceLabel("module0/qa-assistant"),
        sourceRefId: null,
        text,
        capturedAt: r.created_at ? new Date(r.created_at as any).toISOString() : null,
        // Chat is open-domain — feed all three factors and let dedupe drop
        // it if a more specific source already covered the same content.
        factors: ["conception", "quality", "known_concepts"],
      });
    }
    return out;
  } catch (e: any) {
    console.warn("[pannu prefill] coach_messages read failed:", e?.message);
    return [];
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Grouping + dedupe
// ───────────────────────────────────────────────────────────────────────────

function factorsForTags(tags: string[]): PannuFactor[] {
  const out = new Set<PannuFactor>();
  for (const factor of PANNU_FACTORS) {
    const factorTagSet = new Set<string>(PANNU_FACTOR_TAGS[factor]);
    if (tags.some((t) => factorTagSet.has(t))) out.add(factor);
  }
  return Array.from(out);
}

function groupByFactor(rows: RawSource[]): Record<PannuFactor, PrefillFactor> {
  const out = {} as Record<PannuFactor, PrefillFactor>;
  for (const factor of PANNU_FACTORS) {
    const matching = rows.filter((r) => r.factors.includes(factor));
    out[factor] = factorFromRows(factor, matching);
  }
  return out;
}

function factorFromRows(factor: PannuFactor, rows: RawSource[]): PrefillFactor {
  // Dedupe on NORMALIZED TEXT CONTENT — the same paragraph reaching the pool
  // from two read paths (e.g. ledger + agent_data) had distinct source
  // labels and so used to slip past the old (source, sourceRefId, prefix)
  // fingerprint and appear twice in the rephraser's input. Normalize on
  // whitespace + casing + a 200-char window so near-identical copies
  // collapse too.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  const seen = new Set<string>();
  const ordered: RawSource[] = [];
  for (const row of rows) {
    const fingerprint = norm(row.text);
    if (!fingerprint) continue;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    ordered.push(row);
  }

  // Oldest first so the draft reads in the order the user built up their
  // thinking. Sort by capturedAt; null timestamps go to the end.
  ordered.sort((a, b) => {
    if (a.capturedAt && b.capturedAt) return a.capturedAt.localeCompare(b.capturedAt);
    if (a.capturedAt) return -1;
    if (b.capturedAt) return 1;
    return 0;
  });

  const sources: PrefillSource[] = ordered.map((r) => ({
    inputId: r.inputId,
    source: r.source,
    sourceLabel: r.sourceLabel,
    sourceRefId: r.sourceRefId,
    text: r.text,
    capturedAt: r.capturedAt,
  }));

  const draft = sources.map((s) => s.text).join("\n\n").trim();
  const coverage = sources.reduce((sum, s) => sum + s.text.length, 0);

  return { factor, draft, coverage, sources };
}

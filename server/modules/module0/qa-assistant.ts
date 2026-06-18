// ─────────────────────────────────────────────────────────────────────────────
// Module 0 — Q&A Assistant
//
// This file owns the entire Q&A Assistant behaviour. Everything for this agent
// lives here:
//   - Local declarations for the assistant's persistence tables (coach_messages,
//     coach_log_entries, coach_open_questions) that already exist in the
//     inventor_geyser schema.
//   - Loads the system prompt from qa-assistant.md (untouched, owned by user).
//   - Loads config from qa-assistant.config.json.
//   - Calls the AI with function-calling tools.
//   - Executes tool calls server-side, writing to the local tables.
//   - Returns a string response to the route handler in routes.ts.
//
// The exported function signature matches what the existing
// /api/projects/:id/qa-assistant route expects, so the route does not change.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import OpenAI from "openai";
import { z } from "zod";
import {
  pgSchema,
  varchar,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { recordUsage, extractOpenAIUsage } from "../../ai/usage-log";
import { computeRouting, renderRouting, tagsSatisfyScopeId, type RoutingFields } from "./routing";
import { getSiblingsReference, getRelevantFamilyArtifacts, type SiblingReference, type RetrievedArtifact } from "../../lib/families";
import { listFamilyContextFilesForPrompt } from "../../lib/family-context-files";
import { requireEnv } from "../../lib/env";
import Anthropic from "@anthropic-ai/sdk";
import { classifyDraftEdit } from "@shared/draft-match";
import { scanForUPL } from "@shared/upl-lint";

// ─── Module-owned table declarations ────────────────────────────────────────
// These point at physical tables already created in the inventor_geyser schema
// and are declared here so the module is self-contained and doesn't bleed
// into shared/schema.ts.

const inventorGeyser = pgSchema("inventor_geyser");
const m0Table = inventorGeyser.table.bind(inventorGeyser);

const coachMessages = m0Table("coach_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  pageModel: jsonb("page_model"),
  currentLocation: jsonb("current_location"),
  unsavedDrafts: jsonb("unsaved_drafts"),
  selectedText: text("selected_text"),
  toolCalls: jsonb("tool_calls"),
  createdAt: timestamp("created_at").defaultNow(),
});

const coachLogEntries = m0Table("coach_log_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  entryType: text("entry_type").notNull(),
  verbatimText: text("verbatim_text").notNull(),
  sourceMessageId: varchar("source_message_id"),
  capturedAt: timestamp("captured_at").defaultNow(),
  capturedBy: text("captured_by").notNull(),
  editedText: text("edited_text"),
  editedAt: timestamp("edited_at"),
  dismissedAt: timestamp("dismissed_at"),
  tags: text("tags").array(),
});

const coachOpenQuestions = m0Table("coach_open_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  question: text("question").notNull(),
  askedInMessageId: varchar("asked_in_message_id"),
  answeredAt: timestamp("answered_at"),
  answeredInMessageId: varchar("answered_in_message_id"),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// idea_snapshots already exists app-wide; we reference it via raw SQL to avoid
// re-declaring something shared with the rest of the app.

// ─── Config + prompt loading ────────────────────────────────────────────────

const MODULE_DIR = path.resolve(process.cwd(), "server", "modules", "module0");
const CONFIG_PATH = path.join(MODULE_DIR, "qa-assistant.config.json");
const PROMPT_PATH = path.join(MODULE_DIR, "qa-assistant.md");

interface QAConfig {
  model: string;
  fallback: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  historyCap: number;
  streaming: boolean;
  toolsEnabled: boolean;
}

const CONFIG: QAConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
const SYSTEM_PROMPT = fs.readFileSync(PROMPT_PATH, "utf-8");

const gemini = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
// Secondary key (separate GCP project = separate quota bucket). Used as a
// failover when the primary throws — keeps the AI Helper alive through
// rate-limit hiccups without falling back to gpt-4o.
const geminiSecondary = process.env.GEMINI_API_SECOND_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_SECOND_KEY })
  : null;
const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
// Primary Helper model is set in qa-assistant.config.json. The API key is read
// from CLAUDE_API_KEY and passed to the client explicitly (the SDK's default
// env var name differs from ours).
const anthropic = new Anthropic({ apiKey: requireEnv("CLAUDE_API_KEY") });

const GEMINI_SAFETY_OFF = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ─── Tool argument schemas + AI tool declarations ───────────────────────

// entryType is intentionally NOT enum-restricted — the prompt drives the
// vocabulary (`conception`, `contribution`, `concept_decision`, `pohc_answer`,
// `first_conceptual_leap`, `technical_spec`, `date_fact`, `metric`, `raw_idea`,
// `key_concept_decision`, …). Locking the enum at the API level rejects
// legitimate categories the prompt asks the model to use.
const recordEntryArgs = z.object({
  entryType: z.string().min(1),
  verbatimText: z.string().min(1),
  tags: z.array(z.string()).optional(),
});
const updateArticulationArgs = z.object({ newArticulationText: z.string().min(1) });
const addOpenQuestionArgs = z.object({ questionText: z.string().min(1) });
const closeOpenQuestionArgs = z.object({ questionId: z.string().min(1) });
const flagScopeDriftArgs = z.object({ note: z.string().min(1) });
// Polish-mode only. `find` is a short verbatim anchor from the CURRENT FINAL
// DRAFT ("" = replace the whole section); `replace` is the full corrected text.
const DRAFT_SECTION_KEYS = [
  "title",
  "background",
  "summary",
  "detailed_description",
  "ramifications_and_scope",
  "abstract",
  "claims",
] as const;
const proposeDraftEditsArgs = z.object({
  edits: z
    .array(
      z.object({
        section: z.enum(DRAFT_SECTION_KEYS),
        find: z.string().default(""),
        replace: z.string().min(1),
        rationale: z.string().default(""),
      }),
    )
    .min(1),
});

const TOOL_DECLARATIONS = [
  {
    name: "recordEntry",
    description:
      "Append a verbatim entry to the POHC/LEAP log. verbatimText must carry the user's exact wording, surface noise included — no paraphrase, no cleanup. entryType is a short categorical label the prompt drives (e.g. 'conception', 'contribution', 'concept_decision', 'key_concept_decision', 'pohc_answer', 'first_conceptual_leap', 'technical_spec', 'date_fact', 'metric', 'raw_idea').",
    parameters: {
      type: "object",
      properties: {
        entryType: { type: "string" },
        verbatimText: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["entryType", "verbatimText"],
    },
  },
  {
    name: "updateArticulation",
    description:
      "Write a new immutable version of the Current Articulation. Fires when the user's input materially shifts the invention's scope, terminology, or framing.",
    parameters: {
      type: "object",
      properties: { newArticulationText: { type: "string" } },
      required: ["newArticulationText"],
    },
  },
  {
    name: "addOpenQuestion",
    description: "Create an open question with a server-minted stable id. Fires when the agent identifies a gap or ambiguity it cannot answer without operator input.",
    parameters: {
      type: "object",
      properties: { questionText: { type: "string" } },
      required: ["questionText"],
    },
  },
  {
    name: "closeOpenQuestion",
    description: "Mark a previously-asked open question as answered.",
    parameters: {
      type: "object",
      properties: { questionId: { type: "string" } },
      required: ["questionId"],
    },
  },
  {
    name: "flagScopeDrift",
    description:
      "Flag that the user's latest message introduces scope beyond what was previously logged.",
    parameters: {
      type: "object",
      properties: { note: { type: "string" } },
      required: ["note"],
    },
  },
];

// Declared ONLY in polish mode (Showcase / phase 8). Findings travel through
// this tool instead of LOCATE/REPLACE paste blocks: the app renders each edit
// as a diff card with an Apply button, so the inventor never hand-copies text.
const PROPOSE_DRAFT_EDITS_DECLARATION = {
  name: "proposeDraftEdits",
  description:
    "Propose concrete fixes to the saved final draft. Each edit names a section, a `find` anchor (a SHORT verbatim snippet copied exactly from the CURRENT FINAL DRAFT text above — one sentence or less; or \"\" to replace the ENTIRE section), and `replace` (the full corrected text that overwrites the matched anchor). The server validates each anchor against the saved draft and returns a per-edit status; the inventor applies edits with one click in the UI. `rationale` carries the strategic framing (Vulnerability → Fix) shown on the edit card. Propose the COMPLETE set of fixes for the findings you have disclosed — do not hold edits back for later turns.",
  parameters: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section: {
              type: "string",
              enum: [...DRAFT_SECTION_KEYS],
              description: "Which draft section the edit targets ('claims' = the Key Concepts tab).",
            },
            find: {
              type: "string",
              description: "Short verbatim anchor from the current draft to replace, or \"\" to replace the whole section.",
            },
            replace: { type: "string", description: "The full replacement text." },
            rationale: { type: "string", description: "One-sentence Vulnerability → Fix framing shown to the inventor." },
          },
          required: ["section", "replace"],
        },
      },
    },
    required: ["edits"],
  },
};

// ─── Tool executors ─────────────────────────────────────────────────────────

type ToolCall = { name: string; args: any };
type ToolResult = { name: string; ok: boolean; result?: any; error?: string };

interface ToolContext {
  projectId: string;
  assistantMessageId: string;
  // Map of display id ("q_0017") → DB uuid. Lets the model reference questions
  // by their short display id while the DB keeps using uuids.
  questionIdMap: Map<string, string>;
  // Current leap target the routing state machine is working on. Used to
  // (a) auto-tag completion entries when the agent omits the tag and
  // (b) keep open-question accumulation under control.
  currentLeapTarget: string | null;
  // Polish mode only: the current draft's section texts, keyed by section key.
  // proposeDraftEdits validates each edit's `find` anchor against these so the
  // model gets immediate not_found/ambiguous feedback and can correct within
  // the same turn. Null outside polish mode (the tool isn't declared there).
  polishSections: Record<string, string> | null;
}

const COMPLETION_ENTRY_TYPES = new Set(["first_conceptual_leap", "pohc_answer"]);

async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "recordEntry": {
        const a = recordEntryArgs.parse(call.args);
        // Auto-tag completion entries with currentLeapTarget when the agent
        // omitted it. Without this, leapProgress never flips to "complete"
        // and the agent loops on Turn A, accumulating duplicate questions.
        let finalTags = a.tags ?? null;
        if (
          ctx.currentLeapTarget &&
          COMPLETION_ENTRY_TYPES.has(a.entryType) &&
          !(finalTags ?? []).includes(ctx.currentLeapTarget)
        ) {
          finalTags = [...(finalTags ?? []), ctx.currentLeapTarget];
        }
        const [row] = await db
          .insert(coachLogEntries)
          .values({
            projectId: ctx.projectId,
            entryType: a.entryType,
            verbatimText: a.verbatimText,
            sourceMessageId: ctx.assistantMessageId,
            capturedBy: "auto",
            tags: finalTags,
          })
          .returning();
        // If this entry completes the current leap target, auto-close any
        // open questions for the same project as "answered" (capturedBy=auto).
        // Without this, a missed closeOpenQuestion call leaves the question
        // orphaned, and the next turn's routing sees a contradiction:
        // currentLeapTarget has advanced but the prior leap's question is
        // still listed as open. The agent refuses to operate in that state.
        if (COMPLETION_ENTRY_TYPES.has(a.entryType)) {
          await db
            .update(coachOpenQuestions)
            .set({
              answeredAt: new Date(),
              answeredInMessageId: ctx.assistantMessageId,
            })
            .where(
              and(
                eq(coachOpenQuestions.projectId, ctx.projectId),
                sql`${coachOpenQuestions.answeredAt} IS NULL`,
                sql`${coachOpenQuestions.dismissedAt} IS NULL`,
              ),
            );
        }
        return { name: call.name, ok: true, result: { entryId: row.id, entryType: row.entryType, tags: finalTags } };
      }
      case "updateArticulation": {
        const a = updateArticulationArgs.parse(call.args);
        // Reference idea_snapshots via raw SQL (the table lives outside this module).
        const versionRes = await db.execute(sql`
          SELECT COALESCE(MAX(version), 0) AS v
          FROM inventor_geyser.idea_snapshots
          WHERE project_id = ${ctx.projectId}
        `);
        const nextVersion = Number((versionRes as any).rows?.[0]?.v ?? 0) + 1;
        const insertRes = await db.execute(sql`
          INSERT INTO inventor_geyser.idea_snapshots
            (project_id, version, snapshot_type, content)
          VALUES (${ctx.projectId}, ${nextVersion}, 'coach_articulation', ${a.newArticulationText})
          RETURNING id
        `);
        const snapshotId = (insertRes as any).rows?.[0]?.id;
        return { name: call.name, ok: true, result: { snapshotId, version: nextVersion } };
      }
      case "addOpenQuestion": {
        const a = addOpenQuestionArgs.parse(call.args);
        // Enforce one-at-a-time progression per SERVER_CONTRACT: any prior
        // unanswered open question for this project is superseded by the
        // new one. Mark them dismissed so they stop blocking routing and
        // stop bloating context with duplicate scaffolds.
        await db
          .update(coachOpenQuestions)
          .set({ dismissedAt: new Date() })
          .where(
            and(
              eq(coachOpenQuestions.projectId, ctx.projectId),
              sql`${coachOpenQuestions.answeredAt} IS NULL`,
              sql`${coachOpenQuestions.dismissedAt} IS NULL`,
            ),
          );
        const [row] = await db
          .insert(coachOpenQuestions)
          .values({
            projectId: ctx.projectId,
            question: a.questionText,
            askedInMessageId: ctx.assistantMessageId,
          })
          .returning();
        return { name: call.name, ok: true, result: { questionId: row.id } };
      }
      case "closeOpenQuestion": {
        const a = closeOpenQuestionArgs.parse(call.args);
        // The model may pass either a display id (e.g. "q_0017") or a raw uuid.
        // Translate display ids back to uuids before writing.
        const questionUuid = ctx.questionIdMap.get(a.questionId) ?? a.questionId;
        await db
          .update(coachOpenQuestions)
          .set({ answeredAt: new Date(), answeredInMessageId: ctx.assistantMessageId })
          .where(eq(coachOpenQuestions.id, questionUuid));
        return { name: call.name, ok: true, result: { questionId: a.questionId, resolvedUuid: questionUuid } };
      }
      case "flagScopeDrift": {
        const a = flagScopeDriftArgs.parse(call.args);
        return { name: call.name, ok: true, result: { note: a.note } };
      }
      case "proposeDraftEdits": {
        const a = proposeDraftEditsArgs.parse(call.args);
        if (!ctx.polishSections) {
          return { name: call.name, ok: false, error: "proposeDraftEdits is only available in polish mode (Showcase final draft)" };
        }
        // Validate every anchor against the saved draft and echo the full
        // edit set back. The model corrects not_found/ambiguous anchors in
        // its next tool turn; the client renders the validated edits as
        // apply-able diff cards straight from this result.
        const validated = a.edits.map((e) => {
          const sectionText = ctx.polishSections![e.section] ?? "";
          const { status, matchCount } = classifyDraftEdit(sectionText, e.find, e.replace);
          return { ...e, status, matchCount };
        });
        const notReady = validated.filter((e) => e.status === "not_found" || e.status === "ambiguous");
        return {
          name: call.name,
          ok: true,
          result: {
            edits: validated,
            readyCount: validated.length - notReady.length,
            problemCount: notReady.length,
            note:
              notReady.length === 0
                ? "All edits validated against the saved draft. The inventor can now apply each one with a click — tell them to review and apply the cards, then Save is automatic."
                : `${notReady.length} edit(s) have anchors that are not_found or ambiguous in the saved draft. Re-read the CURRENT FINAL DRAFT and re-propose ONLY those edits with corrected anchors (copy the anchor text exactly; extend it word by word until unique).`,
          },
        };
      }
      default:
        return { name: call.name, ok: false, error: `unknown tool: ${call.name}` };
    }
  } catch (err: any) {
    return { name: call.name, ok: false, error: err?.message ?? String(err) };
  }
}

// ─── Public entrypoint — called from the existing /qa-assistant route ──────

interface QAPayload {
  message: string;
  conversationHistory: Array<{ role: string; content: string }>;
  projectContext: {
    projectId?: string;
    projectTitle?: string;
    currentStage?: number;
    currentSubstage?: string | null;
    ideaSummary?: string;
    extractedIdeas?: any[];
    approvedIdeas?: any[];
    expandedConcepts?: any[];
    selectedConcepts?: any[];
    conceptAnalyses?: any[];
    selectedKeyConcepts?: any[];
    priorArtResults?: string;
    whiteSpaceAnalysis?: string;
    claimsGenerated?: number;
    provisionalDraftStatus?: string;
    hasProvisionalDraft?: boolean;
    specificKeyConcepts?: any[];
    broaderClaims?: any[];
    hasDiagrams?: boolean;
    diagramCount?: number;
    // Polish-mode marker + freshly-parsed final draft. Set by the route
    // handler when the inventor is on the Showcase (prompt-phase 8). When
    // true, the helper audits ONLY `provisionalDraft` and all other fields
    // above are intentionally absent.
    isPolishMode?: boolean;
    provisionalDraft?: any;
    // PHASE_8 substate gates. Server-derived in polish mode: status is
    // "complete" when `agent_data.diagrams.length > 0`, "in_progress" when
    // the showcase's `generate-diagrams` action is disabled (mutation in
    // flight per pageSnapshot.actions), else "not_started". Download is
    // available only when status is "complete" AND a draft exists.
    diagramGenerationStatus?: "not_started" | "in_progress" | "complete";
    draftDownloadAvailable?: boolean;
  };
  currentLocation: string;
  sessionId?: string;
  /**
   * Identity of the authenticated caller. Used for usage logging only —
   * persisted alongside each AI invocation so the admin /admin/usage
   * page can attribute the call. Optional so non-route callers (e.g. tests)
   * keep working.
   */
  userId?: string | null;
  userEmail?: string | null;
  requestId?: string | null;
  /**
   * Snapshot of what's currently rendered on the page the user is chatting from.
   * Built client-side via the page-snapshot registry (lib/page-snapshot.ts).
   * Either a "structured" snapshot from a page that registered itself, or a
   * "fallback" scrape of `<main>` text for pages that haven't been wired up yet.
   */
  pageSnapshot?: {
    pageName: string;
    // Authoritative prompt-phase (1–8) the page declares for itself, per
    // LAW_DECLARED_PHASE_AUTHORITATIVE. The route handler consumes this as the
    // effective stage; rendered into the snapshot block so the model also sees
    // its declared location.
    phase?: number;
    route: string;
    description?: string;
    items?: Array<{
      id: string;
      type: string;
      status?: string;
      content: any;
      editable?: boolean;
      editTarget?: string;
    }>;
    drafts?: Record<string, string>;
    focused?: string;
    actions?: Array<{
      id: string;
      label: string;
      kind?: "primary" | "secondary" | "destructive";
      enabled: boolean;
      reason?: string;
      navigatesTo?: string;
    }>;
    source?: "structured" | "fallback";
    capturedAt?: string;
  } | null;
}

export type QAEvent =
  | { type: "token"; data: { delta: string } }
  | { type: "tool-result"; data: ToolResult }
  | { type: "done"; data: { userMessageId: string | null; assistantMessageId: string | null; usedFallback: boolean } }
  | { type: "error"; data: { message: string; recoverable: boolean } };

// ─── Display-id and labeling helpers ────────────────────────────────────────

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * Build stable display ids ("entry_0001", "q_0001", ...) for an ordered set of
 * rows. Ids are assigned by chronological position across ALL rows (including
 * dismissed) so they remain stable when entries are dismissed or filtered out
 * later. Returns both directions of the mapping plus the filtered visible list.
 */
function buildDisplayIds<T extends { id: string; dismissedAt?: Date | null; answeredAt?: Date | null }>(
  allRows: T[],
  prefix: "entry" | "q",
): {
  uuidToDisplay: Map<string, string>;
  displayToUuid: Map<string, string>;
} {
  const uuidToDisplay = new Map<string, string>();
  const displayToUuid = new Map<string, string>();
  allRows.forEach((row, i) => {
    const display = `${prefix}_${pad4(i + 1)}`;
    uuidToDisplay.set(row.id, display);
    displayToUuid.set(display, row.id);
  });
  return { uuidToDisplay, displayToUuid };
}

/**
 * Pick a stable label prefix for arrays in the agent module state, so the
 * model can address items as "Concept 21", "Prior Art 4", etc.
 */
function arrayFieldPrefix(field: string): string {
  const f = field.toLowerCase();
  if (f.includes("priorart")) return "Prior Art";
  if (f === "selectedkeyconcepts") return "Key Concept Set";
  if (f.includes("keyconcept")) return "Key Concept";
  if (f.includes("broaderclaim")) return "Broader Key Concept";
  if (f.includes("advocate")) return "Advocate Point";
  if (f.includes("examiner")) return "Examiner Point";
  if (f.includes("nugget")) return "Nugget";
  if (f.includes("concept") || f.includes("idea")) return "Concept";
  return "Item";
}

/**
 * Render the per-page snapshot the client captured at send time. The model
 * uses this to answer "what's on my screen" without asking the user to
 * paste it in. Structured snapshots get item-by-item formatting with stable
 * ids; fallback scrapes are rendered as a single labeled blob and flagged
 * so the model knows reliability is limited.
 */
function renderPageSnapshot(snap: NonNullable<QAPayload["pageSnapshot"]>): string {
  const lines: string[] = [];
  lines.push(`Page: ${snap.pageName}${snap.route ? ` (${snap.route})` : ""}`);
  if (snap.source) lines.push(`Source: ${snap.source}`);
  if (snap.capturedAt) lines.push(`Captured: ${snap.capturedAt}`);
  if (snap.description) lines.push(`\n${snap.description}`);

  const items = (snap.items ?? []) as Array<any>;
  if (items.length > 0) {
    lines.push(`\n### Items on page (${items.length})`);
    for (const it of items) {
      // editable is opt-in. Anything not explicitly `true` is rendered as
      // false so the model never infers editability from absence.
      const editable = it.editable === true;
      const editTargetSuffix =
        editable && typeof it.editTarget === "string" && it.editTarget.length > 0
          ? `, editTarget=${it.editTarget}`
          : "";
      const head = `- [${it.id}] (${it.type}${it.status ? `, ${it.status}` : ""}, editable=${editable}${editTargetSuffix})`;
      let body: string;
      if (it.content == null) body = "(empty)";
      else if (typeof it.content === "string") body = it.content;
      else {
        try {
          body = JSON.stringify(it.content, null, 2);
        } catch {
          body = String(it.content);
        }
      }
      // Indent body lines so the bullet list stays readable.
      const indented = body.split("\n").map((l) => `    ${l}`).join("\n");
      lines.push(`${head}\n${indented}`);
    }
  } else {
    lines.push(`\n### Items on page\n(none captured)`);
  }

  // Actions: structured pages declare the buttons that exist; an empty array
  // means "no actions on this page", which is different from "unknown". We
  // render both states explicitly so the model can tell them apart.
  if (Array.isArray(snap.actions)) {
    if (snap.actions.length === 0) {
      lines.push(`\n### Actions on page\n(none — this page declares no actions the user can invoke)`);
    } else {
      lines.push(`\n### Actions on page (${snap.actions.length})`);
      for (const a of snap.actions) {
        const kind = a.kind ? `, ${a.kind}` : "";
        const enabled = `enabled=${a.enabled === true}`;
        const reason = a.enabled === false && a.reason ? `, reason="${a.reason}"` : "";
        const navTo = a.navigatesTo ? `, navigatesTo=${a.navigatesTo}` : "";
        lines.push(`- [${a.id}] "${a.label}" (${enabled}${kind}${reason}${navTo})`);
      }
    }
  } else {
    lines.push(`\n### Actions on page\n(unknown — page has not registered an actions list)`);
  }

  const draftEntries = Object.entries(snap.drafts ?? {});
  if (draftEntries.length > 0) {
    lines.push(`\n### Unsaved drafts`);
    for (const [k, v] of draftEntries) {
      lines.push(`- ${k}: ${v}`);
    }
  }

  if (snap.focused) lines.push(`\nFocused item: ${snap.focused}`);

  if (snap.source === "fallback") {
    lines.push(
      `\n(Note: this page has not registered a structured snapshot — the body above is a best-effort scrape. Items default to editable=false and the actions list is empty. Do not infer the existence of edit fields or buttons that are not explicitly listed here.)`,
    );
  }

  return lines.join("\n");
}

/**
 * Render the projectContext as a labeled markdown block so the model can
 * address every list item by its stable label rather than positional ordinals.
 */
/**
 * Compact one array element to a single readable line. The whitespace analysis
 * payload (conceptAnalyses) is enormous if JSON-stringified — every entry
 * carries per-patent rows, strategy blocks, risk levels, etc. — so we pull a
 * short label out and leave the rest behind. The agent doesn't need that
 * detail to reason about Concept N; it just needs the stable label + a hint
 * of what the concept is.
 */
function summarizeArrayItem(item: any): string {
  if (item == null) return "(empty)";
  if (typeof item === "string") return item;
  if (typeof item !== "object") return String(item);
  const labelKeys = ["conceptTitle", "title", "name", "summary", "label"];
  for (const k of labelKeys) {
    if (typeof item[k] === "string" && item[k].length > 0) return item[k];
  }
  if (typeof item.id === "string") return item.id;
  // Last resort: stringify but cap the length so one fat row can't blow up
  // the prompt all on its own.
  const s = JSON.stringify(item);
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
}

// Per-turn caps. Families can contain dozens of Projects + reference docs; the
// caches return them all (cheap), but the prompt only carries the top-N most
// recently updated and reports the rest via overflow counts so the model can
// hedge absence claims per FAMILY_AWARE_MODE.
const SIBLING_PROMPT_CAP = 10;
const CONTEXT_FILE_PROMPT_CAP = 25;
// Number of semantically-retrieved artifacts to ship on edit-text stages.
// Each artifact carries its full text + sibling metadata; 15 keeps a wide
// net while staying well under the per-turn token budget.
const RETRIEVAL_TOP_K = 15;

// Soft cap for a single artifact's preview text inside the prompt. Pathological
// content (e.g. a 30 KB blob pasted as a single key concept) gets truncated
// here — but never mid-sentence. We cut at the last sentence boundary that
// fits, falling back to the last word boundary, and append a continuation
// marker. Anything under the cap passes through unchanged.
const PROMPT_ARTIFACT_SOFT_CAP = 4000;

function truncateAtSentenceBoundary(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  const window = text.slice(0, max);
  // Prefer the last full sentence boundary (. ! ?) followed by whitespace or end.
  const sentenceMatch = window.match(/[\s\S]*[.!?](?=\s|$)/);
  if (sentenceMatch && sentenceMatch[0].length >= max * 0.4) {
    return sentenceMatch[0].trimEnd() + " […]";
  }
  // Fall back to the last word boundary so we never cut a word in half.
  const wordCut = window.lastIndexOf(" ");
  const cut = wordCut > max * 0.4 ? wordCut : max;
  return window.slice(0, cut).trimEnd() + " […]";
}

// Emits the `## FAMILY CONTEXT` section as a single structured JSON block.
// The schema matches the FAMILY CONTEXT FIELDS contract declared in
// qa-assistant.md so the agent can read fields by their declared names
// (`familyId`, `siblings[].siblingId`, `siblingsOverflow`, etc.) without
// inferring shape from markdown. Empty arrays and null fields are emitted
// verbatim so the activation gate ("siblings is non-empty") reads cleanly.
function renderFamilyContext(input: {
  familyId: string | null;
  familyContext: string | null;
  siblings: SiblingReference[];
  retrievedArtifacts: RetrievedArtifact[];
  contextFiles: Array<{ id: string; filename: string; summary: string | null; extractionStatus: "ready" | "failed" | "pending" }>;
  projectFiledStatus: {
    inventorNames: string[] | null;
    filedDate: string | null;
    status: string | null;
    applicationNumber: string | null;
    notes: string | null;
  } | null;
}): string {
  const shownFiles = (input.contextFiles ?? []).slice(0, CONTEXT_FILE_PROMPT_CAP);
  const referenceFilesOverflow = Math.max(0, (input.contextFiles ?? []).length - shownFiles.length);

  const cap = (s: string | null | undefined): string | null =>
    s ? truncateAtSentenceBoundary(s, PROMPT_ARTIFACT_SOFT_CAP) : null;

  // RETRIEVAL MODE — when semantic retrieval ran (edit-text stages), group
  // retrieved artifacts by their parent sibling so the JSON shape stays
  // consistent with the FAMILY CONTEXT contract: an array of siblings, each
  // carrying its content. siblings_overflow is 0 here because retrieval
  // already scanned the entire family — there's no "more not shown" tier.
  //
  // RECENCY MODE — when retrieval did not run (selection-only stages or
  // empty family), fall back to the recency-based top-N siblings as before.
  const useRetrieval = (input.retrievedArtifacts ?? []).length > 0;

  let siblingsOut: any[];
  let siblingsOverflow: number;
  let retrievalMode: "semantic" | "recency";

  if (useRetrieval) {
    retrievalMode = "semantic";
    // Group by sibling, preserving the order of first appearance (which is
    // already similarity-sorted from the SQL ORDER BY).
    const grouped = new Map<string, {
      siblingId: string;
      title: string;
      stage: number | "filed";
      ideaSummary: string | null;
      extractedIdeaTitles: string[];
      keyConceptPreviews: string[];
      topSimilarity: number;
    }>();
    for (const r of input.retrievedArtifacts) {
      let bucket = grouped.get(r.siblingId);
      if (!bucket) {
        bucket = {
          siblingId: r.siblingId,
          title: r.siblingTitle,
          stage: r.siblingCompleted ? "filed" : r.siblingStage,
          ideaSummary: null,
          extractedIdeaTitles: [],
          keyConceptPreviews: [],
          topSimilarity: r.similarity,
        };
        grouped.set(r.siblingId, bucket);
      }
      bucket.topSimilarity = Math.max(bucket.topSimilarity, r.similarity);
      const text = cap(r.text) ?? "";
      if (r.artifactKind === "idea_summary") {
        if (!bucket.ideaSummary) bucket.ideaSummary = text;
      } else if (r.artifactKind === "extracted_idea") {
        bucket.extractedIdeaTitles.push(text);
      } else if (r.artifactKind === "key_concept") {
        bucket.keyConceptPreviews.push(text);
      }
    }
    siblingsOut = Array.from(grouped.values()).map(({ topSimilarity, ...rest }) => rest);
    siblingsOverflow = 0;
  } else {
    retrievalMode = "recency";
    const shownSiblings = (input.siblings ?? []).slice(0, SIBLING_PROMPT_CAP);
    siblingsOverflow = Math.max(0, (input.siblings ?? []).length - shownSiblings.length);
    siblingsOut = shownSiblings.map((s) => ({
      siblingId: s.id,
      title: s.title,
      stage: s.completed ? "filed" : s.currentStage,
      ideaSummary: cap(s.artifacts.ideaSummary?.preview ?? null),
      extractedIdeaTitles: s.artifacts.extractedIdeas.map((e) => e.title),
      keyConceptPreviews: s.artifacts.keyConcepts.map((k) => cap(k.preview) ?? ""),
    }));
  }

  const payload = {
    familyId: input.familyId,
    // Inventor-authored background for the whole family. Standing context that
    // applies to every sibling; weigh it alongside the per-sibling content.
    familyContext: input.familyContext,
    retrievalMode,
    siblings: siblingsOut,
    siblingsOverflow,
    referenceFiles: shownFiles.map((f) => ({
      fileId: f.id,
      filename: f.filename,
      summary: cap(f.summary),
      extractionStatus: f.extractionStatus,
    })),
    referenceFilesOverflow,
    projectFiledStatus: input.projectFiledStatus,
  };

  return "```json\n" + JSON.stringify(payload, null, 2) + "\n```";
}

function renderProjectContext(pc: QAPayload["projectContext"]): string {
  const lines: string[] = [];
  for (const [field, value] of Object.entries(pc)) {
    if (value === null || value === undefined) continue;
    if (field === "projectId" || field === "projectTitle" || field === "currentStage") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const prefix = arrayFieldPrefix(field);
      lines.push(`\n**${field}** (${value.length} items):`);
      value.forEach((item, i) => {
        lines.push(`- ${prefix} ${i + 1}: ${summarizeArrayItem(item)}`);
      });
    } else if (typeof value === "object") {
      lines.push(`\n**${field}:** ${JSON.stringify(value)}`);
    } else if (typeof value === "boolean" || typeof value === "number") {
      lines.push(`\n**${field}:** ${value}`);
    } else if (typeof value === "string" && value.length > 0) {
      lines.push(`\n**${field}:** ${value}`);
    }
  }
  return lines.length ? lines.join("\n").trim() : "(no agent module state available)";
}

// Read-helpers used by the route's GET endpoints — keep DB access inside module 0.
export async function getQAMessages(projectId: string, limit = 50) {
  return await db
    .select()
    .from(coachMessages)
    .where(eq(coachMessages.projectId, projectId))
    .orderBy(desc(coachMessages.createdAt))
    .limit(limit)
    .then((rows) => rows.reverse());
}

// Plain-English label for a (stage, substage) pair, matching what users see
// in the sidebar / page headers. Used to enrich log entries with a "captured
// during: Key Concepts Selection" trail so users can place each entry in
// the workflow without learning the internal substage codes.
function friendlyStageLabel(stage: number | null | undefined, substage: string | null | undefined): string | null {
  if (stage == null) return null;
  const s = typeof substage === "string" ? substage : "";
  if (stage === 1) {
    if (s === "1b" || s.includes("inspect")) return "Inspect & Refine";
    return "Idea Intake";
  }
  if (stage === 2) {
    if (s === "2a") return "Concept Expansion";
    if (s === "2b" || s === "2c") return "Patentable Ideas";
    return "Concept Refinement";
  }
  if (stage === 3) return "Prior Art Research";
  if (stage === 4) {
    if (s === "4a") return "White Space Strategy";
    if (s === "4b") return "Key Concepts Selection";
    if (s.includes("conception-intro")) return "Inventorship Validation — Intro";
    if (s.includes("conception")) return "Inventorship Validation";
    if (s === "4c") return "Provisional Draft Review";
    return "White Space & Key Concepts";
  }
  if (stage === 5) {
    if (s.includes("practitioner")) return "Find a Practitioner";
    return "The Showcase";
  }
  // Stage 6 = the phase-aligned number the AI Helper sees on the Proof of Human
  // Conception page (the app's `/agent/4-conception` substage, remapped in the
  // qa-assistant route). Entries captured there are stamped stage 6, so label
  // them the same as the stage-4 conception substage above.
  if (stage === 6) return "Inventorship Validation";
  return null;
}

// Map a human_input tag to a log entryType the bucketing UI understands.
// The mapping uses the Pannu factor semantics: conception/quality/known-
// concepts tags become inventorship-defending entries (pohc_answer or
// conception/contribution). Anything else falls into a generic
// "human_input" bucket that still shows up in the total count.
function entryTypeForHumanInputTags(tags: string[]): string {
  if (!Array.isArray(tags) || tags.length === 0) return "human_input";
  const has = (t: string) => tags.includes(t);
  if (has("conception_timeline") || has("conception_mechanism") || has("problem_narrative")) {
    return "conception";
  }
  if (has("technical_advance") || has("vs_obvious_combo") || has("implementation_detail")) {
    return "contribution";
  }
  if (has("prior_art_awareness") || has("differentiation") || has("whitespace_rationale")) {
    return "first_conceptual_leap";
  }
  return "human_input";
}

export async function getQALog(projectId: string, includeDismissed = false) {
  // Load all rows (including dismissed) so display ids are stable across calls.
  const all = await db
    .select()
    .from(coachLogEntries)
    .where(eq(coachLogEntries.projectId, projectId))
    .orderBy(coachLogEntries.capturedAt);

  // Join each entry with its source assistant message to recover the page
  // the user was on when it was captured. We do this in two batched lookups
  // instead of per-row joins to keep the read cheap.
  const messageIds = Array.from(
    new Set(all.map((r) => r.sourceMessageId).filter((id): id is string => !!id)),
  );
  const messageLocations = new Map<string, { stage: number | null; substage: string | null; label: string | null }>();
  if (messageIds.length > 0) {
    try {
      const msgRows = await db
        .select()
        .from(coachMessages)
        .where(and(eq(coachMessages.projectId, projectId), inArray(coachMessages.id, messageIds)));
      for (const m of msgRows) {
        const cl = (m.currentLocation ?? {}) as any;
        messageLocations.set(m.id, {
          stage: typeof cl.stage === "number" ? cl.stage : null,
          substage: typeof cl.substage === "string" ? cl.substage : null,
          label: typeof cl.label === "string" ? cl.label : null,
        });
      }
    } catch (joinErr: any) {
      // Location enrichment is best-effort — never fail the log fetch just
      // because the join had trouble. Entries fall through with null
      // capturedAtTrail and the modal shows the "earlier session" fallback.
      console.warn("[qa-assistant] log location join failed:", joinErr?.message);
    }
  }

  const withDisplay = all.map((row, i) => {
    const loc = row.sourceMessageId ? messageLocations.get(row.sourceMessageId) : undefined;
    const stageLabel = friendlyStageLabel(loc?.stage ?? null, loc?.substage ?? null);
    // Concept-scoped tags (e.g. "Concept 4", "Key Concept Set 2") become
    // part of the trail when present.
    const conceptTagList = Array.isArray(row.tags)
      ? row.tags.filter((t): t is string => typeof t === "string" && /^(Concept|Key Concept Set)\s+\d+/.test(t))
      : [];
    const capturedAtTrail = [stageLabel, ...conceptTagList].filter(Boolean).join(" · ");
    return {
      ...row,
      displayId: `entry_${pad4(i + 1)}`,
      capturedAtStage: loc?.stage ?? null,
      capturedAtSubstage: loc?.substage ?? null,
      capturedAtLabel: stageLabel,
      capturedAtTrail: capturedAtTrail || null,
    };
  });

  // Merge in the human-input ledger. The AI Helper only sees what it
  // recordEntry'd into coachLogEntries — but every textarea answer the user
  // types across the app lands in human_inputs (the "Invention Record"
  // source). Without merging, "What I know" comes up empty even though the
  // Invention Record is full. We synthesize a coachLog-shaped row per
  // human_input so the modal's counts reflect everything the platform has
  // captured.
  let mergedHuman: any[] = [];
  try {
    const { listHumanInputs } = await import("../human-inputs/ledger");
    const { friendlySourceLabel } = await import("../human-inputs/tags");
    const inputs = await listHumanInputs({ projectId });
    mergedHuman = inputs.map((row: any, i: number) => {
      const tags: string[] = Array.isArray(row.tags) ? row.tags : [];
      const sourceLabel = friendlySourceLabel(String(row.source || ""));
      return {
        id: `human_${row.id}`,
        projectId,
        entryType: entryTypeForHumanInputTags(tags),
        verbatimText: row.answerText,
        tags: [...tags, ...(row.conceptId ? [String(row.conceptId)] : [])],
        sourceMessageId: null,
        capturedAt: row.updatedAt || row.createdAt || new Date(),
        dismissedAt: null,
        displayId: `human_${pad4(i + 1)}`,
        capturedAtStage: null,
        capturedAtSubstage: null,
        capturedAtLabel: sourceLabel,
        capturedAtTrail: sourceLabel || null,
        _source: "human_inputs" as const,
      };
    });
  } catch (mergeErr: any) {
    console.warn("[qa-assistant] human_inputs merge failed:", mergeErr?.message);
  }

  const base = includeDismissed
    ? withDisplay
    : withDisplay.filter((row) => row.dismissedAt === null);

  // Sort the combined list chronologically so the modal shows a coherent
  // timeline regardless of which store each entry came from.
  const combined = [...base, ...mergedHuman].sort((a: any, b: any) => {
    const ta = new Date(a.capturedAt || 0).getTime();
    const tb = new Date(b.capturedAt || 0).getTime();
    return ta - tb;
  });
  return combined;
}

export async function getQAOpenQuestions(projectId: string, includeAnswered = false) {
  const all = await db
    .select()
    .from(coachOpenQuestions)
    .where(eq(coachOpenQuestions.projectId, projectId))
    .orderBy(coachOpenQuestions.createdAt);
  const withDisplay = all.map((row, i) => ({ ...row, displayId: `q_${pad4(i + 1)}` }));
  return includeAnswered
    ? withDisplay
    : withDisplay.filter((row) => row.answeredAt === null && row.dismissedAt === null);
}

export async function addManualLogEntry(
  projectId: string,
  entryType: "pohc" | "leap" | "both",
  verbatimText: string,
  tags?: string[],
) {
  const [row] = await db
    .insert(coachLogEntries)
    .values({ projectId, entryType, verbatimText, capturedBy: "manual", tags: tags ?? null })
    .returning();
  return row;
}

export async function patchLogEntry(
  projectId: string,
  entryId: string,
  patch: { editedText?: string; entryType?: "pohc" | "leap" | "both"; dismissed?: boolean; tags?: string[] },
) {
  const update: any = {};
  if (typeof patch.editedText === "string") {
    update.editedText = patch.editedText;
    update.editedAt = new Date();
  }
  if (patch.entryType) update.entryType = patch.entryType;
  if (typeof patch.dismissed === "boolean") update.dismissedAt = patch.dismissed ? new Date() : null;
  if (Array.isArray(patch.tags)) update.tags = patch.tags;
  const [row] = await db
    .update(coachLogEntries)
    .set(update)
    .where(and(eq(coachLogEntries.id, entryId), eq(coachLogEntries.projectId, projectId)))
    .returning();
  return row ?? null;
}

export async function patchOpenQuestion(
  projectId: string,
  questionId: string,
  patch: { dismissed?: boolean },
) {
  if (typeof patch.dismissed !== "boolean") return null;
  const [row] = await db
    .update(coachOpenQuestions)
    .set({ dismissedAt: patch.dismissed ? new Date() : null })
    .where(and(eq(coachOpenQuestions.id, questionId), eq(coachOpenQuestions.projectId, projectId)))
    .returning();
  return row ?? null;
}

/**
 * Run the Q&A Assistant. Same shape the route handler has always used.
 *
 * Behaviour:
 *   1. Loads project-scoped state (POHC/Leap log, open questions, articulation,
 *      coach_messages history) from the inventor_geyser tables.
 *   2. Builds a context block summarising that state plus the route-supplied
 *      projectContext.
 *   3. Calls the AI with the system prompt (qa-assistant.md) and the
 *      tool declarations. Streams internally; collects the full response.
 *   4. Executes any tool calls server-side (writes to the local tables).
 *   5. Persists user + assistant messages to coach_messages.
 *   6. Returns the prose response as a string.
 *
 * If projectContext.projectId is not provided, persistence is skipped and the
 * call becomes a stateless Q&A turn (the route can opt in to persistence by
 * adding `projectId: req.params.id` to projectContext).
 */
/**
 * Detect inventor-initiated recovery intent in their message text. If the
 * user is asking to reset / restart / skip / redo, we mutate state DIRECTLY
 * before the agent runs — so the agent sees post-action state and can't
 * refuse, dead-end, or send them to "support."
 *
 * Returns the kind of recovery applied so the agent's reply can be primed
 * with a positive forward directive.
 */
async function applyRecoveryIntent(
  projectId: string,
  message: string,
): Promise<{ kind: "reset" | "skip" | "restart" | null; targetIndex: number | null }> {
  const m = message.toLowerCase();

  // Match "concept N" / "concept #N" — captures the number for targeted resets.
  const conceptMatch = m.match(/concept\s*#?\s*(\d+)/);
  const targetIndex = conceptMatch ? parseInt(conceptMatch[1], 10) : null;

  // RESTART / START OVER — the user wants to wipe stage progress and begin again.
  const restartPhrases = [
    "start all over",
    "start over",
    "restart",
    "restart from",
    "begin again",
    "from scratch",
    "fresh start",
    "wipe progress",
    "clear progress",
    "reset progress",
    "resync",
    "re-sync",
    "re sync",
  ];
  if (restartPhrases.some((p) => m.includes(p))) {
    // Dismiss every unanswered open question. Don't touch the pohcLog —
    // entries stay for legal continuity, but the agent's routing will
    // recompute fresh on the next turn.
    await db
      .update(coachOpenQuestions)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(coachOpenQuestions.projectId, projectId),
          sql`${coachOpenQuestions.answeredAt} IS NULL`,
          sql`${coachOpenQuestions.dismissedAt} IS NULL`,
        ),
      );
    return { kind: "restart", targetIndex };
  }

  // RESET CONCEPT N — undo the completion for that concept so the agent can
  // walk the inventor through it again. Dismiss matching log entries (don't
  // delete — keep the record) and any open question that mentions the target.
  const resetPhrases = ["reset", "redo", "go back to", "back to"];
  if (targetIndex !== null && resetPhrases.some((p) => m.includes(p))) {
    const targetTag = `Concept ${targetIndex}`;
    await db
      .update(coachLogEntries)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(coachLogEntries.projectId, projectId),
          sql`${coachLogEntries.entryType} IN ('first_conceptual_leap', 'pohc_answer')`,
          sql`${targetTag} = ANY(${coachLogEntries.tags})`,
          sql`${coachLogEntries.dismissedAt} IS NULL`,
        ),
      );
    // Also dismiss any open question — the agent will reopen on Turn A.
    await db
      .update(coachOpenQuestions)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(coachOpenQuestions.projectId, projectId),
          sql`${coachOpenQuestions.answeredAt} IS NULL`,
          sql`${coachOpenQuestions.dismissedAt} IS NULL`,
        ),
      );
    return { kind: "reset", targetIndex };
  }

  // SKIP — the inventor wants to bypass the current leap target. Record a
  // skip decision (so the legal log shows the inventor declined verbatim
  // capture) and dismiss the open question. Routing's next pass will pick
  // the next non-complete target.
  const skipPhrases = [
    "skip this",
    "skip it",
    "skip for now",
    "move on",
    "next one",
    "next concept",
    "i can't",
    "i cannot",
    "i don't know",
    "i dont know",
  ];
  if (skipPhrases.some((p) => m.includes(p))) {
    // Find the currently-open question to identify what's being skipped.
    const [openQ] = await db
      .select()
      .from(coachOpenQuestions)
      .where(
        and(
          eq(coachOpenQuestions.projectId, projectId),
          sql`${coachOpenQuestions.answeredAt} IS NULL`,
          sql`${coachOpenQuestions.dismissedAt} IS NULL`,
        ),
      )
      .limit(1);

    if (openQ) {
      await db.insert(coachLogEntries).values({
        projectId,
        entryType: "concept_decision",
        verbatimText: "Inventor opted to move on without capturing a verbatim leap.",
        capturedBy: "auto",
        tags: ["skipped"],
      });
      await db
        .update(coachOpenQuestions)
        .set({ dismissedAt: new Date() })
        .where(eq(coachOpenQuestions.id, openQ.id));
      return { kind: "skip", targetIndex };
    }
  }

  return { kind: null, targetIndex: null };
}

export async function* runQAAssistant(payload: QAPayload): AsyncGenerator<QAEvent> {
  const projectId = payload.projectContext?.projectId;
  const persistent = typeof projectId === "string" && projectId.length > 0;
  const MAX_TOOL_TURNS = 3;

  // INTENT PREEMPTION — before loading state, look for "reset / restart /
  // skip" phrases and apply the corresponding state change directly. This
  // makes the agent see post-action state and removes its opportunity to
  // refuse with "contact support."
  let recoveryApplied: { kind: "reset" | "skip" | "restart" | null; targetIndex: number | null } = {
    kind: null,
    targetIndex: null,
  };
  if (persistent) {
    recoveryApplied = await applyRecoveryIntent(projectId!, payload.message);
  }

  // ─── 1. Load module-owned state ─────────────────────────────────────────────
  let visibleLog: Array<any> = [];
  let visibleOpenQs: Array<any> = [];
  let latestArticulation: { version: number; content: string } | null = null;
  let recentChrono: Array<{ role: string; content: string; currentLocation: any }> = [];
  let previousStage: string | number | null = null;

  // Display-id maps for tool resolution.
  let questionDisplayToUuid = new Map<string, string>();

  if (persistent) {
    // Load ALL log rows (including dismissed) to keep display ids stable.
    const allLogRows = await db
      .select()
      .from(coachLogEntries)
      .where(eq(coachLogEntries.projectId, projectId!))
      .orderBy(coachLogEntries.capturedAt);
    const logIds = buildDisplayIds(allLogRows, "entry");
    visibleLog = allLogRows
      .filter((r) => r.dismissedAt === null)
      .map((r) => ({ ...r, displayId: logIds.uuidToDisplay.get(r.id)! }));

    const allOpenQRows = await db
      .select()
      .from(coachOpenQuestions)
      .where(eq(coachOpenQuestions.projectId, projectId!))
      .orderBy(coachOpenQuestions.createdAt);
    const qIds = buildDisplayIds(allOpenQRows, "q");
    questionDisplayToUuid = qIds.displayToUuid;
    visibleOpenQs = allOpenQRows
      .filter((r) => r.answeredAt === null && r.dismissedAt === null)
      .map((r) => ({ ...r, displayId: qIds.uuidToDisplay.get(r.id)! }));

    const articulationRes = await db.execute(sql`
      SELECT version, content
      FROM inventor_geyser.idea_snapshots
      WHERE project_id = ${projectId!} AND snapshot_type = 'coach_articulation'
      ORDER BY version DESC
      LIMIT 1
    `);
    const aRow = (articulationRes as any).rows?.[0];
    if (aRow) latestArticulation = { version: Number(aRow.version), content: String(aRow.content) };

    const recent = await db
      .select()
      .from(coachMessages)
      .where(eq(coachMessages.projectId, projectId!))
      .orderBy(desc(coachMessages.createdAt))
      .limit(CONFIG.historyCap);
    recentChrono = [...recent].reverse().map((m) => ({
      role: m.role,
      content: m.content,
      currentLocation: m.currentLocation,
    }));

    // previousStage = the stage stamped on the most recent prior message that
    // carries a currentLocation. Null on the first turn of the session.
    for (let i = recentChrono.length - 1; i >= 0; i--) {
      const cl = recentChrono[i].currentLocation as any;
      if (cl && (cl.stage !== undefined && cl.stage !== null)) {
        previousStage = cl.stage;
        break;
      }
    }
    // Clamp previousStage to never trail behind where the user actually is.
    // Forward navigation without "proceed" used to leave previousStage stuck
    // at the old stage, which the prompt treated as a state-drift signal and
    // refused to proceed. Treating prior turns as "already caught up" lets
    // the helper just continue helping on the new page.
    const pcStageNow = (payload.projectContext as any)?.currentStage;
    if (
      typeof pcStageNow === "number" &&
      typeof previousStage === "number" &&
      previousStage < pcStageNow
    ) {
      previousStage = pcStageNow;
    }
  } else {
    // Stateless fallback: use the conversationHistory the client sent.
    recentChrono = (payload.conversationHistory ?? []).map((m) => ({
      role: m.role,
      content: m.content,
      currentLocation: null,
    }));
  }

  // ─── 2. Build the runtime context block ────────────────────────────────────
  const pc = payload.projectContext ?? {};

  // Polish mode (set by the route handler when effectiveStage === 8 / Showcase).
  // The audit must operate on the saved final draft ONLY — no raw idea, no
  // earlier-stage concepts, no chat history that could contain candidate
  // phrases. Skip the family/sibling/retrieval lookups entirely in this mode.
  const isPolishMode = !!(pc as any).isPolishMode;

  // Pull the read-only sibling digests (idea summary preview, extracted-idea
  // titles, key-concept previews) from the family-artifact cache. One small
  // indexed SQL query; zero AI calls. Empty array when the project has no
  // family. Defensive: any failure degrades to [] so a families issue never
  // breaks the QA assistant turn.
  let siblings: SiblingReference[] = [];
  // Populated only on edit-text stages (1, 2, 4, 6, 7, 8). When non-empty,
  // the FAMILY CONTEXT block ships these in `siblings[].keyConceptPreviews`
  // etc. INSTEAD OF the recency-based summaries — so the helper sees the
  // most semantically relevant content across the entire family.
  let retrievedArtifacts: RetrievedArtifact[] = [];
  let contextFiles: Array<{ id: string; filename: string; summary: string | null; extractionStatus: "ready" | "failed" | "pending" }> = [];
  let projectFamilyId: string | null = null;
  // Free-text family background the inventor set on the family. Injected into
  // FAMILY CONTEXT so every sibling is drafted with it in view.
  let familyContext: string | null = null;
  let projectFiledStatus: {
    inventorNames: string[] | null;
    filedDate: string | null;
    status: string | null;
    applicationNumber: string | null;
    notes: string | null;
  } | null = null;
  if (persistent && !isPolishMode) {
    try {
      siblings = await getSiblingsReference(projectId!);
    } catch (err) {
      console.error("[qa-assistant] getSiblingsReference failed", err);
      siblings = [];
    }
    // Resolve the family of the current project (if any) by reading the
    // project row directly — the client payload's projectContext doesn't
    // always include familyId. Then pull cached context-file summaries.
    // Also pull patent metadata for the current project here in the same
    // query so the prompt can carry filed date, status, jurisdiction, etc.
    try {
      const projRow = await db.execute(sql`
        SELECT p.family_id,
               p.inventor_names, p.filed_date, p.status, p.application_number, p.notes,
               f.context AS family_context
          FROM inventor_geyser.projects p
          LEFT JOIN inventor_geyser.project_families f ON f.id = p.family_id
         WHERE p.id = ${projectId} LIMIT 1
      `);
      const row: any = (projRow as any).rows?.[0] ?? null;
      projectFamilyId = (row?.family_id ?? null) as string | null;
      {
        const ctx = typeof row?.family_context === "string" ? row.family_context.trim() : "";
        familyContext = ctx.length > 0 ? ctx : null;
      }
      if (projectFamilyId) {
        contextFiles = await listFamilyContextFilesForPrompt(projectFamilyId);
      }
      if (row) {
        projectFiledStatus = {
          inventorNames: row.inventor_names ?? null,
          filedDate: row.filed_date ?? null,
          status: row.status ?? null,
          applicationNumber: row.application_number ?? null,
          notes: row.notes ?? null,
        };
      }
    } catch (err) {
      console.error("[qa-assistant] family/context-files lookup failed", err);
      contextFiles = [];
    }

    // Semantic retrieval — fires only on edit-text stages so we don't burn
    // an embed call when the helper is in a pure-selection or pure-teaching
    // turn. Stage 3 and 5 are selection-only; stages 1, 2, 4, 6, 7, 8 all
    // can produce text intended to edit the current Project, which is when
    // family-wide semantic context is most useful.
    if (projectFamilyId) {
      const stage = (pc as any)?.currentStage;
      const isEditTextStage = stage === 1 || stage === 2 || stage === 4 || stage === 6 || stage === 7 || stage === 8;
      if (isEditTextStage) {
        try {
          retrievedArtifacts = await getRelevantFamilyArtifacts(projectId!, payload.message ?? "", RETRIEVAL_TOP_K);
        } catch (err) {
          console.error("[qa-assistant] getRelevantFamilyArtifacts failed", err);
          retrievedArtifacts = [];
        }
      }
    }
  }

  // Section texts of the saved final draft, keyed by section key. Single
  // extraction shared by the rendered polish block AND proposeDraftEdits
  // validation, so the model's view and the validator always agree.
  function polishSectionsFromDraft(draft: any): Record<string, string> | null {
    if (!draft || typeof draft !== "object") return null;
    const claimsValue = Array.isArray(draft.claims)
      ? draft.claims.join("\n\n")
      : (draft.claims ?? draft.keyConcepts ?? "");
    return {
      title: String(draft.title ?? ""),
      background: String(draft.background ?? ""),
      summary: String(draft.summary ?? ""),
      detailed_description: String(draft.detailed_description ?? ""),
      ramifications_and_scope: String(draft.ramifications_and_scope ?? ""),
      abstract: String(draft.abstract ?? ""),
      claims: typeof claimsValue === "string" ? claimsValue : String(claimsValue ?? ""),
    };
  }

  // Renders the saved final draft as a flat, labeled block for polish-mode
  // audits. The 7 sections come from parseProvisionalDraft() in routes.ts —
  // same shape the Showcase page renders, same shape Save writes to. Each
  // heading carries the section key the proposeDraftEdits tool expects.
  function renderPolishDraft(draft: any): string {
    const secs = polishSectionsFromDraft(draft);
    if (!secs) {
      return "(no final draft is saved yet — Module 4 hasn't produced one and no tab edits have been saved)";
    }
    const sections: Array<[string, string, string]> = [
      ["TITLE", "title", secs.title],
      ["BACKGROUND OF THE INVENTION", "background", secs.background],
      ["SUMMARY OF THE INVENTION", "summary", secs.summary],
      ["DETAILED DESCRIPTION", "detailed_description", secs.detailed_description],
      ["RAMIFICATIONS AND SCOPE", "ramifications_and_scope", secs.ramifications_and_scope],
      ["ABSTRACT", "abstract", secs.abstract],
      ["KEY CONCEPTS", "claims", secs.claims],
    ];
    return sections
      .map(([label, key, body]) => `### ${label} (section key: ${key})\n${(body || "").toString().trim() || "(empty)"}`)
      .join("\n\n");
  }

  // Build the full user message from fresh state. Used at start AND between
  // tool turns so the agent always reads the current TURN ROUTER STATE — not
  // the stale block from before the tool calls executed.
  function buildUserMessage(
    logRows: Array<any>,
    openQRows: Array<any>,
    routingNow: RoutingFields,
  ): string {
    // Polish-mode short-circuit. Emit ONLY meta + substate gates + the
    // freshly-read final draft + the new user message. No log, articulation,
    // open questions, routing state, family context, or agent-module dump —
    // any of those can carry candidate phrases the model would misattribute
    // to the draft.
    if (isPolishMode) {
      const polishParts: string[] = [];
      const polishMeta: string[] = [];
      if (pc.projectTitle) polishMeta.push(`Title: ${pc.projectTitle}`);
      polishMeta.push(`currentLocation.stage: ${pc.currentStage ?? 8}`);
      if (pc.currentSubstage) polishMeta.push(`currentLocation.substage: ${pc.currentSubstage}`);
      if (payload.currentLocation) polishMeta.push(`Location label: ${payload.currentLocation}`);
      polishMeta.push(`mode: POLISH (audit-only on the final draft text below)`);
      // Substate gates drive the closing forward directive per PHASE_8
      // SUB-STATE A/B/C. Always emitted so the prompt's routing can be
      // deterministic instead of guessing from the draft's shape.
      const hpd = !!(pc as any).hasProvisionalDraft;
      const dgs = (pc as any).diagramGenerationStatus;
      const dda = (pc as any).draftDownloadAvailable;
      polishMeta.push(`hasProvisionalDraft: ${hpd ? "true" : "false"}`);
      polishMeta.push(`diagramGenerationStatus: ${dgs ?? "unknown"}`);
      polishMeta.push(`draftDownloadAvailable: ${dda === true ? "true" : "false"}`);
      polishParts.push(`## PROJECT META\n${polishMeta.join("\n")}`);
      polishParts.push(
        `## CURRENT FINAL DRAFT — refreshed this turn (authoritative — audit only this text)\n${renderPolishDraft((pc as any).provisionalDraft)}`,
      );
      if (payload.pageSnapshot) {
        polishParts.push(`## CURRENT PAGE\n${renderPageSnapshot(payload.pageSnapshot)}`);
      }
      return `${polishParts.join("\n\n")}\n\n## NEW USER MESSAGE\n${payload.message}`;
    }

    const s: string[] = [];
    const meta: string[] = [];
    if (pc.projectTitle) meta.push(`Title: ${pc.projectTitle}`);
    if (pc.currentStage !== undefined && pc.currentStage !== null) {
      meta.push(`currentLocation.stage: ${pc.currentStage}`);
    }
    if (pc.currentSubstage) {
      meta.push(`currentLocation.substage: ${pc.currentSubstage}`);
    }
    if (payload.currentLocation) meta.push(`Location label: ${payload.currentLocation}`);
    meta.push(`previousStage: ${previousStage === null ? "null" : String(previousStage)}`);
    s.push(`## PROJECT META\n${meta.join("\n")}`);

    s.push(
      `## POHC + LEAP LOG (${logRows.length} entries)\n${
        logRows.length === 0
          ? "(empty)"
          : logRows
              .map(
                (e) =>
                  `- ${e.displayId ?? e.id} [${(e.entryType || "").toUpperCase()}] (${
                    e.capturedAt?.toISOString?.() ?? ""
                  }): ${e.editedText ?? e.verbatimText}`,
              )
              .join("\n")
      }`,
    );
    s.push(
      `## CURRENT ARTICULATION (v${latestArticulation?.version ?? 0})\n${
        latestArticulation?.content ?? "(none yet)"
      }`,
    );
    s.push(
      `## OPEN QUESTIONS (${openQRows.length})\n${
        openQRows.length === 0
          ? "(none)"
          : openQRows.map((q) => `- ${q.displayId ?? q.id}: ${q.question}`).join("\n")
      }`,
    );
    s.push(`## TURN ROUTER STATE\n${renderRouting(routingNow)}`);
    s.push(`## FAMILY CONTEXT\n${renderFamilyContext({
      familyId: projectFamilyId,
      familyContext,
      siblings,
      retrievedArtifacts,
      contextFiles,
      projectFiledStatus,
    })}`);
    s.push(`## AGENT MODULE STATE\n${renderProjectContext(pc)}`);
    if (payload.pageSnapshot) {
      s.push(`## CURRENT PAGE\n${renderPageSnapshot(payload.pageSnapshot)}`);
    }
    let recoveryNote = "";
    if (recoveryApplied.kind === "restart") {
      recoveryNote = `\n\n## SERVER NOTICE\nThe server has already wiped open questions for this stage in response to the inventor's restart request. State is clean. Proceed with Turn A for the lowest-numbered non-complete target in scope. Do NOT describe what the server did. Do NOT mention state, contradictions, support, or refresh. Just begin teaching.`;
    } else if (recoveryApplied.kind === "reset" && recoveryApplied.targetIndex !== null) {
      recoveryNote = `\n\n## SERVER NOTICE\nThe server has reset Concept ${recoveryApplied.targetIndex} to not_started and cleared any open question in response to the inventor's reset request. State is clean. Proceed with Turn A for Concept ${recoveryApplied.targetIndex}. Do NOT describe what the server did. Do NOT mention state, contradictions, support, or refresh. Just begin teaching.`;
    } else if (recoveryApplied.kind === "skip") {
      recoveryNote = `\n\n## SERVER NOTICE\nThe server has recorded the inventor's decision to move on from the current leap target and cleared the open question. Routing has advanced. Proceed with Turn A for the next non-complete target in scope. Do NOT describe what the server did. Do NOT mention state, contradictions, support, or refresh. Just begin teaching the next target.`;
    }
    return `${s.join("\n\n")}${recoveryNote}\n\n## NEW USER MESSAGE\n${payload.message}`;
  }

  // STAGE 6 CROSS-SOURCE COMPLETION — the inventor's PoHC validation answers
  // are saved to the human_inputs ledger (source "module4b/pannu-answer"), NOT
  // to the coach pohcLog. Without surfacing them, the router can't tell a
  // dimension is already answered and the helper re-interrogates the inventor
  // for work they already did in the app's own fields. Synthesize a
  // pohc_answer-shaped entry per filled PoHC field, tagged to its Key Concept
  // Set + dimension, and append it to visibleLog BEFORE routing — so the router
  // (completion), the scope filter, and the rendered context all read the same
  // augmented log and stay consistent (LAW_SCOPE_COMPLETENESS: cross-phase reuse
  // produces answers, never empty fields). Mapping failures degrade to "not
  // answered" (the helper offers to walk the dimension), never to a false
  // "complete", so a bad map can't silently drop an unanswered field.
  if (persistent && pc.currentStage === 6) {
    try {
      const { listHumanInputs } = await import("../human-inputs/ledger");
      const pohcInputs = (await listHumanInputs({ projectId: projectId! })).filter(
        (r: any) =>
          r.source === "module4b/pannu-answer" &&
          typeof r.answerText === "string" &&
          r.answerText.trim().length > 0,
      );
      const kcs: any[] = Array.isArray((pc as any).selectedKeyConcepts)
        ? (pc as any).selectedKeyConcepts
        : [];
      const idToSetLabel = new Map<string, string>();
      kcs.forEach((k, i) => {
        if (k && k.id != null) idToSetLabel.set(String(k.id), `Key Concept Set ${i + 1}`);
      });
      // App PoHC factor names → routing dimension names (STAGE6_DIMENSIONS).
      const FACTOR_TO_DIMENSION: Record<string, string> = {
        conception: "conception",
        quality: "contribution_quality",
        known_concepts: "exceeding_known",
      };
      for (const r of pohcInputs as any[]) {
        const setLabel = r.conceptId != null ? idToSetLabel.get(String(r.conceptId)) : undefined;
        // factor is the segment after "::" in sourceRefId ("<conceptId>::<factor>").
        const factor =
          typeof r.sourceRefId === "string" && r.sourceRefId.includes("::")
            ? r.sourceRefId.split("::").pop()!
            : "";
        const dimension = FACTOR_TO_DIMENSION[factor];
        if (!setLabel || !dimension) continue; // unmappable → leave as not answered
        visibleLog.push({
          id: `humanpohc_${r.id}`,
          projectId: projectId!,
          entryType: "pohc_answer",
          verbatimText: r.answerText,
          tags: [setLabel, dimension],
          dismissedAt: null,
          capturedAt: r.updatedAt || r.createdAt || new Date(),
          displayId: `humanpohc_${r.id}`,
          _source: "human_inputs",
        });
      }
    } catch (err: any) {
      console.warn("[qa-assistant] stage-6 human_input completion merge failed:", err?.message);
    }
  }

  // Routing state machine. Computed server-side per SERVER_CONTRACT in
  // qa-assistant.md — the agent reads these fields verbatim and never
  // re-derives them from pohcLog or openQuestions.
  const routing: RoutingFields = computeRouting(
    typeof pc.currentStage === "number" ? pc.currentStage : null,
    pc,
    visibleLog,
    visibleOpenQs,
  );

  // Hide log entries and open questions whose tags don't intersect the
  // current stage's scope. Old-stage signals leaking into a new stage are
  // exactly what triggers the helper's "state inconsistency / please refresh"
  // refusals. The data stays in the DB — we just don't show it to the model
  // until the user is on a stage where it's actionable again.
  const scopeSet = new Set(routing.scope);
  // Compound-aware scope membership. Stage-6 scope ids are compound
  // (`Key Concept Set N_<dimension>`) but pohc_answer entries are tagged with
  // the components separately (`["Key Concept Set N", "<dimension>"]`), so a
  // plain set-membership check would filter every captured PoHC answer out of
  // the model's context and break the assemble-all branch. tagsSatisfyScopeId
  // matches both the direct case (stages 1–5) and the compound case (stage 6).
  const inScope = (tags: any) =>
    Array.isArray(tags) && routing.scope.some((id) => tagsSatisfyScopeId(tags, id));
  const filteredVisibleLog =
    scopeSet.size === 0
      ? visibleLog
      : visibleLog.filter((e: any) => !Array.isArray(e.tags) || e.tags.length === 0 || inScope(e.tags));
  const filteredVisibleOpenQs =
    scopeSet.size === 0
      ? visibleOpenQs
      : visibleOpenQs.filter((q: any) => !Array.isArray(q.tags) || q.tags.length === 0 || inScope(q.tags));

  const fullUserMessage = buildUserMessage(filteredVisibleLog, filteredVisibleOpenQs, routing);

  // ─── 3. Persist the user message + a placeholder assistant message ─────────
  let userMsgId: string | null = null;
  let assistantMessageId: string | null = null;
  if (persistent) {
    const [userMsg] = await db
      .insert(coachMessages)
      .values({
        projectId: projectId!,
        role: "user",
        content: payload.message,
        currentLocation: {
          stage: pc.currentStage ?? null,
          substage: (pc as any).currentSubstage ?? null,
          label: payload.currentLocation ?? null,
        } as any,
      })
      .returning();
    userMsgId = userMsg.id;

    const [assistantMsg] = await db
      .insert(coachMessages)
      .values({
        projectId: projectId!,
        role: "assistant",
        content: "",
        currentLocation: {
          stage: pc.currentStage ?? null,
          substage: (pc as any).currentSubstage ?? null,
          label: payload.currentLocation ?? null,
        } as any,
      })
      .returning();
    assistantMessageId = assistantMsg.id;

    // SAFETY-NET MIRROR — every user message that arrives while a leap is in
    // progress is also written to the human_inputs ledger. The prompt's
    // PHASE 4 TURN B ACCEPTANCE is strict: a response that uses only the
    // scaffold's key terms (e.g. "multi-dimensional tolerance matrix" defined
    // in Turn A) fails the "own voice" check, so the AI continues probing
    // and never fires recordEntry on that answer — the technically rich
    // initial answer can be lost. Mirroring to human_inputs guarantees the
    // ledger captures it regardless of the AI's acceptance verdict, and the
    // "What I know" modal + Pannu pre-fill both see it.
    if (routing.currentLeapPhase === "turn_b_pending" && routing.currentLeapTarget) {
      try {
        const { recordHumanInput } = await import("../human-inputs/ledger");
        // Tag set chosen so the Pannu pre-fill engine picks the message up
        // under the right factor for whichever phase the leap belongs to.
        const stage = pc.currentStage ?? null;
        const phaseTags: string[] =
          stage === 4 ? ["whitespace_rationale", "differentiation"] :
          stage === 6 ? ["technical_advance", "implementation_detail"] :
          stage === 7 ? ["conception_mechanism", "conception_timeline"] :
          stage === 2 ? ["conception_mechanism"] :
          ["free_text"];
        await recordHumanInput({
          projectId: projectId!,
          source: "module0/qa-assistant",
          // Unique per message so we don't overwrite earlier attempts.
          sourceRefId: `chat_${userMsg.id}`,
          promptText: `Leap response for ${routing.currentLeapTarget}`,
          answerText: payload.message,
          tags: phaseTags,
          conceptId: String(routing.currentLeapTarget),
        });
      } catch (mirrorErr: any) {
        console.warn("[qa-assistant] leap-message mirror to human_inputs failed:", mirrorErr?.message);
      }
    }
  }

  const toolCtx: ToolContext = {
    projectId: projectId ?? "",
    assistantMessageId: assistantMessageId ?? "",
    questionIdMap: questionDisplayToUuid,
    currentLeapTarget: routing.currentLeapTarget,
    polishSections: isPolishMode ? polishSectionsFromDraft((pc as any).provisionalDraft) : null,
  };

  // Polish mode declares the proposeDraftEdits tool on top of the standing
  // five — findings travel through it instead of paste blocks.
  const toolDeclarations = isPolishMode
    ? [...TOOL_DECLARATIONS, PROPOSE_DRAFT_EDITS_DECLARATION]
    : TOOL_DECLARATIONS;

  // Tool schema conversion: the tool `parameters` JSON-Schema maps directly to
  // the AI's `input_schema`. cache_control on the last tool keeps the tool
  // block cached alongside the system prompt (~10× cheaper on cache hits).
  const anthropicTools: any[] = toolDeclarations.map((d: any, i: number) => ({
    name: d.name,
    description: d.description,
    input_schema: d.parameters,
    ...(i === toolDeclarations.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  }));

  // ─── 4. Streaming + tool-calling loop ──────────────────────────────────────
  // Polish-mode history: keep the last 8 turns of BOTH roles. The refreshed
  // CURRENT FINAL DRAFT block remains the only audit target (the prompt
  // forbids flagging text that isn't in it), but the model needs its own
  // prior turns to honor TERMINOLOGY PRESERVATION (never re-flag wording the
  // inventor already accepted) and to see that it already answered earlier
  // questions. The previous user-turns-only sanitization caused both failure
  // modes: settled terms were re-flagged every pass (the audit never
  // converged) and stale questions were re-answered turn after turn.
  const chronoForHistory = isPolishMode ? recentChrono.slice(-8) : recentChrono;
  const priorMessages = chronoForHistory.map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
    content: m.content as any,
  }));

  // Mutable conversation we feed back into the AI each iteration.
  const originalUserMsgIndex = priorMessages.length;
  const messages: any[] = [
    ...priorMessages,
    { role: "user", content: fullUserMessage },
  ];

  // Cached system block — the LEAP prompt is large and static across turns, so
  // cache_control makes every turn after the first read it from cache.
  const systemBlocks: any[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];

  const allTokens: string[] = [];
  const allToolCalls: Array<ToolCall & { result?: ToolResult }> = [];
  let usedFallback = false;

  // Incremental persistence — every ~500ms while streaming, push the running
  // token buffer to coachMessages.content. Survives client disconnect on
  // Vercel where the function may be terminated before the final write below.
  let lastFlushedContent = "";
  let flushTimer: NodeJS.Timeout | null = null;
  const flushPartialContent = async () => {
    if (!persistent || !assistantMessageId) return;
    const next = allTokens.join("").trim();
    if (next === lastFlushedContent) return;
    lastFlushedContent = next;
    try {
      await db
        .update(coachMessages)
        .set({ content: next })
        .where(eq(coachMessages.id, assistantMessageId));
    } catch (e: any) {
      console.warn("[QA-Assistant] partial flush failed:", e?.message);
    }
  };
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPartialContent();
    }, 500);
  };

  let geminiFailedOnFirstTurn = false;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const turnText: string[] = [];
    const turnToolCalls: ToolCall[] = [];
    // The assistant's fully-assembled turn content (text + tool_use blocks).
    // Echoed back verbatim on the follow-up turn so the AI's tool_use/tool_result
    // pairing stays valid.
    let assistantContentBlocks: any[] = [];

    // On the final allowed turn, drop the tool declarations so the AI is
    // forced to emit a prose response instead of calling more tools. Without
    // this guard, models that keep proposing tool calls every turn exhaust
    // MAX_TOOL_TURNS with no text and the user sees only tool chips.
    const isLastTurn = turn === MAX_TOOL_TURNS - 1;
    const turnStarted = Date.now();
    let usedSecondaryKey = false;
    try {
      const stream = anthropic.messages.stream({
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        temperature: CONFIG.temperature,
        // NOTE: this model rejects temperature + top_p together — use only temperature.
        system: systemBlocks,
        messages,
        // Drop tools on the last allowed turn so the AI is forced to emit prose
        // instead of proposing more tool calls and exhausting MAX_TOOL_TURNS.
        ...(CONFIG.toolsEnabled && !isLastTurn ? { tools: anthropicTools } : {}),
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && (event.delta as any).type === "text_delta") {
          const t = (event.delta as any).text as string;
          if (t) {
            turnText.push(t);
            allTokens.push(t);
            scheduleFlush();
            yield { type: "token", data: { delta: t } };
          }
        }
      }

      // The fully assembled assistant turn — text + any tool_use blocks. Echoed
      // back verbatim next iteration to keep tool_use/tool_result pairing valid.
      const finalMsg = await stream.finalMessage();
      assistantContentBlocks = finalMsg.content as any[];
      for (const block of assistantContentBlocks) {
        if ((block as any).type === "tool_use") {
          turnToolCalls.push({ name: (block as any).name, args: (block as any).input ?? {} });
        }
      }

      const u = finalMsg.usage as any;
      void recordUsage({
        userId: payload.userId ?? null,
        userEmail: payload.userEmail ?? null,
        projectId: projectId ?? null,
        agentCode: "module0/qa-assistant",
        model: CONFIG.model,
        inputTokens: u?.input_tokens ?? null,
        outputTokens: u?.output_tokens ?? null,
        cachedTokens: u?.cache_read_input_tokens ?? null,
        durationMs: Date.now() - turnStarted,
        status: "ok",
        usedSecondaryKey,
        requestId: payload.requestId ?? null,
        metadata: {
          turn,
          toolCalls: turnToolCalls.map((c) => c.name),
          cacheWrite: u?.cache_creation_input_tokens ?? 0,
        },
      });
    } catch (geminiErr: any) {
      console.warn(`[QA-Assistant] The AI failed on turn ${turn}, falling back to ${CONFIG.fallback}:`, geminiErr?.message);
      if (turn === 0) geminiFailedOnFirstTurn = true;
      usedFallback = true;
      // Record the failed AI turn so it shows up in the admin usage page.
      void recordUsage({
        userId: payload.userId ?? null,
        userEmail: payload.userEmail ?? null,
        projectId: projectId ?? null,
        agentCode: "module0/qa-assistant",
        model: CONFIG.model,
        durationMs: Date.now() - turnStarted,
        status: "error",
        usedSecondaryKey,
        requestId: payload.requestId ?? null,
        errorMessage: geminiErr?.message ?? String(geminiErr),
        metadata: { turn },
      });
      const fbStarted = Date.now();
      try {
        const completion = await openai.chat.completions.create({
          model: CONFIG.fallback,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...recentChrono.map((m) => ({
              role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
              content: m.content,
            })),
            { role: "user", content: fullUserMessage },
          ],
          temperature: CONFIG.temperature,
          max_tokens: Math.min(CONFIG.maxTokens, 16384),
        });
        const text = completion.choices[0]?.message?.content ?? "";
        allTokens.push(text);
        scheduleFlush();
        yield { type: "token", data: { delta: text } };
        void recordUsage({
          userId: payload.userId ?? null,
          userEmail: payload.userEmail ?? null,
          projectId: projectId ?? null,
          agentCode: "module0/qa-assistant",
          model: CONFIG.fallback,
          ...extractOpenAIUsage(completion),
          durationMs: Date.now() - fbStarted,
          status: "fallback",
          fallbackFrom: CONFIG.model,
          requestId: payload.requestId ?? null,
          metadata: { turn },
        });
      } catch (fallbackErr: any) {
        void recordUsage({
          userId: payload.userId ?? null,
          userEmail: payload.userEmail ?? null,
          projectId: projectId ?? null,
          agentCode: "module0/qa-assistant",
          model: CONFIG.fallback,
          durationMs: Date.now() - fbStarted,
          status: "error",
          fallbackFrom: CONFIG.model,
          requestId: payload.requestId ?? null,
          errorMessage: fallbackErr?.message ?? String(fallbackErr),
          metadata: { turn },
        });
        yield {
          type: "error",
          data: {
            message: `The AI is temporarily unavailable: ${fallbackErr?.message ?? String(fallbackErr)}`,
            recoverable: false,
          },
        };
        return;
      }
      // Fallback path produces final prose with no tool calls; exit the loop.
      break;
    }

    // If the model produced no tool calls this turn, we're done.
    if (turnToolCalls.length === 0) break;

    // Execute tool calls and stream their results to the client.
    const turnResults: ToolResult[] = [];
    for (const call of turnToolCalls) {
      const r = persistent
        ? await executeTool(call, toolCtx)
        : ({ name: call.name, ok: false, error: "non-persistent session" } as ToolResult);
      turnResults.push(r);
      allToolCalls.push({ ...call, result: r });
      yield { type: "tool-result", data: r };
    }

    // Echo the assistant's full turn (text + tool_use blocks), then the matching
    // tool_result blocks, so the AI can produce the prose that closes the turn.
    // tool_use blocks and turnResults are in the same order (both derived from
    // assistantContentBlocks in sequence), so index i aligns.
    messages.push({ role: "assistant", content: assistantContentBlocks });
    const toolUseBlocks = assistantContentBlocks.filter((b: any) => b.type === "tool_use");
    messages.push({
      role: "user",
      content: toolUseBlocks.map((b: any, i: number) => ({
        type: "tool_result",
        tool_use_id: b.id,
        content: turnResults[i]?.ok
          ? JSON.stringify(turnResults[i].result ?? {})
          : JSON.stringify({ error: turnResults[i]?.error ?? "tool failed" }),
      })),
    });

    // Re-compute routing state for the next iteration. The tools we just
    // executed (recordEntry / addOpenQuestion / closeOpenQuestion) mutated
    // the underlying tables, so leapProgress / currentLeapTarget / currentLeapPhase
    // need fresh reads — the agent's next turn must see post-tool state per
    // SERVER_CONTRACT.POST-TOOL_STATE_MANAGEMENT.
    if (persistent) {
      const refreshedLog = await db
        .select()
        .from(coachLogEntries)
        .where(eq(coachLogEntries.projectId, projectId!))
        .orderBy(coachLogEntries.capturedAt);
      const refreshedOpenQs = await db
        .select()
        .from(coachOpenQuestions)
        .where(eq(coachOpenQuestions.projectId, projectId!))
        .orderBy(coachOpenQuestions.createdAt);
      const visibleRefreshedLog = refreshedLog.filter((r) => r.dismissedAt === null);
      const visibleRefreshedOpenQs = refreshedOpenQs.filter(
        (r) => r.answeredAt === null && r.dismissedAt === null,
      );
      const updatedRouting = computeRouting(
        typeof pc.currentStage === "number" ? pc.currentStage : null,
        pc,
        visibleRefreshedLog,
        visibleRefreshedOpenQs,
      );
      toolCtx.currentLeapTarget = updatedRouting.currentLeapTarget;
      // Re-attach display ids so buildUserMessage can render them next turn.
      const refreshedLogWithIds = visibleRefreshedLog.map((r, i) => ({
        ...r,
        displayId: `entry_${pad4(i + 1)}`,
      }));
      const refreshedOpenQsWithIds = visibleRefreshedOpenQs.map((r, i) => ({
        ...r,
        displayId: `q_${pad4(i + 1)}`,
      }));
      // Same scope filter as the first turn — keep out-of-scope leap signals
      // from leaking into the next tool turn.
      const updatedScopeSet = new Set(updatedRouting.scope);
      const updatedInScope = (tags: any) =>
        Array.isArray(tags) && tags.some((t) => typeof t === "string" && updatedScopeSet.has(t));
      const filteredRefreshedLog =
        updatedScopeSet.size === 0
          ? refreshedLogWithIds
          : refreshedLogWithIds.filter(
              (e: any) => !Array.isArray(e.tags) || e.tags.length === 0 || updatedInScope(e.tags),
            );
      const filteredRefreshedOpenQs =
        updatedScopeSet.size === 0
          ? refreshedOpenQsWithIds
          : refreshedOpenQsWithIds.filter(
              (q: any) => !Array.isArray(q.tags) || q.tags.length === 0 || updatedInScope(q.tags),
            );
      // Overwrite the original user message in place so the agent only sees
      // the CURRENT TURN ROUTER STATE — not the pre-tool snapshot. Without
      // this, LAW_TURN_ROUTER_PRIMACY makes the agent anchor on stale state
      // (e.g. currentLeapPhase=not_started) even after a completion entry
      // landed in pohcLog.
      const rebuiltMessage = buildUserMessage(
        filteredRefreshedLog,
        filteredRefreshedOpenQs,
        updatedRouting,
      );
      messages[originalUserMsgIndex] = {
        role: "user",
        content: rebuiltMessage,
      };
    }
  }

  // Last-resort prose pass. If the tool dance consumed every allowed turn
  // and the AI emitted zero text, the user sees only chips. Force one final
  // call with no tool declarations and a direct instruction to reply.
  if (!usedFallback && allTokens.join("").trim().length === 0) {
    const proseStarted = Date.now();
    try {
      messages.push({
        role: "user",
        content: "Tools have finished executing. Compose your prose reply now based on the current TURN ROUTER STATE — do not call any more tools.",
      });
      const proseStream = anthropic.messages.stream({
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        temperature: CONFIG.temperature,
        system: systemBlocks,
        messages,
      });
      for await (const event of proseStream) {
        if (event.type === "content_block_delta" && (event.delta as any).type === "text_delta") {
          const t = (event.delta as any).text as string;
          if (t) {
            allTokens.push(t);
            scheduleFlush();
            yield { type: "token", data: { delta: t } };
          }
        }
      }
      const proseMsg = await proseStream.finalMessage();
      const pu = proseMsg.usage as any;
      void recordUsage({
        userId: payload.userId ?? null,
        userEmail: payload.userEmail ?? null,
        projectId: projectId ?? null,
        agentCode: "module0/qa-assistant",
        model: CONFIG.model,
        inputTokens: pu?.input_tokens ?? null,
        outputTokens: pu?.output_tokens ?? null,
        cachedTokens: pu?.cache_read_input_tokens ?? null,
        durationMs: Date.now() - proseStarted,
        status: "ok",
        requestId: payload.requestId ?? null,
        metadata: { phase: "prose-fallback" },
      });
    } catch (proseErr: any) {
      console.warn("[QA-Assistant] Prose fallback failed:", proseErr?.message);
      // Emit a minimal acknowledgement so the user isn't left with only chips.
      const ack = "Recorded. (No additional commentary this turn.)";
      allTokens.push(ack);
      scheduleFlush();
      yield { type: "token", data: { delta: ack } };
    }
  }

  // ─── 5. Persist final assistant content + tool-call log ────────────────────
  // Cancel any pending debounced flush — we're about to write the final state.
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const finalAssistantText = allTokens.join("").trim();

  // UPL output lint — FLAG MODE (log only, never blocks). Runs after the reply
  // has already streamed to the inventor, so it adds zero latency to the turn.
  // Switch the `block` tier to actually withhold only once the false-positive
  // rate is known. See qa-assistant.UPL-compliance-draft.md. Wrapped so a lint
  // failure can never break a turn.
  try {
    const uplFindings = scanForUPL(finalAssistantText);
    if (uplFindings.length > 0) {
      const blocking = uplFindings.filter((f) => f.severity === "block").length;
      console.warn(
        `[QA-Assistant][UPL-LINT] project=${projectId ?? "?"} stage=${(pc as any).currentStage ?? "?"} ` +
        `msg=${assistantMessageId ?? "?"} findings=${uplFindings.length} blocking=${blocking} ` +
        `terms=${JSON.stringify(uplFindings.map((f) => `${f.severity}:${f.term}`))}`,
      );
    }
  } catch (e: any) {
    console.warn("[QA-Assistant][UPL-LINT] scan failed:", e?.message);
  }

  if (persistent && assistantMessageId) {
    try {
      await db
        .update(coachMessages)
        .set({
          content: finalAssistantText,
          toolCalls: allToolCalls.length ? (allToolCalls as any) : null,
        })
        .where(eq(coachMessages.id, assistantMessageId));
    } catch (e: any) {
      console.warn("[QA-Assistant] final persistence failed:", e?.message);
    }
  }

  // Suppress unused-variable diagnostic; this flag exists for future telemetry.
  void geminiFailedOnFirstTurn;

  yield {
    type: "done",
    data: {
      userMessageId: userMsgId,
      assistantMessageId,
      usedFallback,
    },
  };
}

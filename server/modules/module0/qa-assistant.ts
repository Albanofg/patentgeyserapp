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
//   - Calls Gemini Pro with function-calling tools.
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
import { recordUsage, extractGeminiUsage, extractOpenAIUsage } from "../../ai/usage-log";
import { computeRouting, renderRouting, type RoutingFields } from "./routing";

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

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
// Secondary key (separate GCP project = separate quota bucket). Used as a
// failover when the primary throws — keeps the AI Helper alive through
// rate-limit hiccups without falling back to gpt-4o.
const geminiSecondary = process.env.GEMINI_API_SECOND_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_SECOND_KEY })
  : null;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const GEMINI_SAFETY_OFF = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ─── Tool argument schemas + Gemini tool declarations ───────────────────────

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
  };
  currentLocation: string;
  sessionId?: string;
  /**
   * Identity of the authenticated caller. Used for usage logging only —
   * persisted alongside each Gemini/OpenAI invocation so the admin /admin/usage
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
  if (f.includes("broaderclaim")) return "Broader Claim";
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
  return null;
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

  return includeDismissed
    ? withDisplay
    : withDisplay.filter((row) => row.dismissedAt === null);
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
 *   3. Calls Gemini Pro with the system prompt (qa-assistant.md) and the
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

  // Build the full user message from fresh state. Used at start AND between
  // tool turns so the agent always reads the current TURN ROUTER STATE — not
  // the stale block from before the tool calls executed.
  function buildUserMessage(
    logRows: Array<any>,
    openQRows: Array<any>,
    routingNow: RoutingFields,
  ): string {
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
  const inScope = (tags: any) =>
    Array.isArray(tags) && tags.some((t) => typeof t === "string" && scopeSet.has(t));
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
  }

  const toolCtx: ToolContext = {
    projectId: projectId ?? "",
    assistantMessageId: assistantMessageId ?? "",
    questionIdMap: questionDisplayToUuid,
    currentLeapTarget: routing.currentLeapTarget,
  };

  // ─── 4. Streaming + tool-calling loop ──────────────────────────────────────
  const geminiHistory = recentChrono.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Mutable conversation we feed back into Gemini each iteration.
  const originalUserMsgIndex = geminiHistory.length;
  const contents: any[] = [
    ...geminiHistory,
    { role: "user", parts: [{ text: fullUserMessage }] },
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
    // Capture raw functionCall parts (including Gemini Pro's `thoughtSignature`)
    // so we can echo them back faithfully on the follow-up turn. Reconstructing
    // from { name, args } alone strips the signature and the API will reject
    // the next request with INVALID_ARGUMENT.
    const turnFunctionCallParts: any[] = [];

    // On the final allowed turn, drop the tool declarations so Gemini is
    // forced to emit a prose response instead of calling more tools. Without
    // this guard, models that keep proposing tool calls every turn exhaust
    // MAX_TOOL_TURNS with no text and the user sees only tool chips.
    const isLastTurn = turn === MAX_TOOL_TURNS - 1;
    const streamConfig = {
      model: CONFIG.model,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: CONFIG.temperature,
        topP: CONFIG.topP,
        maxOutputTokens: CONFIG.maxTokens,
        safetySettings: GEMINI_SAFETY_OFF,
        ...(CONFIG.toolsEnabled && !isLastTurn
          ? { tools: [{ functionDeclarations: TOOL_DECLARATIONS as any }] }
          : {}),
      },
    };

    const turnStarted = Date.now();
    let usedSecondaryKey = false;
    let lastChunk: any = null;
    try {
      let stream;
      try {
        stream = await gemini.models.generateContentStream(streamConfig);
      } catch (primaryErr: any) {
        // Try the secondary key (separate quota bucket) before giving up on
        // Gemini entirely. Only swap on stream-open errors — once tokens are
        // flowing, a mid-stream failure goes straight to the gpt-4o fallback.
        if (geminiSecondary) {
          console.warn(`[QA-Assistant] Primary Gemini key failed, trying secondary key:`, primaryErr?.message);
          stream = await geminiSecondary.models.generateContentStream(streamConfig);
          usedSecondaryKey = true;
        } else {
          throw primaryErr;
        }
      }

      for await (const chunk of stream) {
        lastChunk = chunk;
        const t = (chunk as any).text;
        if (t) {
          turnText.push(t);
          allTokens.push(t);
          scheduleFlush();
          yield { type: "token", data: { delta: t } };
        }
        // Walk the candidate parts to preserve functionCall metadata
        // (thoughtSignature, etc.) — chunk.functionCalls is a lossy convenience.
        const parts = (chunk as any).candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (p?.functionCall) {
              turnFunctionCallParts.push(p);
              turnToolCalls.push({
                name: p.functionCall.name,
                args: p.functionCall.args ?? {},
              });
            }
          }
        }
      }

      // Log one usage row per turn. Gemini's usageMetadata lands on the
      // terminal chunk; we read it off lastChunk (or fall back to null
      // counts if the SDK omitted it for this snapshot).
      const usage = extractGeminiUsage(lastChunk);
      void recordUsage({
        userId: payload.userId ?? null,
        userEmail: payload.userEmail ?? null,
        projectId: projectId ?? null,
        agentCode: "module0/qa-assistant",
        model: CONFIG.model,
        ...usage,
        durationMs: Date.now() - turnStarted,
        status: usedSecondaryKey ? "retry" : "ok",
        usedSecondaryKey,
        requestId: payload.requestId ?? null,
        metadata: { turn, toolCalls: turnToolCalls.map((c) => c.name) },
      });
    } catch (geminiErr: any) {
      console.warn(`[QA-Assistant] Gemini failed on turn ${turn}, falling back to ${CONFIG.fallback}:`, geminiErr?.message);
      if (turn === 0) geminiFailedOnFirstTurn = true;
      usedFallback = true;
      // Record the failed Gemini turn so it shows up in the admin usage page.
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
            message: `Both Gemini and fallback failed: ${fallbackErr?.message ?? String(fallbackErr)}`,
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

    // Build the model turn for the next iteration's contents. Preserve raw
    // functionCall parts (with thoughtSignature intact) — Gemini Pro will 400
    // the next request if the signature is missing.
    const joinedText = turnText.join("");
    const modelParts: any[] = [];
    if (joinedText) modelParts.push({ text: joinedText });
    for (const p of turnFunctionCallParts) modelParts.push(p);

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

    // Append model turn + tool responses for the follow-up Gemini call so it
    // can produce the prose response that closes out the turn.
    contents.push({ role: "model", parts: modelParts });
    contents.push({
      role: "user",
      parts: turnResults.map((r, i) => ({
        functionResponse: {
          name: turnToolCalls[i].name,
          response: r.ok ? (r.result ?? {}) : { error: r.error ?? "tool failed" },
        },
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
      contents[originalUserMsgIndex] = {
        role: "user",
        parts: [{ text: rebuiltMessage }],
      };
    }
  }

  // Last-resort prose pass. If the tool dance consumed every allowed turn
  // and Gemini emitted zero text, the user sees only chips. Force one final
  // call with no tool declarations and a direct instruction to reply.
  if (!usedFallback && allTokens.join("").trim().length === 0) {
    const proseStarted = Date.now();
    try {
      contents.push({
        role: "user",
        parts: [
          {
            text: "Tools have finished executing. Compose your prose reply now based on the current TURN ROUTER STATE — do not call any more tools.",
          },
        ],
      });
      let stream;
      try {
        stream = await gemini.models.generateContentStream({
          model: CONFIG.model,
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: CONFIG.temperature,
            topP: CONFIG.topP,
            maxOutputTokens: CONFIG.maxTokens,
            safetySettings: GEMINI_SAFETY_OFF,
          },
        });
      } catch (primaryErr: any) {
        if (geminiSecondary) {
          stream = await geminiSecondary.models.generateContentStream({
            model: CONFIG.model,
            contents,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              temperature: CONFIG.temperature,
              topP: CONFIG.topP,
              maxOutputTokens: CONFIG.maxTokens,
              safetySettings: GEMINI_SAFETY_OFF,
            },
          });
        } else {
          throw primaryErr;
        }
      }
      let lastProseChunk: any = null;
      for await (const chunk of stream) {
        lastProseChunk = chunk;
        const t = (chunk as any).text;
        if (t) {
          allTokens.push(t);
          scheduleFlush();
          yield { type: "token", data: { delta: t } };
        }
      }
      void recordUsage({
        userId: payload.userId ?? null,
        userEmail: payload.userEmail ?? null,
        projectId: projectId ?? null,
        agentCode: "module0/qa-assistant",
        model: CONFIG.model,
        ...extractGeminiUsage(lastProseChunk),
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
  if (persistent && assistantMessageId) {
    try {
      await db
        .update(coachMessages)
        .set({
          content: allTokens.join("").trim(),
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

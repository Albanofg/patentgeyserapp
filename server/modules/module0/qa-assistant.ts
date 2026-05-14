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
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";

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

const recordEntryArgs = z.object({
  entryType: z.enum(["pohc", "leap", "both"]),
  verbatimText: z.string().min(1),
  tags: z.array(z.string()).optional(),
});
const updateArticulationArgs = z.object({ markdown: z.string().min(1) });
const addOpenQuestionArgs = z.object({ question: z.string().min(1) });
const closeOpenQuestionArgs = z.object({ questionId: z.string().min(1) });
const flagScopeDriftArgs = z.object({ note: z.string().min(1) });

const TOOL_DECLARATIONS = [
  {
    name: "recordEntry",
    description:
      "Record a POHC (Proof of Human Conception) or Conceptual Leap entry from the user's latest message. verbatimText must be the user's exact words, copied not paraphrased. Use entryType 'both' when a single utterance is both new conception evidence and a first-time naming of a mechanism.",
    parameters: {
      type: "object",
      properties: {
        entryType: { type: "string", enum: ["pohc", "leap", "both"] },
        verbatimText: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["entryType", "verbatimText"],
    },
  },
  {
    name: "updateArticulation",
    description:
      "Rewrite the Current Articulation of the invention as a new versioned snapshot. Use only the inventor's own words.",
    parameters: {
      type: "object",
      properties: { markdown: { type: "string" } },
      required: ["markdown"],
    },
  },
  {
    name: "addOpenQuestion",
    description: "Add a question to the open-questions list when the inventor might overlook it.",
    parameters: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
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
}

async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "recordEntry": {
        const a = recordEntryArgs.parse(call.args);
        const [row] = await db
          .insert(coachLogEntries)
          .values({
            projectId: ctx.projectId,
            entryType: a.entryType,
            verbatimText: a.verbatimText,
            sourceMessageId: ctx.assistantMessageId,
            capturedBy: "auto",
            tags: a.tags ?? null,
          })
          .returning();
        return { name: call.name, ok: true, result: { entryId: row.id, entryType: row.entryType } };
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
          VALUES (${ctx.projectId}, ${nextVersion}, 'coach_articulation', ${a.markdown})
          RETURNING id
        `);
        const snapshotId = (insertRes as any).rows?.[0]?.id;
        return { name: call.name, ok: true, result: { snapshotId, version: nextVersion } };
      }
      case "addOpenQuestion": {
        const a = addOpenQuestionArgs.parse(call.args);
        const [row] = await db
          .insert(coachOpenQuestions)
          .values({
            projectId: ctx.projectId,
            question: a.question,
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
    ideaSummary?: string;
    extractedIdeas?: any[];
    approvedIdeas?: any[];
    expandedConcepts?: any[];
    selectedConcepts?: any[];
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
   * Snapshot of what's currently rendered on the page the user is chatting from.
   * Built client-side via the page-snapshot registry (lib/page-snapshot.ts).
   * Either a "structured" snapshot from a page that registered itself, or a
   * "fallback" scrape of `<main>` text for pages that haven't been wired up yet.
   */
  pageSnapshot?: {
    pageName: string;
    route: string;
    description?: string;
    items?: Array<{ id: string; type: string; status?: string; content: any }>;
    drafts?: Record<string, string>;
    focused?: string;
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

  const items = snap.items ?? [];
  if (items.length > 0) {
    lines.push(`\n### Items on page (${items.length})`);
    for (const it of items) {
      const head = `- [${it.id}] (${it.type}${it.status ? `, ${it.status}` : ""})`;
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
      `\n(Note: this page has not registered a structured snapshot — the body above is a best-effort scrape. Treat ids as approximate and prefer asking the user to clarify when precision matters.)`,
    );
  }

  return lines.join("\n");
}

/**
 * Render the projectContext as a labeled markdown block so the model can
 * address every list item by its stable label rather than positional ordinals.
 */
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
        const text = typeof item === "string" ? item : JSON.stringify(item);
        lines.push(`- ${prefix} ${i + 1}: ${text}`);
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

export async function getQALog(projectId: string, includeDismissed = false) {
  // Load all rows (including dismissed) so display ids are stable across calls.
  const all = await db
    .select()
    .from(coachLogEntries)
    .where(eq(coachLogEntries.projectId, projectId))
    .orderBy(coachLogEntries.capturedAt);
  const withDisplay = all.map((row, i) => ({ ...row, displayId: `entry_${pad4(i + 1)}` }));
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
export async function* runQAAssistant(payload: QAPayload): AsyncGenerator<QAEvent> {
  const projectId = payload.projectContext?.projectId;
  const persistent = typeof projectId === "string" && projectId.length > 0;
  const MAX_TOOL_TURNS = 3;

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
  } else {
    // Stateless fallback: use the conversationHistory the client sent.
    recentChrono = (payload.conversationHistory ?? []).map((m) => ({
      role: m.role,
      content: m.content,
      currentLocation: null,
    }));
  }

  // ─── 2. Build the runtime context block ────────────────────────────────────
  const sections: string[] = [];
  const pc = payload.projectContext ?? {};
  const projInfo: string[] = [];
  if (pc.projectTitle) projInfo.push(`Title: ${pc.projectTitle}`);
  if (pc.currentStage !== undefined && pc.currentStage !== null) {
    projInfo.push(`currentLocation.stage: ${pc.currentStage}`);
  }
  if (payload.currentLocation) projInfo.push(`Location label: ${payload.currentLocation}`);
  projInfo.push(`previousStage: ${previousStage === null ? "null" : String(previousStage)}`);
  sections.push(`## PROJECT META\n${projInfo.join("\n")}`);

  sections.push(
    `## POHC + LEAP LOG (${visibleLog.length} entries)\n${
      visibleLog.length === 0
        ? "(empty)"
        : visibleLog
            .map(
              (e) =>
                `- ${e.displayId} [${(e.entryType || "").toUpperCase()}] (${
                  e.capturedAt?.toISOString?.() ?? ""
                }): ${e.editedText ?? e.verbatimText}`,
            )
            .join("\n")
    }`,
  );
  sections.push(
    `## CURRENT ARTICULATION (v${latestArticulation?.version ?? 0})\n${
      latestArticulation?.content ?? "(none yet)"
    }`,
  );
  sections.push(
    `## OPEN QUESTIONS (${visibleOpenQs.length})\n${
      visibleOpenQs.length === 0
        ? "(none)"
        : visibleOpenQs.map((q) => `- ${q.displayId}: ${q.question}`).join("\n")
    }`,
  );
  sections.push(`## AGENT MODULE STATE\n${renderProjectContext(pc)}`);

  // Snapshot of what's on the user's screen right now (registered per-page,
  // or a fallback `<main>` scrape). Always present — there's no scenario where
  // the user isn't looking at *something*.
  if (payload.pageSnapshot) {
    sections.push(`## CURRENT PAGE\n${renderPageSnapshot(payload.pageSnapshot)}`);
  }

  const fullUserMessage = `${sections.join("\n\n")}\n\n## NEW USER MESSAGE\n${payload.message}`;

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
        currentLocation: { stage: pc.currentStage ?? null, label: payload.currentLocation ?? null } as any,
      })
      .returning();
    userMsgId = userMsg.id;

    const [assistantMsg] = await db
      .insert(coachMessages)
      .values({
        projectId: projectId!,
        role: "assistant",
        content: "",
        currentLocation: { stage: pc.currentStage ?? null, label: payload.currentLocation ?? null } as any,
      })
      .returning();
    assistantMessageId = assistantMsg.id;
  }

  const toolCtx: ToolContext = {
    projectId: projectId ?? "",
    assistantMessageId: assistantMessageId ?? "",
    questionIdMap: questionDisplayToUuid,
  };

  // ─── 4. Streaming + tool-calling loop ──────────────────────────────────────
  const geminiHistory = recentChrono.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Mutable conversation we feed back into Gemini each iteration.
  const contents: any[] = [
    ...geminiHistory,
    { role: "user", parts: [{ text: fullUserMessage }] },
  ];

  const allTokens: string[] = [];
  const allToolCalls: Array<ToolCall & { result?: ToolResult }> = [];
  let usedFallback = false;

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
        } else {
          throw primaryErr;
        }
      }

      for await (const chunk of stream) {
        const t = (chunk as any).text;
        if (t) {
          turnText.push(t);
          allTokens.push(t);
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
    } catch (geminiErr: any) {
      console.warn(`[QA-Assistant] Gemini failed on turn ${turn}, falling back to ${CONFIG.fallback}:`, geminiErr?.message);
      if (turn === 0) geminiFailedOnFirstTurn = true;
      usedFallback = true;
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
        yield { type: "token", data: { delta: text } };
      } catch (fallbackErr: any) {
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
  }

  // ─── 5. Persist final assistant content + tool-call log ────────────────────
  if (persistent && assistantMessageId) {
    await db
      .update(coachMessages)
      .set({
        content: allTokens.join("").trim(),
        toolCalls: allToolCalls.length ? (allToolCalls as any) : null,
      })
      .where(eq(coachMessages.id, assistantMessageId));
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

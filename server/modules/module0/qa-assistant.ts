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
import { and, desc, eq, isNull, sql } from "drizzle-orm";
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

async function executeTool(
  call: ToolCall,
  projectId: string,
  assistantMessageId: string,
): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "recordEntry": {
        const a = recordEntryArgs.parse(call.args);
        const [row] = await db
          .insert(coachLogEntries)
          .values({
            projectId,
            entryType: a.entryType,
            verbatimText: a.verbatimText,
            sourceMessageId: assistantMessageId,
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
          WHERE project_id = ${projectId}
        `);
        const nextVersion = Number((versionRes as any).rows?.[0]?.v ?? 0) + 1;
        const insertRes = await db.execute(sql`
          INSERT INTO inventor_geyser.idea_snapshots
            (project_id, version, snapshot_type, content)
          VALUES (${projectId}, ${nextVersion}, 'coach_articulation', ${a.markdown})
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
            projectId,
            question: a.question,
            askedInMessageId: assistantMessageId,
          })
          .returning();
        return { name: call.name, ok: true, result: { questionId: row.id } };
      }
      case "closeOpenQuestion": {
        const a = closeOpenQuestionArgs.parse(call.args);
        await db
          .update(coachOpenQuestions)
          .set({ answeredAt: new Date(), answeredInMessageId: assistantMessageId })
          .where(eq(coachOpenQuestions.id, a.questionId));
        return { name: call.name, ok: true, result: { questionId: a.questionId } };
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
}

export type QAEvent =
  | { type: "token"; data: { delta: string } }
  | { type: "tool-result"; data: ToolResult }
  | { type: "done"; data: { userMessageId: string | null; assistantMessageId: string | null; usedFallback: boolean } }
  | { type: "error"; data: { message: string; recoverable: boolean } };

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
  const cond = includeDismissed
    ? eq(coachLogEntries.projectId, projectId)
    : and(eq(coachLogEntries.projectId, projectId), isNull(coachLogEntries.dismissedAt));
  return await db.select().from(coachLogEntries).where(cond).orderBy(coachLogEntries.capturedAt);
}

export async function getQAOpenQuestions(projectId: string, includeAnswered = false) {
  const cond = includeAnswered
    ? eq(coachOpenQuestions.projectId, projectId)
    : and(
        eq(coachOpenQuestions.projectId, projectId),
        isNull(coachOpenQuestions.answeredAt),
        isNull(coachOpenQuestions.dismissedAt),
      );
  return await db.select().from(coachOpenQuestions).where(cond).orderBy(coachOpenQuestions.createdAt);
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

  // 1. Load module-owned state (only if we know the project)
  let log: any[] = [];
  let openQs: any[] = [];
  let latestArticulation: { version: number; content: string } | null = null;
  let recentChrono: Array<{ role: string; content: string }> = [];

  if (persistent) {
    log = await db
      .select()
      .from(coachLogEntries)
      .where(and(eq(coachLogEntries.projectId, projectId!), isNull(coachLogEntries.dismissedAt)))
      .orderBy(coachLogEntries.capturedAt);

    openQs = await db
      .select()
      .from(coachOpenQuestions)
      .where(
        and(
          eq(coachOpenQuestions.projectId, projectId!),
          isNull(coachOpenQuestions.answeredAt),
          isNull(coachOpenQuestions.dismissedAt),
        ),
      )
      .orderBy(coachOpenQuestions.createdAt);

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
    recentChrono = [...recent].reverse().map((m) => ({ role: m.role, content: m.content }));
  } else {
    // Stateless fallback: use the conversationHistory the client sent.
    recentChrono = payload.conversationHistory ?? [];
  }

  // 2. Build context block
  const sections: string[] = [];
  if (payload.projectContext) {
    const pc = payload.projectContext;
    const projInfo: string[] = [];
    if (pc.projectTitle) projInfo.push(`Title: ${pc.projectTitle}`);
    if (pc.currentStage) projInfo.push(`Pipeline stage: Module ${pc.currentStage}`);
    if (payload.currentLocation) projInfo.push(`Location: ${payload.currentLocation}`);
    if (projInfo.length) sections.push(`## PROJECT META\n${projInfo.join("\n")}`);

    if (pc.ideaSummary) sections.push(`## IDEA SUMMARY\n${pc.ideaSummary}`);
    if (pc.priorArtResults) sections.push(`## PRIOR ART\n${pc.priorArtResults}`);
    if (pc.whiteSpaceAnalysis) sections.push(`## WHITE SPACE\n${pc.whiteSpaceAnalysis}`);
    if (pc.provisionalDraftStatus) sections.push(`## PROVISIONAL DRAFT\n${pc.provisionalDraftStatus}`);
    if (pc.specificKeyConcepts?.length) {
      const preview = pc.specificKeyConcepts.slice(0, 3).join("\n\n");
      const more = pc.specificKeyConcepts.length - 3;
      sections.push(
        `## SPECIFIC CLAIMS (${pc.specificKeyConcepts.length} total)\n${preview}${
          more > 0 ? `\n\n[...and ${more} more]` : ""
        }`,
      );
    }
    if (pc.broaderClaims?.length) {
      sections.push(`## BROADER CLAIMS (${pc.broaderClaims.length} total)\n${pc.broaderClaims.slice(0, 2).join("\n\n")}`);
    }
  }

  if (persistent) {
    sections.push(
      `## POHC + LEAP LOG (${log.length} entries)\n${
        log.length === 0
          ? "(empty)"
          : log
              .map(
                (e) =>
                  `- [${e.entryType.toUpperCase()}] (${e.capturedAt?.toISOString?.() ?? ""}) id=${e.id}: ${
                    e.editedText ?? e.verbatimText
                  }`,
              )
              .join("\n")
      }`,
    );
    sections.push(
      `## CURRENT ARTICULATION (v${latestArticulation?.version ?? 0})\n${latestArticulation?.content ?? "(none yet)"}`,
    );
    sections.push(
      `## OPEN QUESTIONS (${openQs.length})\n${
        openQs.length === 0 ? "(none)" : openQs.map((q) => `- id=${q.id}: ${q.question}`).join("\n")
      }`,
    );
  }

  const fullUserMessage = `${sections.join("\n\n")}\n\n## NEW USER MESSAGE\n${payload.message}`;

  // 3. Persist the user message first (so source ids exist for tool calls)
  let userMsgId: string | null = null;
  if (persistent) {
    const [userMsg] = await db
      .insert(coachMessages)
      .values({
        projectId: projectId!,
        role: "user",
        content: payload.message,
      })
      .returning();
    userMsgId = userMsg.id;
  }

  // 4. Build Gemini history
  const geminiHistory = recentChrono.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // 5. Stream from Gemini, yielding tokens as they arrive
  const collectedTokens: string[] = [];
  const collectedToolCalls: ToolCall[] = [];
  let usedFallback = false;

  try {
    const stream = await gemini.models.generateContentStream({
      model: CONFIG.model,
      contents: [...geminiHistory, { role: "user", parts: [{ text: fullUserMessage }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: CONFIG.temperature,
        topP: CONFIG.topP,
        maxOutputTokens: CONFIG.maxTokens,
        safetySettings: GEMINI_SAFETY_OFF,
        ...(CONFIG.toolsEnabled
          ? { tools: [{ functionDeclarations: TOOL_DECLARATIONS as any }] }
          : {}),
      },
    });

    for await (const chunk of stream) {
      const t = (chunk as any).text;
      if (t) {
        collectedTokens.push(t);
        yield { type: "token", data: { delta: t } };
      }
      const calls = (chunk as any).functionCalls;
      if (Array.isArray(calls)) {
        for (const c of calls) collectedToolCalls.push({ name: c.name, args: c.args ?? {} });
      }
    }
  } catch (geminiErr: any) {
    console.warn(`[QA-Assistant] Gemini failed, falling back to ${CONFIG.fallback}:`, geminiErr?.message);
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
      collectedTokens.push(text);
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
  }

  const fullText = collectedTokens.join("").trim();

  // 6. Persist the assistant message (and execute tool calls against its id)
  let assistantMessageId: string | null = null;
  if (persistent) {
    const [assistantMsg] = await db
      .insert(coachMessages)
      .values({
        projectId: projectId!,
        role: "assistant",
        content: fullText,
        toolCalls: collectedToolCalls.length ? (collectedToolCalls as any) : null,
      })
      .returning();
    assistantMessageId = assistantMsg.id;

    const results: ToolResult[] = [];
    for (const call of collectedToolCalls) {
      const r = await executeTool(call, projectId!, assistantMsg.id);
      results.push(r);
      yield { type: "tool-result", data: r };
    }
    if (results.length) {
      await db
        .update(coachMessages)
        .set({
          toolCalls: collectedToolCalls.map((c, i) => ({ ...c, result: results[i] })) as any,
        })
        .where(eq(coachMessages.id, assistantMsg.id));
    }
  }

  yield {
    type: "done",
    data: {
      userMessageId: userMsgId,
      assistantMessageId,
      usedFallback,
    },
  };
}

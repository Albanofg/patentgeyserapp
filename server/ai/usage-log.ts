/**
 * AI usage logging.
 *
 * Every server-side AI call across the app funnels through `recordUsage()`.
 * Rows land in `inventor_geyser.ai_usage_log`. The admin /admin/usage page
 * reads them back; nothing else does.
 *
 * The function is intentionally fire-and-forget: callers `await` it but a
 * thrown error is caught and logged to stderr only. A failing log must never
 * break an AI request — the worst case is one missing row in the audit trail.
 */

import { db } from "../db";
import { aiUsageLog } from "@shared/schema";

// User-friendly labels for each agent. Keys are stable codes that the
// callers pass in; values are what shows up in the admin table.
// Add new entries when you wire a new agent into callAgent/qa-assistant.
const AGENT_LABELS: Record<string, string> = {
  "module0/qa-assistant": "AI Helper",
  "module1/1a-debate-advocate": "Brainstorm Advocate (Stage 1a)",
  "module1/1a-debate-examiner": "Brainstorm Examiner (Stage 1a)",
  "module1/1b-reanalyze-advocate": "Re-analyze Advocate (Stage 1b)",
  "module1/1b-reanalyze-examiner": "Re-analyze Examiner (Stage 1b)",
  "module1/1c-r3-fixes": "Mechanical Fixes (Stage 1c)",
  "module1/1d-list-maker": "List Maker (Stage 1d)",
  "module1/1d-filter": "Idea Filter (Stage 1d)",
  "module1/1e-ai-modifier": "AI Modifier (Stage 1b)",
  "module1/1f-examiner-review": "Examiner Review (Stage 1f)",
  "module2/2a-draft": "Provisional Draft (Stage 2a)",
  "module2/2b-extractor": "Concept Extractor (Stage 2b)",
  "module2/2b-refiner": "Concept Refiner (Stage 2b)",
  "module4/4a-whitespace": "Whitespace Analysis (Stage 4a)",
  "module4/4b-key-concepts": "Key Concept Generation (Stage 4b)",
  "module4/4c-pannu-questions": "Pannu Questions (Stage 4c)",
  "module4/4c-pannu-scorer": "Pannu Scorer (Stage 4c)",
  "module4/4d-suggestion": "Pannu Suggestion (Stage 4d)",
  "module5/5a-title": "Title (Stage 5a)",
  "module5/5a-abstract": "Abstract (Stage 5a)",
  "module5/5a-abstract-fixer": "Abstract Fixer (Stage 5a)",
  "module5/5a-background": "Background (Stage 5a)",
  "module5/5a-data-structures": "Data Structures (Stage 5a)",
  "module5/5a-operations": "Operations (Stage 5a)",
  "module5/5a-alternatives": "Alternatives (Stage 5a)",
  "module5/5a-architecture": "Architecture (Stage 5a)",
  "module5/5a-ramifications": "Ramifications (Stage 5a)",
  "module5/5a-summary": "Summary (Stage 5a)",
  "module5/5b-planner": "Diagram Planner (Stage 5b)",
  "module5/5c-spec-reader": "Spec Reader (Stage 5c)",
  "module5/5c-strategist": "Key Concept Strategist (Stage 5c)",
  "module5/5c-drafter": "Key Concept Drafter (Stage 5c)",
};

/** Map a stable code to a human-readable label. Unknown codes pass through. */
export function labelForAgent(code: string): string {
  return AGENT_LABELS[code] ?? code;
}

export type UsageStatus = "ok" | "retry" | "fallback" | "error";

export interface RecordUsageInput {
  userId?: string | null;
  userEmail?: string | null;
  projectId?: string | null;
  agentCode: string;              // stable code (looked up in AGENT_LABELS)
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  status: UsageStatus;
  fallbackFrom?: string | null;
  usedSecondaryKey?: boolean;
  requestId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, any> | null;
}

/**
 * Insert one usage row. Never throws — failures are logged and swallowed so
 * a broken usage table cannot take down an AI call.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  try {
    await db.insert(aiUsageLog).values({
      userId: input.userId ?? null,
      userEmail: input.userEmail ?? null,
      projectId: input.projectId ?? null,
      agentLabel: labelForAgent(input.agentCode),
      model: input.model,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      cachedTokens: input.cachedTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      durationMs: input.durationMs ?? null,
      status: input.status,
      fallbackFrom: input.fallbackFrom ?? null,
      usedSecondaryKey: input.usedSecondaryKey ?? false,
      requestId: input.requestId ?? null,
      errorMessage: input.errorMessage ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (err: any) {
    console.warn("[ai-usage-log] insert failed:", err?.message ?? err);
  }
}

/**
 * Pull token counts out of whatever the SDK handed us. Both Gemini's
 * `usageMetadata` and OpenAI's `usage` are inconsistent across versions and
 * sometimes missing entirely, so we normalize defensively here.
 */
export function extractGeminiUsage(response: any): {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
} {
  const u = response?.usageMetadata ?? response?.response?.usageMetadata ?? {};
  return {
    inputTokens: numOrNull(u.promptTokenCount),
    outputTokens: numOrNull(u.candidatesTokenCount),
    cachedTokens: numOrNull(u.cachedContentTokenCount),
    totalTokens: numOrNull(u.totalTokenCount),
  };
}

export function extractOpenAIUsage(response: any): {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
} {
  const u = response?.usage ?? {};
  const cached =
    u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? null;
  return {
    inputTokens: numOrNull(u.prompt_tokens),
    outputTokens: numOrNull(u.completion_tokens),
    cachedTokens: numOrNull(cached),
    totalTokens: numOrNull(u.total_tokens),
  };
}

function numOrNull(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

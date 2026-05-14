import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface DraftPayload {
  sessionId?: string;
  ideaSummary: string;
  goodCopInsights?: unknown;
  badCopChallenges?: unknown;
  fullTranscript?: string;
  additionalNotes?: string;
  refinementFeedback?: string;
  idea?: string;
  category?: string;
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join("\n\n");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export async function runDraft(payload: DraftPayload) {
  console.log(">>> [M2 DRAFT] <<< Generating provisional draft");

  try {
    const config = loadAgentConfig("module2/2a-draft/draft.config.json");
    const systemPrompt = loadPrompt("module2/2a-draft/draft.md");

    const userMessage =
      `IDEA SUMMARY:\n${stringify(payload.ideaSummary)}\n\n` +
      `GOOD COP ANALYSIS:\n${stringify(payload.goodCopInsights)}\n\n` +
      `BAD COP ANALYSIS:\n${stringify(payload.badCopChallenges)}\n\n` +
      `FULL TRANSCRIPT:\n${stringify(payload.fullTranscript)}\n\n` +
      `REFINEMENT FEEDBACK:\n${stringify(payload.refinementFeedback)}\n\n` +
      `Your task is to evaluate all five sections.\nUse them exactly as provided.\nDo not infer priority.\nThe system message contains the authority rules and conflict resolution logic.`;

    const provisionalDraft = await callAgent({ systemPrompt, userMessage, config, usage: { agentCode: "module2/2a-draft" } });

    console.log(`>>> [M2 DRAFT] <<< Done — ${provisionalDraft.length} chars`);

    return {
      success: true as const,
      provisionalDraft,
      idea: payload.idea ?? payload.ideaSummary,
      category: payload.category || "software",
      metadata: {
        timestamp: new Date().toISOString(),
        wordCount: provisionalDraft.split(/\s+/).filter(Boolean).length,
        draftType: "provisional",
      },
    };
  } catch (error: any) {
    console.error(">>> [M2 DRAFT] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message.includes("empty") || message.includes("no response")
        ? "AI service returned an empty response. Please try again."
        : message || "Provisional draft generation failed";
    return {
      success: false as const,
      error: errorMessage,
    };
  }
}

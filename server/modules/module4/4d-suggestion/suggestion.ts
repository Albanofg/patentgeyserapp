import { callAgentJSON, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface SuggestionPayload {
  keyConceptText: string;
  question: string;
  factor: "conception" | "quality" | "known_concepts" | string;
  userDraft?: string;
}

const FACTOR_DEFINITIONS: Record<string, string> = {
  conception:
    "Conception - This factor evaluates independent conception of the invention. Focus on how the inventor independently thought of and developed this specific technical solution.",
  quality:
    "Contribution Quality - This factor evaluates the significance and substantiality of the contribution. Focus on how meaningful and substantial this contribution is to the invention.",
  known_concepts:
    "Exceeding Known Concepts - This factor evaluates whether the contribution goes beyond known concepts. Focus on what makes this solution novel compared to existing knowledge.",
};

interface RephraserResult {
  rephrased_answer: string;
  insufficient: boolean;
  missing: string[];
}

export async function runPannuSuggestion(payload: SuggestionPayload) {
  console.log(">>> [M4-4c PANNU/REPHRASER] <<< factor:", payload.factor);

  try {
    const config = loadAgentConfig("module4/4d-suggestion/suggestion.config.json");
    const systemPrompt = loadPrompt("module4/4c-pannu/answer-rephraser.md");

    const factorKey = (payload.factor in FACTOR_DEFINITIONS ? payload.factor : "conception") as keyof typeof FACTOR_DEFINITIONS;
    const factorDefinition = FACTOR_DEFINITIONS[factorKey];

    const draft = (payload.userDraft || "").trim();
    const sources: Array<{ source: string; text: string }> = [];
    if (payload.question) sources.push({ source: "pannu/question", text: payload.question });

    const rephraserInput = {
      claim_text: payload.keyConceptText || "",
      factor: factorKey,
      factor_definition: factorDefinition,
      user_draft: draft,
      sources,
    };

    const parsed = await callAgentJSON<RephraserResult>({
      systemPrompt,
      userMessage: JSON.stringify(rephraserInput),
      config,
      usage: { agentCode: "module4/4c-pannu-rephraser" },
    });

    const suggestion = parsed.insufficient
      ? (parsed.missing?.length
          ? `Insufficient material to draft an answer. Please add:\n- ${parsed.missing.join("\n- ")}`
          : "Insufficient material to draft an answer.")
      : (parsed.rephrased_answer || "").trim();

    return {
      success: true as const,
      response: suggestion,
      suggestion,
      factor: payload.factor,
      insufficient: !!parsed.insufficient,
      missing: parsed.missing || [],
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(">>> [M4-4c PANNU/REPHRASER] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message || "Pannu rephraser failed";
    return { success: false as const, error: errorMessage };
  }
}

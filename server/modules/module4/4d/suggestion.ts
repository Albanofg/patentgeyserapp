import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface SuggestionPayload {
  keyConceptText: string;
  question: string;
  factor: "conception" | "quality" | "known_concepts" | string;
}

const FACTOR_CONTEXT: Record<string, string> = {
  conception:
    "Conception - This factor evaluates independent conception of the invention. Focus on how the inventor independently thought of and developed this specific technical solution.",
  quality:
    "Contribution Quality - This factor evaluates the significance and substantiality of the contribution. Focus on how meaningful and substantial this contribution is to the invention.",
  known_concepts:
    "Exceeding Known Concepts - This factor evaluates whether the contribution goes beyond known concepts. Focus on what makes this solution novel compared to existing knowledge.",
};

export async function runPannuSuggestion(payload: SuggestionPayload) {
  console.log(">>> [M4-4d PANNU/SUGGESTION] <<< factor:", payload.factor);

  try {
    const config = loadAgentConfig("module4/4d/suggestion.config.json");
    const systemPrompt = loadPrompt("module4/4d/suggestion.md");

    const contextDescription = FACTOR_CONTEXT[payload.factor] || "General Pannu Test Factor";

    const userMessage =
      `You are helping evaluate a patent claim under the Pannu test.\n\n` +
      `Factor: ${contextDescription}\n\n` +
      `Claim Text:\n${payload.keyConceptText || ""}\n\n` +
      `Question to Answer:\n${payload.question || ""}\n\n` +
      `Please provide a professional, thoughtful response that directly addresses this specific Pannu factor. Your response should be clear, concise, and helpful for patent documentation purposes.`;

    const response = await callAgent({ systemPrompt, userMessage, config });

    return {
      success: true as const,
      response: response.trim(),
      suggestion: response.trim(),
      factor: payload.factor,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(">>> [M4-4d PANNU/SUGGESTION] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message || "Pannu AI suggestion failed";
    return { success: false as const, error: errorMessage };
  }
}

import { callAgentJSON, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface ExtractConceptsPayload {
  sessionId?: string;
  detailedConcept: string;
  codeFromTheUser?: string;
  category?: string;
}

interface IdeasPayload {
  ideas?: string[];
  concepts?: string[];
}

function normalizeIdeas(raw: IdeasPayload | null | undefined): string[] {
  if (!raw) return [];
  const list = raw.ideas ?? raw.concepts ?? [];
  return list.map((s) => (typeof s === "string" ? s.trim() : String(s).trim())).filter(Boolean);
}

export async function runExtractConcepts(payload: ExtractConceptsPayload) {
  console.log(">>> [M2-2b EXTRACT-CONCEPTS] <<< extractor + refiner pipeline");

  try {
    // Stage 1: extract atomic technical concepts
    const extractorConfig = loadAgentConfig("module2/2b/extractor.config.json");
    const extractorSystem = loadPrompt("module2/2b/extractor.md");
    const extractorUserMessage =
      `Here's the detailed concept:\n${payload.detailedConcept}\n\n` +
      `Here's some code the user gives you so you can understand how it works (if it's empty, it means the user did not add any code):\n${payload.codeFromTheUser || " "}`;

    const extractorRaw = await callAgentJSON<IdeasPayload>({
      systemPrompt: extractorSystem,
      userMessage: extractorUserMessage,
      config: extractorConfig,
    });
    const extracted = normalizeIdeas(extractorRaw);

    console.log(`>>> [M2-2b EXTRACT-CONCEPTS] <<< extractor produced ${extracted.length} concepts`);

    if (extracted.length === 0) {
      return {
        success: false as const,
        error: "Extractor returned no concepts. Please try again.",
      };
    }

    // Stage 2: refine to the strongest big ideas
    const refinerConfig = loadAgentConfig("module2/2b/refiner.config.json");
    const refinerSystem = loadPrompt("module2/2b/refiner.md");
    const refinerUserMessage =
      `PROPOSED CONCEPTS (JSON):\n${JSON.stringify({ ideas: extracted })}\n\n` +
      `ORIGINAL DETAILED CONCEPT (for context only — do not add new ideas):\n${payload.detailedConcept}`;

    const refinerRaw = await callAgentJSON<IdeasPayload>({
      systemPrompt: refinerSystem,
      userMessage: refinerUserMessage,
      config: refinerConfig,
    });
    const refined = normalizeIdeas(refinerRaw);

    console.log(`>>> [M2-2b EXTRACT-CONCEPTS] <<< refiner kept ${refined.length}/${extracted.length}`);

    const finalIdeas = refined.length > 0 ? refined : extracted;

    return {
      success: true as const,
      ideas: finalIdeas,
      totalConcepts: finalIdeas.length,
    };
  } catch (error: any) {
    console.error(">>> [M2-2b EXTRACT-CONCEPTS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message.includes("Failed to parse AI response as JSON")
        ? "AI service returned invalid JSON. Please try again."
        : message || "Concept extraction failed";
    return {
      success: false as const,
      error: errorMessage,
    };
  }
}

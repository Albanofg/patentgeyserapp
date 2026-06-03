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
    const extractorConfig = loadAgentConfig("module2/2b-extract-concepts/extractor.config.json");
    const extractorSystem = loadPrompt("module2/2b-extract-concepts/extractor.md");
    const extractorUserMessage =
      `Here's the detailed concept:\n${payload.detailedConcept}\n\n` +
      `Here's some code the user gives you so you can understand how it works (if it's empty, it means the user did not add any code):\n${payload.codeFromTheUser || " "}`;

    const extractorRaw = await callAgentJSON<IdeasPayload>({
      systemPrompt: extractorSystem,
      userMessage: extractorUserMessage,
      config: extractorConfig,
      usage: { agentCode: "module2/2b-extractor" },
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
    const refinerConfig = loadAgentConfig("module2/2b-extract-concepts/refiner.config.json");
    const refinerSystem = loadPrompt("module2/2b-extract-concepts/refiner.md");
    const refinerUserMessage =
      `PROPOSED CONCEPTS (JSON):\n${JSON.stringify({ ideas: extracted })}\n\n` +
      `ORIGINAL DETAILED CONCEPT (for context only — do not add new ideas):\n${payload.detailedConcept}`;

    const refinerRaw = await callAgentJSON<IdeasPayload>({
      systemPrompt: refinerSystem,
      userMessage: refinerUserMessage,
      config: refinerConfig,
      usage: { agentCode: "module2/2b-refiner" },
    });
    const refined = normalizeIdeas(refinerRaw);

    console.log(`>>> [M2-2b EXTRACT-CONCEPTS] <<< refiner kept ${refined.length}/${extracted.length}`);

    const finalIdeas = refined.length > 0 ? refined : extracted;

    // ─── Compute the filtered set (extractor output minus surviving) ────────
    // The refiner's contract (default-to-rejection + skepticism) routinely
    // culls 85–95% of extractor candidates. Historically the dropped items
    // disappeared with no trace, so an inventor who disagreed with the
    // refiner's judgment on a specific concept had to retype it manually as
    // a "custom idea." Now we return the filtered list alongside the
    // surviving list so the UI can surface it as a "removed during
    // refinement" tray with per-item Restore buttons.
    //
    // Matching is normalized — the refiner's LAW_6_NO_REPHRASING_FOR_STRENGTH
    // allows "minor grammatical normalization … when the original wording is
    // malformed." That means a surviving item may have whitespace or
    // punctuation differences vs. the extractor original. We match on
    // lowercased + whitespace-collapsed text so those benign edits don't
    // falsely mark a surviving idea as filtered. When the refiner returned
    // nothing (and we fell back to `extracted`), the filtered list is
    // empty by definition.
    const normalizeForMatch = (s: string): string =>
      s.toLowerCase().replace(/\s+/g, " ").trim();
    const survivingKeys = new Set(finalIdeas.map(normalizeForMatch));
    const filteredIdeas =
      refined.length > 0
        ? extracted.filter((idea) => !survivingKeys.has(normalizeForMatch(idea)))
        : [];

    if (filteredIdeas.length > 0) {
      console.log(
        `>>> [M2-2b EXTRACT-CONCEPTS] <<< ${filteredIdeas.length} concept(s) filtered out, available for inventor restore`,
      );
    }

    return {
      success: true as const,
      ideas: finalIdeas,
      filteredIdeas,
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

import { callAgentJSON, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface SelectedIdea {
  id?: string;
  text?: string;
  title?: string;
  description?: string;
  name?: string;
}

interface PriorArtPatent {
  publicationNumber: string;
  title?: string;
  summary?: string;
  relevanceScore?: number | string;
}

interface PriorArtResult {
  conceptId?: string;
  conceptTitle?: string;
  priorArt?: PriorArtPatent[];
}

interface WhitespacePayload {
  sessionId?: string;
  category?: string;
  expandedConcept?: string;
  selectedIdeas: SelectedIdea[];
  priorArtResults: PriorArtResult[];
}

// Shape emitted by the current whitespace.md prompt: mechanism extraction +
// clarification questions for the inventor. No risk/threat assessment.
interface NewPatentAnalysis {
  patentNumber: string;
  patentTitle: string;
  patentStatus: "GRANTED" | "PENDING";
  extractedMechanisms: string[];
  inventorClarificationQuestions: string[];
}

interface AnalyzerJson {
  totalPatentsAnalyzed?: number;
  patentAnalyses?: NewPatentAnalysis[];
  crossPatentClarificationQuestions?: string[];
}

// Backwards-compatible shape produced by `runWhitespace` for downstream
// consumers (claims agent, UI). The legacy risk/threat/strategy fields are
// preserved so nothing breaks, but they're filled with defaults since the
// new prompt is intentionally factual-only and produces no strategic content.
interface PatentAnalysis {
  patentNumber: string;
  patentTitle: string;
  patentStatus: "GRANTED" | "PENDING";
  threatLevel: "High" | "Medium" | "Low" | "Minimal";
  specificConstraint: string;
  differentiationStrategy: string;
  canDesignAround: boolean;
  // New fields surfaced from the rewritten prompt — additive, so older code
  // that only reads the legacy fields is unaffected.
  extractedMechanisms?: string[];
  inventorClarificationQuestions?: string[];
}

// Schema matching the rewritten prompt's PHASE_6 contract. The earlier
// legacy schema was removed because it forced fields the prompt now
// forbids; this one mirrors the new shape so the Gemini API enforces
// valid JSON structure without overriding the prompt's content rules.
const WHITESPACE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    totalPatentsAnalyzed: { type: "integer" },
    patentAnalyses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          patentNumber: { type: "string" },
          patentTitle: { type: "string" },
          patentStatus: { type: "string", enum: ["GRANTED", "PENDING"] },
          extractedMechanisms: { type: "array", items: { type: "string" } },
          inventorClarificationQuestions: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "patentNumber",
          "patentTitle",
          "patentStatus",
          "extractedMechanisms",
          "inventorClarificationQuestions",
        ],
      },
    },
    crossPatentClarificationQuestions: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "totalPatentsAnalyzed",
    "patentAnalyses",
    "crossPatentClarificationQuestions",
  ],
} as const;

function matchPriorArt(
  idea: SelectedIdea,
  priorArtResults: PriorArtResult[],
  index: number,
): PriorArtResult | null {
  // 1. match by conceptId === id
  if (idea.id) {
    const byId = priorArtResults.find((pa) => pa.conceptId === idea.id);
    if (byId) return byId;
  }
  // 2. match by index position
  if (priorArtResults[index]) return priorArtResults[index];
  // 3. match by title similarity
  const searchText = (idea.text || idea.title || "").toLowerCase().substring(0, 40);
  if (searchText) {
    const byTitle = priorArtResults.find(
      (pa) => pa.conceptTitle && pa.conceptTitle.toLowerCase().includes(searchText),
    );
    if (byTitle) return byTitle;
  }
  return null;
}

function buildUserMessage(nugget: {
  nuggetTitle: string;
  nuggetDescription: string;
  expandedConcept: string;
  priorArt: PriorArtPatent[];
}): string {
  const { nuggetTitle, nuggetDescription, expandedConcept, priorArt } = nugget;
  const priorArtBlock = priorArt.length
    ? priorArt
        .map((pa, idx) => {
          const pn = pa.publicationNumber || "";
          const granted = pn.endsWith("-B1") || pn.endsWith("-B2");
          return (
            `---\nPATENT ${idx + 1} of ${priorArt.length}:\n` +
            `  Publication Number: ${pn}\n` +
            `  Title: ${pa.title || ""}\n` +
            `  Summary: ${pa.summary || ""}\n` +
            `  Relevance Score: ${pa.relevanceScore ?? ""}\n` +
            `  Status: ${granted ? "GRANTED (Infringement Risk)" : "PENDING (Disclosure Risk)"}`
          );
        })
        .join("\n\n")
    : "No prior art found for this concept.";

  return (
    `Analyze this inventive concept against ALL of the following prior art patents:\n\n` +
    `**Inventive Concept (Nugget):**\n` +
    `Title: ${nuggetTitle}\n` +
    `Description: ${nuggetDescription || "No additional description provided"}\n\n` +
    `**Full Invention Context:**\n${expandedConcept}\n\n` +
    `**Prior Art Patents to Analyze (${priorArt.length} total):**\n${priorArtBlock}\n\n` +
    `**CRITICAL: You must analyze EACH patent listed above and include it in your response.**\n\n` +
    `**Your Task:**\nConduct a rigorous differential analysis against EVERY patent listed. For each patent, determine if it creates a constraint on our claims. Return ONLY a JSON object with your comprehensive analysis.`
  );
}

function riskEmoji(level?: string): string {
  return level === "Green" ? "🟢" : level === "Yellow" ? "🟡" : level === "Red" ? "🔴" : "⚪";
}

function threatEmoji(level?: string): string {
  return level === "High" ? "🔴" : level === "Medium" ? "🟡" : "🟢";
}

function buildStrategicDirective(sessionId: string, conceptAnalyses: any[]): string {
  let md = "# Prior Art Mechanism Surfacer — Inventor Clarification Brief\n\n";
  md += `**Analysis Date:** ${new Date().toISOString().split("T")[0]}\n`;
  md += `**Session ID:** ${sessionId}\n`;
  md += `**Total Concepts Analyzed:** ${conceptAnalyses.length}\n\n`;

  md += "## Executive Summary\n\n";
  md += "| # | Concept Title | Patents Analyzed | Clarification Questions |\n";
  md += "|---|---------------|------------------|-------------------------|\n";
  conceptAnalyses.forEach((c, i) => {
    const qCount = (c.patentAnalyses || []).reduce(
      (sum: number, pa: PatentAnalysis) => sum + (pa.inventorClarificationQuestions?.length || 0),
      0,
    ) + (c.crossPatentClarificationQuestions?.length || 0);
    md += `| ${i + 1} | ${c.conceptTitle} | ${c.totalPatentsAnalyzed} | ${qCount} |\n`;
  });
  md += "\n---\n\n";

  conceptAnalyses.forEach((c, i) => {
    md += `## Concept ${i + 1}: ${c.conceptTitle}\n\n`;
    if (c.conceptDescription) md += `> ${c.conceptDescription}\n\n`;

    if (c.patentAnalyses?.length > 0) {
      md += `### Prior Art — Extracted Mechanisms and Inventor Questions\n\n`;
      c.patentAnalyses.forEach((pa: PatentAnalysis, j: number) => {
        md += `#### ${j + 1}. ${pa.patentNumber}\n`;
        md += `* **Title:** ${pa.patentTitle}\n`;
        md += `* **Status:** ${pa.patentStatus}\n`;
        const mechs = pa.extractedMechanisms || [];
        if (mechs.length > 0) {
          md += `* **Extracted Mechanisms:**\n`;
          mechs.forEach((m) => {
            md += `  - ${m}\n`;
          });
        }
        const qs = pa.inventorClarificationQuestions || [];
        if (qs.length > 0) {
          md += `* **Inventor Clarification Questions:**\n`;
          qs.forEach((q) => {
            md += `  - ${q}\n`;
          });
        }
        md += "\n";
      });
    } else {
      md += `### Prior Art — Extracted Mechanisms and Inventor Questions\n\n*No prior art patents were found for this concept.*\n\n`;
    }

    const crossQs = c.crossPatentClarificationQuestions || [];
    if (crossQs.length > 0) {
      md += `### Cross-Patent Clarification Questions\n\n`;
      crossQs.forEach((q: string) => {
        md += `- ${q}\n`;
      });
      md += "\n";
    }

    md += "---\n\n";
  });

  return md;
}

// Kept exported-as-unused so the helpers stay available if a future
// re-introduction of risk classification wants them. Not currently called.
void riskEmoji;
void threatEmoji;

export async function runWhitespace(payload: WhitespacePayload) {
  console.log(">>> [M4-4a WHITESPACE] <<< analyzing", payload.selectedIdeas?.length, "concepts");

  try {
    if (!Array.isArray(payload.selectedIdeas) || payload.selectedIdeas.length === 0) {
      return { success: false as const, error: "No selected ideas provided." };
    }
    if (!Array.isArray(payload.priorArtResults)) {
      return { success: false as const, error: "Missing priorArtResults." };
    }

    const config = loadAgentConfig("module4/4a/whitespace.config.json");
    const systemPrompt = loadPrompt("module4/4a/whitespace.md");

    const nuggetInputs = payload.selectedIdeas.map((idea, index) => {
      const matched = matchPriorArt(idea, payload.priorArtResults, index);
      const priorArt = matched?.priorArt || [];
      const nuggetTitle =
        matched?.conceptTitle || idea.title || idea.text || idea.name || `Concept ${index + 1}`;
      return {
        index,
        nuggetId: idea.id || `concept-${index}`,
        nuggetTitle,
        nuggetDescription: idea.description || "",
        priorArt,
        priorArtCount: priorArt.length,
      };
    });

    // Run all concept analyses in parallel
    const analyses = await Promise.all(
      nuggetInputs.map(async (nugget) => {
        try {
          const userMessage = buildUserMessage({
            nuggetTitle: nugget.nuggetTitle,
            nuggetDescription: nugget.nuggetDescription,
            expandedConcept: payload.expandedConcept || "",
            priorArt: nugget.priorArt,
          });
          const parsed = await callAgentJSON<AnalyzerJson>({
            systemPrompt,
            userMessage,
            config,
            responseSchema: WHITESPACE_RESPONSE_SCHEMA as unknown as Record<string, any>,
            usage: { agentCode: "module4/4a-whitespace" },
            // Per-call cap so a single hung Gemini stream cannot burn the whole
            // 300s function budget (see prior orphaned-timeout incident).
            timeoutMs: 90_000,
          });
          return { nugget, parsed, parseError: null as string | null };
        } catch (err: any) {
          console.error(
            `>>> [M4-4a WHITESPACE] <<< concept "${nugget.nuggetTitle}" failed:`,
            err.message,
          );
          return { nugget, parsed: null, parseError: err.message || String(err) };
        }
      }),
    );

    // Shape into conceptAnalyses[]. Bridges the new mechanism-extraction
    // prompt output to the legacy field layout downstream consumers expect.
    // Legacy fields (threatLevel, specificConstraint, etc.) get filled from
    // the new fields where mappable and with neutral defaults otherwise —
    // the prompt is fact-only by design, so risk/threat/strategy stay empty.
    const conceptAnalyses = analyses.map(({ nugget, parsed, parseError }) => {
      const p: AnalyzerJson = parsed || {};
      const newPatents = p.patentAnalyses || [];

      // Map each new-shape patent entry to the legacy shape used by claims/UI.
      const bridgedPatentAnalyses: PatentAnalysis[] = newPatents.map((np) => ({
        patentNumber: np.patentNumber,
        patentTitle: np.patentTitle,
        patentStatus: np.patentStatus,
        // Risk fields no longer produced by the prompt; default neutral.
        threatLevel: "Minimal",
        // Surface the first extracted mechanism as the "specific constraint"
        // so the claims agent has a concrete textual hook to work with.
        specificConstraint: (np.extractedMechanisms || [])[0] || "",
        // Differentiation strategy is now framed as the first clarification
        // question to the inventor — preserves the per-patent text slot.
        differentiationStrategy:
          (np.inventorClarificationQuestions || [])[0] ||
          "Awaiting inventor clarification.",
        canDesignAround: true,
        extractedMechanisms: np.extractedMechanisms || [],
        inventorClarificationQuestions: np.inventorClarificationQuestions || [],
      }));

      // The new prompt is fact-only — it doesn't produce a strategy, list
      // differentiators, or write claim-drafting guidance. We pass cross-
      // patent questions through to the strategy slot for the claims agent
      // to consume, but leave the other two slots empty so the UI doesn't
      // render placeholder sections.
      const crossQuestions = p.crossPatentClarificationQuestions || [];
      const whiteSpaceStrategy = crossQuestions.length
        ? crossQuestions.join(" ")
        : parseError
          ? `Analysis unavailable for this concept: ${parseError}`
          : "";

      return {
        conceptNumber: nugget.index + 1,
        conceptId: nugget.nuggetId,
        conceptTitle: nugget.nuggetTitle,
        conceptDescription: nugget.nuggetDescription,
        overallRiskLevel: parseError ? "Error - Parse Failed" : "Unknown",
        totalPatentsAnalyzed: p.totalPatentsAnalyzed ?? newPatents.length,
        priorArtInputCount: nugget.priorArtCount,
        threatCounts: { high: 0, medium: 0, low: 0 },
        patentAnalyses: bridgedPatentAnalyses,
        crossPatentClarificationQuestions: crossQuestions,
        strategy: {
          whiteSpaceStrategy,
          primaryDifferentiators: [],
          claimDraftingGuidance: parseError
            ? "Manual review required — model output could not be parsed for this concept. Re-run the stage to retry."
            : "",
        },
      };
    });

    const sessionId = payload.sessionId || "unknown";
    const strategicDirective = buildStrategicDirective(sessionId, conceptAnalyses);

    const summary = {
      totalConceptsAnalyzed: conceptAnalyses.length,
      totalPatentsAnalyzed: conceptAnalyses.reduce(
        (sum, a) => sum + (a.totalPatentsAnalyzed || 0),
        0,
      ),
      totalHighThreats: conceptAnalyses.reduce(
        (sum, a) => sum + (a.threatCounts.high || 0),
        0,
      ),
      riskDistribution: {
        green: conceptAnalyses.filter((a) => a.overallRiskLevel === "Green").length,
        yellow: conceptAnalyses.filter((a) => a.overallRiskLevel === "Yellow").length,
        red: conceptAnalyses.filter((a) => a.overallRiskLevel === "Red").length,
      },
      conceptTitles: conceptAnalyses.map((a) => a.conceptTitle),
    };

    console.log(
      `>>> [M4-4a WHITESPACE] <<< done — ${summary.totalConceptsAnalyzed} concepts, ${summary.totalPatentsAnalyzed} patents, ${summary.totalHighThreats} high threats`,
    );

    return {
      success: true as const,
      sessionId,
      strategicDirective,
      conceptAnalyses,
      summary,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(">>> [M4-4a WHITESPACE] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message || "White space analysis failed";
    return { success: false as const, error: errorMessage };
  }
}

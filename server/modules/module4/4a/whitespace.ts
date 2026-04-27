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

interface PatentAnalysis {
  patentNumber: string;
  patentTitle: string;
  patentStatus: "GRANTED" | "PENDING";
  threatLevel: "High" | "Medium" | "Low" | "Minimal";
  specificConstraint: string;
  differentiationStrategy: string;
  canDesignAround: boolean;
}

interface AnalyzerJson {
  overallRiskLevel?: "Green" | "Yellow" | "Red";
  totalPatentsAnalyzed?: number;
  highThreatCount?: number;
  mediumThreatCount?: number;
  lowThreatCount?: number;
  patentAnalyses?: PatentAnalysis[];
  consolidatedWhiteSpaceStrategy?: string;
  primaryDifferentiators?: string[];
  claimDraftingGuidance?: string;
}

// Mirrors AnalyzerJson and the JSON shape declared in whitespace.md.
// Passed to Gemini as responseSchema so the model is API-constrained to valid
// JSON — no markdown fences, no trailing prose, properly escaped strings.
const WHITESPACE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    overallRiskLevel: { type: "string", enum: ["Green", "Yellow", "Red"] },
    totalPatentsAnalyzed: { type: "integer" },
    highThreatCount: { type: "integer" },
    mediumThreatCount: { type: "integer" },
    lowThreatCount: { type: "integer" },
    patentAnalyses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          patentNumber: { type: "string" },
          patentTitle: { type: "string" },
          patentStatus: { type: "string", enum: ["GRANTED", "PENDING"] },
          threatLevel: {
            type: "string",
            enum: ["High", "Medium", "Low", "Minimal"],
          },
          specificConstraint: { type: "string" },
          differentiationStrategy: { type: "string" },
          canDesignAround: { type: "boolean" },
        },
        required: [
          "patentNumber",
          "patentTitle",
          "patentStatus",
          "threatLevel",
          "specificConstraint",
          "differentiationStrategy",
          "canDesignAround",
        ],
      },
    },
    consolidatedWhiteSpaceStrategy: { type: "string" },
    primaryDifferentiators: { type: "array", items: { type: "string" } },
    claimDraftingGuidance: { type: "string" },
  },
  required: [
    "overallRiskLevel",
    "totalPatentsAnalyzed",
    "highThreatCount",
    "mediumThreatCount",
    "lowThreatCount",
    "patentAnalyses",
    "consolidatedWhiteSpaceStrategy",
    "primaryDifferentiators",
    "claimDraftingGuidance",
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
  let md = "# White Space Analysis - Strategic Directive for Claims Drafting\n\n";
  md += `**Analysis Date:** ${new Date().toISOString().split("T")[0]}\n`;
  md += `**Session ID:** ${sessionId}\n`;
  md += `**Total Concepts Analyzed:** ${conceptAnalyses.length}\n\n`;

  md += "## Executive Summary\n\n";
  md += "| # | Concept Title | Risk Level | Patents Analyzed | High Threats |\n";
  md += "|---|---------------|------------|------------------|--------------|\n";
  conceptAnalyses.forEach((c, i) => {
    md += `| ${i + 1} | ${c.conceptTitle} | ${riskEmoji(c.overallRiskLevel)} ${c.overallRiskLevel} | ${c.totalPatentsAnalyzed} | ${c.threatCounts.high} |\n`;
  });
  md += "\n---\n\n";

  conceptAnalyses.forEach((c, i) => {
    md += `## Concept ${i + 1}: ${c.conceptTitle}\n\n`;
    if (c.conceptDescription) md += `> ${c.conceptDescription}\n\n`;

    md += `### Overall Assessment\n`;
    md += `* **Risk Level:** ${riskEmoji(c.overallRiskLevel)} ${c.overallRiskLevel}\n`;
    md += `* **Patents Analyzed:** ${c.totalPatentsAnalyzed} (Input: ${c.priorArtInputCount})\n`;
    md += `* **Threat Distribution:** 🔴 High: ${c.threatCounts.high} | 🟡 Medium: ${c.threatCounts.medium} | 🟢 Low: ${c.threatCounts.low}\n\n`;

    if (c.patentAnalyses?.length > 0) {
      md += `### Prior Art Patent Analysis\n\n`;
      c.patentAnalyses.forEach((pa: PatentAnalysis, j: number) => {
        md += `#### ${j + 1}. ${pa.patentNumber} ${threatEmoji(pa.threatLevel)} ${pa.threatLevel}\n`;
        md += `* **Title:** ${pa.patentTitle}\n`;
        md += `* **Status:** ${pa.patentStatus}\n`;
        md += `* **Specific Constraint:** "${pa.specificConstraint}"\n`;
        md += `* **Differentiation Strategy:** ${pa.differentiationStrategy}\n`;
        md += `* **Can Design Around:** ${pa.canDesignAround ? "✅ Yes" : "❌ No"}\n\n`;
      });
    } else {
      md += `### Prior Art Patent Analysis\n\n*No prior art patents were found for this concept.*\n\n`;
    }

    md += `### Strategic Guidance\n\n`;
    md += `**White Space Strategy:**\n${c.strategy.whiteSpaceStrategy}\n\n`;
    if (c.strategy.primaryDifferentiators?.length > 0) {
      md += `**Primary Differentiators:**\n`;
      c.strategy.primaryDifferentiators.forEach((d: string, idx: number) => {
        md += `${idx + 1}. ${d}\n`;
      });
      md += "\n";
    }
    md += `**Claim Drafting Guidance:**\n${c.strategy.claimDraftingGuidance}\n\n`;
    md += "---\n\n";
  });

  return md;
}

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

    // Shape into conceptAnalyses[]
    const conceptAnalyses = analyses.map(({ nugget, parsed, parseError }) => {
      const p = parsed || {};
      return {
        conceptNumber: nugget.index + 1,
        conceptId: nugget.nuggetId,
        conceptTitle: nugget.nuggetTitle,
        conceptDescription: nugget.nuggetDescription,
        overallRiskLevel: p.overallRiskLevel || (parseError ? "Error - Parse Failed" : "Unknown"),
        totalPatentsAnalyzed: p.totalPatentsAnalyzed ?? (p.patentAnalyses?.length || 0),
        priorArtInputCount: nugget.priorArtCount,
        threatCounts: {
          high: p.highThreatCount || 0,
          medium: p.mediumThreatCount || 0,
          low: p.lowThreatCount || 0,
        },
        patentAnalyses: p.patentAnalyses || [],
        strategy: {
          whiteSpaceStrategy:
            p.consolidatedWhiteSpaceStrategy ||
            (parseError
              ? `Analysis unavailable for this concept: ${parseError}`
              : "No strategy generated."),
          primaryDifferentiators: p.primaryDifferentiators || [],
          claimDraftingGuidance:
            p.claimDraftingGuidance ||
            (parseError
              ? "Manual review required — model output could not be parsed for this concept. Re-run the stage to retry."
              : ""),
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

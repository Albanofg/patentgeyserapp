import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface SelectedIdea {
  id?: string;
  text?: string;
}

interface ConceptAnalysisLike {
  overallRiskLevel?: string;
  patentAnalyses?: Array<{
    patentNumber?: string;
    threatLevel?: string;
    specificConstraint?: string;
  }>;
  strategy?: {
    whiteSpaceStrategy?: string;
    primaryDifferentiators?: string[];
    claimDraftingGuidance?: string;
  };
  consolidatedWhiteSpaceStrategy?: string;
  primaryDifferentiators?: string[];
  claimDraftingGuidance?: string;
}

interface NuggetAnalysisLike {
  riskLevel?: string;
  constraint?: string;
  primaryPriorArt?: string;
  whiteSpaceStrategy?: string;
  differentiationLogic?: string;
}

interface WhiteSpaceAnalysisLike {
  strategicDirective?: string;
  conceptAnalyses?: ConceptAnalysisLike[];
  nuggetAnalyses?: NuggetAnalysisLike[];
}

interface ClaimsPayload {
  sessionId?: string;
  category?: string;
  mainIdea?: string;
  expandedConcept?: string;
  selectedIdeas: SelectedIdea[];
  whiteSpaceAnalysis?: WhiteSpaceAnalysisLike | null;
}

interface PerConceptContext {
  primaryPriorArt: string;
  riskLevel: string;
  constraint: string;
  whiteSpaceStrategy: string;
  differentiationLogic: string;
}

interface ParsedKeyConcept {
  number: number;
  type: "independent" | "dependent";
  claimType: string;
  parentClaim: number | null;
  dependsOn: number | null;
  text: string;
}

interface ParsedKeyConceptSet {
  concept_id: string;
  concept_text: string;
  category: string;
  index: number;
  complexity_assessment: string;
  complexity_level: "simple" | "moderate" | "complex";
  claim_type: string;
  inventive_concept: string;
  claims: ParsedKeyConcept[];
  claims_count: number;
  independent_claims: ParsedKeyConcept[];
  independent_claims_count: number;
  dependent_claims: ParsedKeyConcept[];
  dependent_claims_count: number;
  formatting_violations: Array<{ claim: number; issue: string }>;
  has_violations: boolean;
  is_valid: boolean;
  dependency_tree: Record<string, { claim: number; children: number[] }>;
  independent_claim: string;
  raw_output: string;
  timestamp: string;
}

function normalizeWhiteSpace(
  ws: WhiteSpaceAnalysisLike | null | undefined,
): { contextBlock: string; perConcept: PerConceptContext[] } {
  if (!ws) return { contextBlock: "", perConcept: [] };

  const perConcept: PerConceptContext[] = [];
  let contextBlock = `\n\n### PRIOR ART CONSTRAINTS:\n${ws.strategicDirective || ""}`;

  // New shape: conceptAnalyses[]
  if (Array.isArray(ws.conceptAnalyses) && ws.conceptAnalyses.length > 0) {
    contextBlock += `\n\nKEY DIFFERENTIATION POINTS:\n`;
    ws.conceptAnalyses.forEach((c, idx) => {
      const patentNums = (c.patentAnalyses || []).map((p) => p.patentNumber).filter(Boolean).join(", ");
      const topConstraint = (c.patentAnalyses || [])[0]?.specificConstraint || "";
      const wsStrategy = c.strategy?.whiteSpaceStrategy || c.consolidatedWhiteSpaceStrategy || "";
      const differentiators = c.strategy?.primaryDifferentiators || c.primaryDifferentiators || [];
      const guidance = c.strategy?.claimDraftingGuidance || c.claimDraftingGuidance || "";
      contextBlock += `\n${idx + 1}. ${patentNums || "No prior art"}\n`;
      contextBlock += `   Risk: ${c.overallRiskLevel || "Unknown"}\n`;
      contextBlock += `   Constraint: ${topConstraint}\n`;
      contextBlock += `   Strategy: ${wsStrategy}\n`;
      contextBlock += `   Differentiation: ${differentiators.join("; ")}\n`;
      contextBlock += `   Drafting Guidance: ${guidance}\n`;
      perConcept.push({
        primaryPriorArt: patentNums || "No prior art",
        riskLevel: c.overallRiskLevel || "Unknown",
        constraint: topConstraint,
        whiteSpaceStrategy: wsStrategy,
        differentiationLogic: differentiators.join("; "),
      });
    });
    return { contextBlock, perConcept };
  }

  // Legacy shape: nuggetAnalyses[]
  if (Array.isArray(ws.nuggetAnalyses) && ws.nuggetAnalyses.length > 0) {
    contextBlock += `\n\nKEY DIFFERENTIATION POINTS:\n`;
    ws.nuggetAnalyses.forEach((n, idx) => {
      contextBlock += `\n${idx + 1}. ${n.primaryPriorArt || ""}\n`;
      contextBlock += `   Risk: ${n.riskLevel || ""}\n`;
      contextBlock += `   Constraint: ${n.constraint || ""}\n`;
      contextBlock += `   Strategy: ${n.whiteSpaceStrategy || ""}\n`;
      contextBlock += `   Differentiation: ${n.differentiationLogic || ""}\n`;
      perConcept.push({
        primaryPriorArt: n.primaryPriorArt || "",
        riskLevel: n.riskLevel || "",
        constraint: n.constraint || "",
        whiteSpaceStrategy: n.whiteSpaceStrategy || "",
        differentiationLogic: n.differentiationLogic || "",
      });
    });
    return { contextBlock, perConcept };
  }

  return { contextBlock, perConcept: [] };
}

function buildUserMessage(args: {
  category: string;
  mainIdea: string;
  expandedConcept: string;
  conceptText: string;
  whiteSpaceContext: string;
  nugget: PerConceptContext | null;
}): string {
  const { category, mainIdea, expandedConcept, conceptText, whiteSpaceContext, nugget } = args;

  const priorArtAware = whiteSpaceContext
    ? `---\n\n**PRIOR ART AWARENESS:**\n${whiteSpaceContext}\n`
    : "";

  const differentiation = nugget
    ? `\n**DIFFERENTIATION STRATEGY:**\n` +
      `- Risk Level: ${nugget.riskLevel}\n` +
      `- Primary Prior Art: ${nugget.primaryPriorArt}\n` +
      `- White Space Strategy: ${nugget.whiteSpaceStrategy}\n` +
      `- Differentiation Logic: ${nugget.differentiationLogic}\n`
    : "";

  return (
    `**TECHNICAL CONTEXT:**\n\n` +
    `**Invention Category:** ${category}\n\n` +
    `**Core Innovation:**\n${mainIdea}\n\n` +
    `**Technical Specification:**\n${expandedConcept}\n\n` +
    `**Specific Concept to Document:**\n${conceptText}\n\n` +
    priorArtAware +
    differentiation +
    `\n---\n\n` +
    `Document the invention above following your system instructions exactly. Produce one plain sentence describing what the invention is, then a numbered **Key Concepts** list where each item is a self-contained paragraph covering one novel technical element. No preamble, no closing.`
  );
}

function parseClaimsOutput(
  rawOutput: string,
  conceptId: string,
  conceptText: string,
  category: string,
  index: number,
): ParsedKeyConceptSet {
  const output = (rawOutput || "").trim();

  // Split the output around the **Key Concepts** heading.
  // Before the heading: one intro sentence ("what the invention is").
  // After the heading: a numbered list of paragraphs, one per concept.
  const headingMatch = output.match(/\*\*\s*Key\s+Concepts\s*\*\*/i);

  let inventionSentence = "";
  let listBody = output;
  if (headingMatch && headingMatch.index !== undefined) {
    inventionSentence = output.slice(0, headingMatch.index).trim();
    listBody = output.slice(headingMatch.index + headingMatch[0].length).trim();
  }

  // Strip a leading stray heading line that some models emit.
  inventionSentence = inventionSentence
    .replace(/^\*\*[^*]+\*\*\s*\n?/g, "")
    .replace(/^#+\s.*\n?/g, "")
    .trim();

  // Parse numbered list items. Split the body on a newline that is immediately
  // followed by an item marker (digits, then "." or ")", then a space).
  const parseNumberedList = (body: string): ParsedKeyConcept[] => {
    const out: ParsedKeyConcept[] = [];
    if (!body) return out;
    const chunks = body.split(/\n(?=\s*\d+[.)]\s+)/);
    for (const chunk of chunks) {
      const m = chunk.match(/^\s*(\d+)[.)]\s+([\s\S]*)$/);
      if (!m) continue;
      const number = parseInt(m[1], 10);
      const text = m[2].replace(/\s+/g, " ").trim();
      if (!text) continue;
      out.push({
        number,
        type: "independent",
        claimType: "key-concept",
        parentClaim: null,
        dependsOn: null,
        text,
      });
    }
    return out;
  };

  let claims = parseNumberedList(listBody);

  // Fallback: if the heading was missing and no items came out of the body slice,
  // try the whole output. Capture pre-list text as the invention sentence.
  if (claims.length === 0) {
    claims = parseNumberedList(output);
    if (claims.length > 0 && !inventionSentence) {
      const firstNumMatch = output.match(/\n\s*\d+[.)]\s+/) || output.match(/^\s*\d+[.)]\s+/);
      if (firstNumMatch && firstNumMatch.index !== undefined) {
        inventionSentence = output.slice(0, firstNumMatch.index).trim();
      }
    }
  }

  const violations: Array<{ claim: number; issue: string }> = [];
  if (claims.length === 0) {
    violations.push({ claim: 0, issue: "No key concepts parsed from model output" });
  }

  const independentClaims = claims;
  const dependentClaims: ParsedKeyConcept[] = [];

  const dependencyTree: Record<string, { claim: number; children: number[] }> = {};
  claims.forEach((c) => {
    dependencyTree[c.number] = { claim: c.number, children: [] };
  });

  return {
    concept_id: conceptId,
    concept_text: conceptText,
    category,
    index,
    complexity_assessment: "",
    complexity_level: "moderate",
    claim_type: "key-concept",
    inventive_concept: inventionSentence,
    claims,
    claims_count: claims.length,
    independent_claims: independentClaims,
    independent_claims_count: independentClaims.length,
    dependent_claims: dependentClaims,
    dependent_claims_count: 0,
    formatting_violations: violations,
    has_violations: violations.length > 0,
    is_valid: violations.length === 0,
    dependency_tree: dependencyTree,
    independent_claim: independentClaims[0]?.text || "",
    raw_output: output,
    timestamp: new Date().toISOString(),
  };
}

export async function runClaims(payload: ClaimsPayload) {
  console.log(">>> [M4-4b CLAIMS] <<< generating key concepts for", payload.selectedIdeas?.length, "concepts");

  try {
    if (!Array.isArray(payload.selectedIdeas) || payload.selectedIdeas.length === 0) {
      return { success: false as const, error: "No selected ideas provided." };
    }

    const config = loadAgentConfig("module4/4b/claims.config.json");
    const systemPrompt = loadPrompt("module4/4b/claims.md");

    const { contextBlock, perConcept } = normalizeWhiteSpace(payload.whiteSpaceAnalysis || null);
    const category = payload.category || "";
    const mainIdea = payload.mainIdea || "";
    const expandedConcept = payload.expandedConcept || "";

    const results = await Promise.all(
      payload.selectedIdeas.map(async (idea, index) => {
        const conceptId = idea.id || `concept-${index}`;
        const conceptText = idea.text || "";
        try {
          const userMessage = buildUserMessage({
            category,
            mainIdea,
            expandedConcept,
            conceptText,
            whiteSpaceContext: contextBlock,
            nugget: perConcept[index] || null,
          });
          const raw = await callAgent({ systemPrompt, userMessage, config });
          return parseClaimsOutput(raw, conceptId, conceptText, category, index);
        } catch (err: any) {
          console.error(`>>> [M4-4b CLAIMS] <<< concept "${conceptId}" failed:`, err.message);
          return parseClaimsOutput(
            `**Complexity Assessment**\nAnalysis failed: ${err.message || String(err)}`,
            conceptId,
            conceptText,
            category,
            index,
          );
        }
      }),
    );

    console.log(
      `>>> [M4-4b CLAIMS] <<< done — ${results.length} concepts, ${results.reduce((s, r) => s + r.claims_count, 0)} total key concepts`,
    );

    return {
      success: true as const,
      data: results,
    };
  } catch (error: any) {
    console.error(">>> [M4-4b CLAIMS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message || "Claims generation failed";
    return { success: false as const, error: errorMessage };
  }
}

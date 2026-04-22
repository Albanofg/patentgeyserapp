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

interface ParsedClaim {
  number: number;
  type: "independent" | "dependent";
  claimType: string;
  parentClaim: number | null;
  dependsOn: number | null;
  text: string;
}

interface ParsedClaimSet {
  concept_id: string;
  concept_text: string;
  category: string;
  index: number;
  complexity_assessment: string;
  complexity_level: "simple" | "moderate" | "complex";
  claim_type: string;
  inventive_concept: string;
  claims: ParsedClaim[];
  claims_count: number;
  independent_claims: ParsedClaim[];
  independent_claims_count: number;
  dependent_claims: ParsedClaim[];
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
    `**Specific Concept for This Claim Set:**\n${conceptText}\n\n` +
    priorArtAware +
    differentiation +
    `\n---\n\n` +
    `**YOUR MISSION:**\n\n` +
    `Draft a comprehensive, technically detailed claim set that fully captures the innovation described above. Generate only claims that add meaningful strategic value - no padding, no redundancy. Follow the system instructions exactly for formatting, technical depth, and output structure.`
  );
}

function parseClaimsOutput(
  rawOutput: string,
  conceptId: string,
  conceptText: string,
  category: string,
  index: number,
): ParsedClaimSet {
  const output = rawOutput || "";

  // Complexity Assessment
  const complexityMatch = output.match(/\*\*Complexity Assessment\*\*\s*\n+([^\n*]+)/i);
  const complexityAssessment = complexityMatch ? complexityMatch[1].trim() : "";
  let complexityLevel: "simple" | "moderate" | "complex" = "moderate";
  const cLow = complexityAssessment.toLowerCase();
  if (cLow.includes("simple")) complexityLevel = "simple";
  else if (cLow.includes("complex")) complexityLevel = "complex";

  // Claim Type
  const claimTypeMatch = output.match(/\*\*Claim Type:\s*(SYSTEM|METHOD)\*\*/i);
  const claimType = claimTypeMatch ? claimTypeMatch[1].toLowerCase() : "system";

  // Inventive Concept
  const inventiveConceptMatch = output.match(/\*\*Inventive Concept\*\*\s*\n+([^\n*]+)/i);
  const inventiveConcept = inventiveConceptMatch ? inventiveConceptMatch[1].trim() : "";

  // Claims
  const claims: ParsedClaim[] = [];
  const claimSections = output.split(/(?=\*\*Claim\s+\d+\s*\([^)]+\)\*\*)/i);

  for (const section of claimSections) {
    const headerMatch = section.match(/\*\*Claim\s+(\d+)\s*\(([^)]+)\)\*\*/i);
    if (!headerMatch) continue;

    const claimNumber = parseInt(headerMatch[1], 10);
    const dependencyInfo = headerMatch[2].trim();

    const textMatch = section.match(/\*\*Claim\s+\d+\s*\([^)]+\)\*\*\s*\n?([\s\S]*?)(?=\*\*|$)/i);
    const claimText = textMatch
      ? textMatch[1].trim().replace(/\n+/g, " ").replace(/\s+/g, " ")
      : "";

    const isIndependent = dependencyInfo.toLowerCase().includes("independent");
    let parentClaim: number | null = null;
    if (!isIndependent) {
      const parentMatch = dependencyInfo.match(/(?:depends?\s+on|dependent\s+on)\s+claim\s+(\d+)/i);
      if (parentMatch) parentClaim = parseInt(parentMatch[1], 10);
      else {
        const fallbackMatch = dependencyInfo.match(/claim\s+(\d+)/i);
        parentClaim = fallbackMatch ? parseInt(fallbackMatch[1], 10) : 1;
      }
    }

    claims.push({
      number: claimNumber,
      type: isIndependent ? "independent" : "dependent",
      claimType,
      parentClaim,
      dependsOn: parentClaim,
      text: claimText,
    });
  }

  // Violations
  const violations: Array<{ claim: number; issue: string }> = [];
  if (claims.length < 5) violations.push({ claim: 0, issue: `Too few claims: ${claims.length} (minimum 5)` });
  if (claims.length > 10) violations.push({ claim: 0, issue: `Too many claims: ${claims.length} (maximum 10)` });
  claims.forEach((claim) => {
    const tl = claim.text.toLowerCase();
    if (tl.includes("any preceding claim") || tl.includes("any of the preceding") || tl.includes("any one of claims") || tl.includes("any of claims")) {
      violations.push({ claim: claim.number, issue: 'Uses prohibited "any preceding claim" language' });
    }
    if (tl.match(/system,?\s*method,?\s*(or|and)\s*medium/i) || tl.match(/method,?\s*system,?\s*(or|and)/i)) {
      violations.push({ claim: claim.number, issue: "Uses mixed claim types (system, method, or medium)" });
    }
    if (claim.text.match(/claims?\s+\d+\s*[-–—]\s*\d+/i) || claim.text.match(/claims?\s+\d+\s*(?:to|through)\s+\d+/i)) {
      violations.push({ claim: claim.number, issue: "Uses claim range reference instead of specific claim" });
    }
    if (claim.type === "dependent") {
      const claimRefs = claim.text.match(/(?:the\s+)?(?:system|method)\s+of\s+claim\s+(\d+)/gi) || [];
      if (claimRefs.length === 0) violations.push({ claim: claim.number, issue: "Dependent claim does not reference a parent claim" });
      else if (claimRefs.length > 1) violations.push({ claim: claim.number, issue: "Dependent claim references multiple claims" });
    }
  });

  const independentClaims = claims.filter((c) => c.type === "independent");
  const dependentClaims = claims.filter((c) => c.type === "dependent");

  const dependencyTree: Record<string, { claim: number; children: number[] }> = {};
  claims.forEach((c) => {
    if (c.type === "independent") dependencyTree[c.number] = { claim: c.number, children: [] };
  });
  dependentClaims.forEach((c) => {
    const parent = c.parentClaim;
    if (parent == null) return;
    if (!dependencyTree[parent]) dependencyTree[parent] = { claim: parent, children: [] };
    dependencyTree[parent].children.push(c.number);
  });

  return {
    concept_id: conceptId,
    concept_text: conceptText,
    category,
    index,
    complexity_assessment: complexityAssessment,
    complexity_level: complexityLevel,
    claim_type: claimType,
    inventive_concept: inventiveConcept,
    claims,
    claims_count: claims.length,
    independent_claims: independentClaims,
    independent_claims_count: independentClaims.length,
    dependent_claims: dependentClaims,
    dependent_claims_count: dependentClaims.length,
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
  console.log(">>> [M4-4b CLAIMS] <<< generating claim sets for", payload.selectedIdeas?.length, "concepts");

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
      `>>> [M4-4b CLAIMS] <<< done — ${results.length} concepts, ${results.reduce((s, r) => s + r.claims_count, 0)} total claims`,
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

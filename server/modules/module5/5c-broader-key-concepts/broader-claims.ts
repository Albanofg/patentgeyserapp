import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface BroaderClaimsPayload {
  sessionId?: string;
  patent_title?: string;
  one_sentence_summary?: string;
  current_claims?: string;
  full_specification?: string;
  drawing_descriptions_and_reference_numerals?: string;
  deep_research_notes?: string;
  prior_art_notes?: string;
  important_claim_sets?: string;
  executionMode?: string;
  webhookUrl?: string;
}

interface PreparedData {
  sessionId: string;
  patent_title: string;
  one_sentence_summary: string;
  current_claims_text: string;
  full_specification_text: string;
  drawings_text: string;
  optional_context_text: string;
  execution_mode: string;
  webhook_url: string;
}

interface ParsedKeyConcept {
  number: number;
  type: "independent" | "dependent";
  statutoryClass: string | null;
  parentClaim: number | null;
  text: string;
}

interface ParsedKeyConceptsResult {
  summary: {
    totalKeyConcepts: number;
    independentClaims: number;
    dependentClaims: number;
    statutoryClasses: string[];
    dependentsByParent: Record<string, number>;
  };
  claims: ParsedKeyConcept[];
}

function prepareData(payload: BroaderClaimsPayload): PreparedData {
  const currentClaimsText = payload.current_claims || "";
  const fullSpecText = payload.full_specification || "";
  const drawingsText =
    payload.drawing_descriptions_and_reference_numerals ||
    "No drawings provided for this specification.";

  let contextText = "";
  if (payload.deep_research_notes) contextText += `DEEP RESEARCH NOTES:\n${payload.deep_research_notes}\n\n`;
  if (payload.prior_art_notes) contextText += `PRIOR ART NOTES:\n${payload.prior_art_notes}\n\n`;
  if (payload.important_claim_sets) contextText += `IMPORTANT CLAIM SETS:\n${payload.important_claim_sets}\n\n`;

  let patentTitle = payload.patent_title || "";
  if (!patentTitle && fullSpecText) {
    const titleMatch = fullSpecText.match(/TITLE:\s*([^\n]+)/i);
    if (titleMatch) patentTitle = titleMatch[1].trim();
  }

  return {
    sessionId: payload.sessionId || "",
    patent_title: patentTitle,
    one_sentence_summary: payload.one_sentence_summary || "",
    current_claims_text: currentClaimsText,
    full_specification_text: fullSpecText,
    drawings_text: drawingsText,
    optional_context_text: contextText || "No additional context provided.",
    execution_mode: payload.executionMode || "production",
    webhook_url: payload.webhookUrl || "",
  };
}

function buildReaderPrompt(d: PreparedData): string {
  return (
    `TITLE: ${d.patent_title}\n\n` +
    `SPECIFICATION:\n${d.full_specification_text}\n\n` +
    `DRAWINGS:\n${d.drawings_text}\n\n` +
    `CURRENT CLAIMS:\n${d.current_claims_text}\n\n` +
    `CONTEXT:\n${d.optional_context_text || "None provided."}\n\n` +
    `SUMMARY:\n${d.one_sentence_summary || "None provided."}\n\n` +
    `Analyze the specification and current claims. Produce a single structured analysis with these exact sections:\n\n` +
    `INNOVATIONS INVENTORY:\nList every distinct technical innovation described in the specification. For each:\n- Name it\n- What it does (one sentence)\n- Supporting paragraph (¶ number)\n- Is it covered by any current claim? (YES citing claim number / NO / PARTIALLY citing claim number and what's missing)\n\n` +
    `UNCLAIMED INNOVATIONS:\nList every innovation marked NO or PARTIALLY above. These are broadening opportunities.\n\n` +
    `INDEPENDENT CLAIM PROBLEMS:\nFor each current independent claim:\n- Which limitations are non-essential implementation details that should be in dependents?\n- Which limitations use technology-specific language that could be generalized?\n- What is the minimum set of limitations that captures the inventive principle?\n\n` +
    `STATUTORY CLASS GAPS:\nWhat statutory classes are missing from the current claim set? (system / method / non-transitory computer-readable medium)\n\n` +
    `SPEC FLEXIBILITY:\nList every place the specification says the invention may be implemented using alternative technologies, in alternative industries, or with alternative architectures. These support broader claim language.\n\n` +
    `Be exhaustive. Miss nothing. This analysis directly determines the quality of the broadened claims.`
  );
}

function buildStrategistPrompt(d: PreparedData, specAnalysis: string): string {
  return (
    `You must produce a precise claim broadening blueprint. This blueprint will be handed directly to a claim drafter who will write formal USPTO claims from it. If your blueprint is vague, the claims will be vague. If you miss a feature, the patent loses that protection.\n\n` +
    `SPEC ANALYSIS (from previous agent):\n${specAnalysis}\n\n` +
    `ORIGINAL CLAIMS:\n${d.current_claims_text}\n\n` +
    `CONTEXT:\n${d.optional_context_text}\n\n` +
    `ONE-SENTENCE SUMMARY:\n${d.one_sentence_summary}\n\n` +
    `Produce your blueprint in this exact order:\n\n` +
    `PART 1 — INDEPENDENT CLAIM SKELETONS\n\nDesign the independent claims. You must include at least one system, one method, and one medium claim. For each:\n\nINDEPENDENT CLAIM [N] ([SYSTEM/METHOD/MEDIUM]):\n- Limitation A: [exact language to use]\n- Limitation B: [exact language to use]\n- Limitation C: [exact language to use]\n(list every limitation — this is the full skeleton)\n\nRules for independent claims:\n- Capture the inventive principle, not any specific implementation\n- No technology-specific language (no vendor names, no specific protocols, no specific database types, no specific file formats, no specific programming languages)\n- Replace specific technologies with functional descriptions\n- Do not lock claims to a specific industry\n- Every limitation must be supported by the specification\n\n` +
    `PART 2 — COVERAGE AUDIT\n\nGo through every single original claim, one by one. For each original claim, determine its fate in the new claim set:\n\nOriginal Claim [N]: [brief description of what it covers]\n→ ABSORBED INTO: Independent Claim [X], Limitation [Y] — because [reason]\nOR\n→ DEPENDENT CLAIM NEEDED: [describe what the dependent should say, with generalized language if the original was too technology-specific]\nOR\n→ INTENTIONALLY DROPPED: [specific reason — e.g., redundant with Claim X, or unsupported by spec, or damages prosecution strategy]\n\nDo not skip any original claim. Every single one must appear in this audit with one of the three dispositions above.\n\n` +
    `PART 3 — NEW DEPENDENT CLAIMS FROM UNCLAIMED INNOVATIONS\n\nFor each innovation the Spec Reader identified as unclaimed (NO or PARTIALLY covered), specify a new dependent claim:\n\n- Parent: Independent Claim [N]\n- Adds: [what specific limitation it adds]\n- Spec support: [paragraph reference]\n- Why: [what design-around path this closes or what feature this protects]\n\n` +
    `PART 4 — COMPLETE DEPENDENT CLAIMS LIST\n\nCompile the full list of ALL dependent claims — both those carried over from Part 2 and those newly created in Part 3. For each:\n\n- Parent: Claim [N]\n- Limitation: [exact language]\n- Spec support: [paragraph reference]\n- Purpose: [what this protects that the independent doesn't]\n\nThis list is what the drafter will convert directly into formal claims. Every item becomes one claim. Do not leave anything vague.\n\n` +
    `PART 5 — NEW SPEC PARAGRAPHS NEEDED\n\nFor each claim (independent or dependent) that lacks full spec support:\n- Topic: [what to describe]\n- Why: [which claim needs this]\n- Draft: [write the actual paragraph]\n\nIf no new spec is needed, say so.\n\n` +
    `PART 6 — PATENT ELIGIBILITY STRATEGY (§101/Alice)\n\nFor software patents:\n- What are the strongest technical improvements to emphasize?\n- What aspects cannot be performed by a human mind?\n- How should the claims be framed to survive §101 challenges?`
  );
}

function buildDrafterPrompt(d: PreparedData, blueprint: string): string {
  return (
    `CLAIM BLUEPRINT:\n${blueprint}\n\n` +
    `ORIGINAL SPECIFICATION (for verifying support — do not copy-paste from it):\n${d.full_specification_text}\n\n` +
    `DRAWINGS:\n${d.drawings_text || "non provided"}\n\n` +
    `Convert the blueprint above into formal USPTO patent claims.\n\n` +
    `Your ENTIRE response must be numbered patent claims. Nothing else. No headers. No commentary. No explanations. No sections. Start with "1." and end with the last claim number's period.\n\n` +
    `Every item in Part 4 (Complete Dependent Claims List) of the blueprint becomes exactly one dependent claim. Every independent claim skeleton in Part 1 becomes exactly one independent claim. Do not consolidate, merge, skip, or summarize any item from the blueprint.\n\n` +
    `Format rules:\n- Independent claims: "1. A system comprising:" or "N. A computer-implemented method comprising:" or "N. A non-transitory computer-readable medium storing instructions that, when executed by a processor, cause the processor to perform operations comprising:"\n- Dependent claims: "N. The [system/method/non-transitory computer-readable medium] of claim X, wherein..." or "...further comprising..."\n- Every claim is one sentence ending with a period\n- Use "comprising" on all independent claims\n- Antecedent basis: first mention "a/an", all subsequent "the/said"\n- Method claims: gerund verbs (receiving, determining, generating, filtering)\n- System claims: "a processor configured to" or "cause the processor to"\n- No source code, no pseudocode\n- No specific technology names in independent claims (no database vendors, no protocol names, no programming languages, no file formats)\n- Technology-specific language is acceptable in dependent claims where the blueprint specifies it`
  );
}

function parseClaims(rawOutput: string): ParsedKeyConceptsResult {
  const claims: ParsedKeyConcept[] = [];
  let currentClaim: ParsedKeyConcept | null = null;

  const lines = (rawOutput || "").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const claimStart = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (claimStart) {
      if (currentClaim) {
        currentClaim.text = currentClaim.text.trim();
        claims.push(currentClaim);
      }

      const num = parseInt(claimStart[1], 10);
      const restOfLine = claimStart[2];

      let type: "independent" | "dependent" = "dependent";
      let statutoryClass: string | null = null;
      let parentClaim: number | null = null;

      if (/^A system comprising/i.test(restOfLine)) {
        type = "independent";
        statutoryClass = "system";
      } else if (/^A computer-implemented method comprising/i.test(restOfLine)) {
        type = "independent";
        statutoryClass = "method";
      } else if (/^A non-transitory computer-readable medium/i.test(restOfLine)) {
        type = "independent";
        statutoryClass = "medium";
      } else {
        const depMatch = restOfLine.match(
          /^The\s+(system|method|non-transitory computer-readable medium)\s+of\s+claim\s+(\d+)/i,
        );
        if (depMatch) {
          const classMap: Record<string, string> = {
            system: "system",
            method: "method",
            "non-transitory computer-readable medium": "medium",
          };
          statutoryClass = classMap[depMatch[1].toLowerCase()] || depMatch[1].toLowerCase();
          parentClaim = parseInt(depMatch[2], 10);
        }
      }

      currentClaim = {
        number: num,
        type,
        statutoryClass,
        parentClaim,
        text: restOfLine,
      };
    } else if (currentClaim) {
      currentClaim.text += "\n" + trimmed;
    }
  }

  if (currentClaim) {
    currentClaim.text = currentClaim.text.trim();
    claims.push(currentClaim);
  }

  const independent = claims.filter((c) => c.type === "independent");
  const dependent = claims.filter((c) => c.type === "dependent");

  const dependentsByParent: Record<string, number> = {};
  for (const dep of dependent) {
    const key = dep.parentClaim != null ? String(dep.parentClaim) : "unknown";
    dependentsByParent[key] = (dependentsByParent[key] || 0) + 1;
  }

  return {
    summary: {
      totalKeyConcepts: claims.length,
      independentClaims: independent.length,
      dependentClaims: dependent.length,
      statutoryClasses: Array.from(new Set(independent.map((c) => c.statutoryClass).filter(Boolean))) as string[],
      dependentsByParent,
    },
    claims,
  };
}

export async function runBroaderClaims(payload: BroaderClaimsPayload) {
  console.log(">>> [M5-5c BROADER-CLAIMS] <<< starting 3-stage pipeline");

  try {
    const prepared = prepareData(payload);

    // Stage 1: Spec Reader
    console.log(">>> [M5-5c BROADER-CLAIMS] <<< stage 1/3 spec-reader");
    const readerConfig = loadAgentConfig("module5/5c-broader-key-concepts/spec-reader.config.json");
    const readerSystem = loadPrompt("module5/5c-broader-key-concepts/spec-reader.md");
    const readerPrompt = buildReaderPrompt(prepared);
    const specAnalysis = await callAgent({
      systemPrompt: readerSystem,
      userMessage: readerPrompt,
      config: readerConfig,
      usage: { agentCode: "module5/5c-spec-reader" },
    });

    // Stage 2: Claim Strategist
    console.log(">>> [M5-5c BROADER-CLAIMS] <<< stage 2/3 claim-strategist");
    const strategistConfig = loadAgentConfig("module5/5c-broader-key-concepts/claim-strategist.config.json");
    const strategistSystem = loadPrompt("module5/5c-broader-key-concepts/claim-strategist.md");
    const blueprint = await callAgent({
      systemPrompt: strategistSystem,
      userMessage: buildStrategistPrompt(prepared, specAnalysis),
      config: strategistConfig,
      usage: { agentCode: "module5/5c-strategist" },
    });

    // Stage 3: Claim Drafter
    console.log(">>> [M5-5c BROADER-CLAIMS] <<< stage 3/3 claim-drafter");
    const drafterConfig = loadAgentConfig("module5/5c-broader-key-concepts/claim-drafter.config.json");
    const drafterSystem = loadPrompt("module5/5c-broader-key-concepts/claim-drafter.md");
    const rawClaims = await callAgent({
      systemPrompt: drafterSystem,
      userMessage: buildDrafterPrompt(prepared, blueprint),
      config: drafterConfig,
      usage: { agentCode: "module5/5c-drafter" },
    });

    const parsed = parseClaims(rawClaims);
    console.log(
      `>>> [M5-5c BROADER-CLAIMS] <<< done — ${parsed.summary.totalKeyConcepts} claims (${parsed.summary.independentClaims} independent, ${parsed.summary.dependentClaims} dependent)`,
    );

    return {
      success: true as const,
      summary: parsed.summary,
      claims: parsed.claims,
    };
  } catch (error: any) {
    console.error(">>> [M5-5c BROADER-CLAIMS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message || "Broader claims generation failed";
    return { success: false as const, error: errorMessage };
  }
}

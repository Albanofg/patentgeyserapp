// Genus & Species Expansion Orchestrator
//
// Implements the four-stage workflow defined in genus-species-workflow.md.
// Persists state to agentData[5].genusSpecies so approval gates survive
// page refresh. Called from routes.ts via the /genus-species/* endpoints.
//
// Stage overview:
//   1. Genus extraction          (1 call, sequential)
//   2. Species synthesis         (3 parallel calls)
//   → Gate 1: inventor approves species
//   3. Parallel fan-out          (N + 5 concurrent calls)
//   4. Abstract rewrite          (1 call, sequential)
//   → Gate 2: inventor approves all artifacts

import { callAgentJSON, callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

const PROMPT_BASE = "module5/5c-genus-and-species";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkflowStatus =
  | "idle"
  | "running_stage1"
  | "running_stage2"
  | "awaiting_gate1"
  | "running_stage3"
  | "running_stage4"
  | "awaiting_gate2"
  | "complete"
  | "error";

export interface GenusObject {
  genus_name: string;
  genus_description: string;
  input_pattern: string;
  transformation_pattern: string;
  output_pattern: string;
  paradigm_neutrality_check: string;
}

export interface SpeciesRecord {
  species_type: "ai_assisted" | "ai_native" | "agentic";
  architectural_description: string;
  data_flow: string;
  key_components: string[];
  technical_improvements: string[];
  differentiation_from_traditional: string;
  failed?: boolean;
  error?: string;
}

export interface BroadenedConcept {
  original_key_concept: string;
  broadened_concept_text: string;
}

export interface AppendedConcept {
  concept_aspect: "genus_mechanism" | "species_spectrum" | "hardware_optimization";
  key_concept_text: string;
}

export interface SectionExtension {
  additional_paragraphs: string;
}

export interface DetailExtension {
  subsections: Array<{ title: string; content: string }>;
}

export interface AbstractRewrite {
  abstract_text: string;
  word_count: number;
  word_budget_check: string;
}

export interface GenusSpeciesState {
  status: WorkflowStatus;
  error?: string | null;
  startedAt?: string;
  completedAt?: string;
  // Stage 1 output
  genus?: GenusObject;
  // Stage 2 outputs
  species?: SpeciesRecord[];
  // Gate 1 decision
  approvedSpecies?: SpeciesRecord[];
  // Stage 3 outputs
  broadenings?: BroadenedConcept[];
  appendings?: AppendedConcept[];
  backgroundExtension?: SectionExtension;
  summaryExtension?: SectionExtension;
  detailExtension?: DetailExtension;
  // Stage 4 output
  abstractRewrite?: AbstractRewrite;
  // Gate 2 decisions — keyed by artifact id
  gate2Approvals?: Record<string, "approved" | "edited" | "rejected">;
  gate2Edits?: Record<string, string>;
  // Final assembled output (written when Gate 2 is finalized)
  finalSpec?: {
    keyConceptsBroadened: BroadenedConcept[];
    keyConceptsAppended: AppendedConcept[];
    backgroundExtension: string;
    summaryExtension: string;
    detailExtension: DetailExtension;
    abstractText: string;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildUserMessage(data: Record<string, any>): string {
  return JSON.stringify(data, null, 2);
}

// Extract a plain-text string from a potentially nested AI response object.
// The AI sometimes returns extra fields (language_changes, covers, etc.) or
// double-wraps the target key. This unwraps safely without throwing.
function extractText(val: any, key: string, depth = 0): string {
  if (depth > 6 || val === null || val === undefined) return "";
  if (typeof val === "string") {
    const t = val.trim();
    if (t.startsWith("{")) {
      try { return extractText(JSON.parse(t), key, depth + 1); } catch {}
    }
    return val;
  }
  if (typeof val === "object" && !Array.isArray(val)) {
    if (val[key] !== undefined) {
      const child = val[key];
      if (typeof child === "string" && !child.trim().startsWith("{")) return child;
      return extractText(child, key, depth + 1);
    }
  }
  return "";
}

// ─── Stage 1: Genus extraction ────────────────────────────────────────────────

export async function runGenusExtraction(inputs: {
  coreIdea: string;
  expandedConcept: string;
  existingKeyConcepts: string[];
}): Promise<{ success: true; genus: GenusObject } | { success: false; error: string }> {
  console.log("[genus-species] Stage 1: genus extraction");
  try {
    const config = loadAgentConfig(`${PROMPT_BASE}/genus-extractor.config.json`);
    const systemPrompt = loadPrompt(`${PROMPT_BASE}/genus-extractor.md`);
    const genus = await callAgentJSON<GenusObject>({
      systemPrompt,
      userMessage: buildUserMessage(inputs),
      config,
      usage: { agentCode: "module5/genus-extractor" },
    });
    if (!genus?.genus_name || !genus?.genus_description) {
      throw new Error("Genus extraction returned invalid structure");
    }
    console.log("[genus-species] Stage 1 complete:", genus.genus_name);
    return { success: true, genus };
  } catch (e: any) {
    console.error("[genus-species] Stage 1 failed:", e?.message);
    return { success: false, error: e?.message || "Genus extraction failed" };
  }
}

// ─── Stage 2: Species synthesis (parallel) ───────────────────────────────────

const SPECIES_TYPES = ["ai_assisted", "ai_native", "agentic"] as const;

export async function runSpeciesSynthesis(inputs: {
  genus: GenusObject;
}): Promise<SpeciesRecord[]> {
  console.log("[genus-species] Stage 2: species synthesis (parallel ×3)");
  const config = loadAgentConfig(`${PROMPT_BASE}/species-synthesizer.config.json`);
  const systemPrompt = loadPrompt(`${PROMPT_BASE}/species-synthesizer.md`);

  const results = await Promise.allSettled(
    SPECIES_TYPES.map(async (species_type) => {
      const result = await callAgentJSON<Omit<SpeciesRecord, "species_type">>({
        systemPrompt,
        userMessage: buildUserMessage({ genus: inputs.genus, species_type }),
        config,
        usage: { agentCode: `module5/species-synthesizer-${species_type}` },
      });
      return { ...result, species_type } as SpeciesRecord;
    }),
  );

  return SPECIES_TYPES.map((species_type, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      console.log(`[genus-species] Species ${species_type} ok`);
      return r.value;
    } else {
      console.warn(`[genus-species] Species ${species_type} failed:`, r.reason?.message);
      return {
        species_type,
        architectural_description: "",
        data_flow: "",
        key_components: [],
        technical_improvements: [],
        differentiation_from_traditional: "",
        failed: true,
        error: r.reason?.message || "Species synthesis failed",
      } as SpeciesRecord;
    }
  });
}

// ─── Stage 3: Parallel fan-out ───────────────────────────────────────────────

export async function runStage3(inputs: {
  existingKeyConcepts: string[];
  genus: GenusObject;
  approvedSpecies: SpeciesRecord[];
  existingBackground: string;
  existingSummary: string;
  existingDetailedDescription: string;
}): Promise<{
  broadenings: BroadenedConcept[];
  appendings: AppendedConcept[];
  backgroundExtension: SectionExtension;
  summaryExtension: SectionExtension;
  detailExtension: DetailExtension;
}> {
  console.log(`[genus-species] Stage 3: fan-out (${inputs.existingKeyConcepts.length} broadenings + 3 appendings + 3 extensions)`);

  const broadenerConfig = loadAgentConfig(`${PROMPT_BASE}/key-concept-broadener.config.json`);
  const broadenerPrompt = loadPrompt(`${PROMPT_BASE}/key-concept-broadener.md`);
  const appenderConfig = loadAgentConfig(`${PROMPT_BASE}/key-concept-appender.config.json`);
  const appenderPrompt = loadPrompt(`${PROMPT_BASE}/key-concept-appender.md`);
  const bgConfig = loadAgentConfig(`${PROMPT_BASE}/background-extender.config.json`);
  const bgPrompt = loadPrompt(`${PROMPT_BASE}/background-extender.md`);
  const summaryConfig = loadAgentConfig(`${PROMPT_BASE}/summary-extender.config.json`);
  const summaryPrompt = loadPrompt(`${PROMPT_BASE}/summary-extender.md`);
  const detailConfig = loadAgentConfig(`${PROMPT_BASE}/detail-description-extender.config.json`);
  const detailPrompt = loadPrompt(`${PROMPT_BASE}/detail-description-extender.md`);

  const conceptAspects = ["genus_mechanism", "species_spectrum", "hardware_optimization"] as const;

  const [
    broadeningResults,
    appendingResults,
    bgResult,
    summaryResult,
    detailResult,
  ] = await Promise.all([
    // N key concept broadenings — use JSON mode so we reliably get the
    // structured object and can extract broadened_concept_text cleanly.
    Promise.allSettled(
      inputs.existingKeyConcepts.map(async (original_key_concept, i) => {
        const result = await callAgentJSON<{ broadened_concept_text: string }>({
          systemPrompt: broadenerPrompt,
          userMessage: buildUserMessage({
            original_key_concept,
            genus: inputs.genus,
            approved_species: inputs.approvedSpecies,
          }),
          config: broadenerConfig,
          usage: { agentCode: `module5/key-concept-broadener` },
        });
        return {
          original_key_concept,
          broadened_concept_text: extractText(result, "broadened_concept_text"),
        } as BroadenedConcept;
      }),
    ),
    // 3 key concept appendings — JSON mode for clean extraction.
    Promise.allSettled(
      conceptAspects.map(async (concept_aspect) => {
        const result = await callAgentJSON<{ key_concept_text: string }>({
          systemPrompt: appenderPrompt,
          userMessage: buildUserMessage({
            concept_aspect,
            genus: inputs.genus,
            approved_species: inputs.approvedSpecies,
            existing_key_concepts: inputs.existingKeyConcepts,
          }),
          config: appenderConfig,
          usage: { agentCode: `module5/key-concept-appender` },
        });
        return {
          concept_aspect,
          key_concept_text: extractText(result, "key_concept_text"),
        } as AppendedConcept;
      }),
    ),
    // Background extender — plain text, the model returns prose directly.
    callAgent({
      systemPrompt: bgPrompt,
      userMessage: buildUserMessage({
        existing_background: inputs.existingBackground,
        genus: inputs.genus,
        approved_species: inputs.approvedSpecies,
      }),
      config: bgConfig,
      usage: { agentCode: "module5/background-extender" },
    }).then((r) => {
      // Guard: if the model returned JSON despite plain-text mode, extract.
      let text = r.trim();
      try { const p = JSON.parse(text); if (p?.additional_paragraphs) text = p.additional_paragraphs; } catch {}
      return { additional_paragraphs: text };
    }).catch((e) => {
      console.warn("[genus-species] background-extender failed:", e?.message);
      return { additional_paragraphs: "" };
    }),
    // Summary extender — same plain-text + guard pattern.
    callAgent({
      systemPrompt: summaryPrompt,
      userMessage: buildUserMessage({
        existing_summary: inputs.existingSummary,
        genus: inputs.genus,
        approved_species: inputs.approvedSpecies,
      }),
      config: summaryConfig,
      usage: { agentCode: "module5/summary-extender" },
    }).then((r) => {
      let text = r.trim();
      try { const p = JSON.parse(text); if (p?.additional_paragraphs) text = p.additional_paragraphs; } catch {}
      return { additional_paragraphs: text };
    }).catch((e) => {
      console.warn("[genus-species] summary-extender failed:", e?.message);
      return { additional_paragraphs: "" };
    }),
    // Detailed description extender
    callAgentJSON<DetailExtension>({
      systemPrompt: detailPrompt,
      userMessage: buildUserMessage({
        existing_detailed_description: inputs.existingDetailedDescription,
        genus: inputs.genus,
        approved_species_with_details: inputs.approvedSpecies,
      }),
      config: detailConfig,
      usage: { agentCode: "module5/detail-description-extender" },
    }).catch((e) => {
      console.warn("[genus-species] detail-description-extender failed:", e?.message);
      return { subsections: [] };
    }),
  ]);

  const broadenings: BroadenedConcept[] = broadeningResults.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { original_key_concept: inputs.existingKeyConcepts[i], broadened_concept_text: "" },
  );

  const appendings: AppendedConcept[] = appendingResults.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { concept_aspect: conceptAspects[i], key_concept_text: "" },
  );

  console.log(`[genus-species] Stage 3 complete: ${broadenings.length} broadenings, ${appendings.length} appendings`);

  return {
    broadenings,
    appendings,
    backgroundExtension: bgResult,
    summaryExtension: summaryResult,
    detailExtension: detailResult,
  };
}

// ─── Stage 4: Abstract rewrite ───────────────────────────────────────────────

export async function runAbstractRewrite(inputs: {
  originalAbstract: string;
  assembledSpec: string;
  approvedSpecies: SpeciesRecord[];
  genus: GenusObject;
}): Promise<AbstractRewrite> {
  console.log("[genus-species] Stage 4: abstract rewrite");
  const config = loadAgentConfig(`${PROMPT_BASE}/abstract-rewriter.config.json`);
  const systemPrompt = loadPrompt(`${PROMPT_BASE}/abstract-rewriter.md`);
  const result = await callAgentJSON<AbstractRewrite>({
    systemPrompt,
    userMessage: buildUserMessage(inputs),
    config,
    usage: { agentCode: "module5/abstract-rewriter" },
  });
  console.log(`[genus-species] Stage 4 complete: abstract ${result?.word_count} words`);
  return result;
}

// ─── Gate 2: Finalize approved artifacts into the final spec ─────────────────

export function finalizeApprovals(
  state: GenusSpeciesState,
  approvals: Record<string, "approved" | "edited" | "rejected">,
  edits: Record<string, string>,
): GenusSpeciesState["finalSpec"] {
  const keep = (id: string, originalText: string): string | null => {
    const decision = approvals[id] ?? "approved";
    if (decision === "rejected") return null;
    if (decision === "edited") return edits[id] || originalText;
    return originalText;
  };

  const keyConceptsBroadened = (state.broadenings ?? [])
    .map((b, i) => {
      const text = keep(`broadening_${i}`, b.broadened_concept_text);
      return text ? { ...b, broadened_concept_text: text } : null;
    })
    .filter(Boolean) as BroadenedConcept[];

  const keyConceptsAppended = (state.appendings ?? [])
    .map((a, i) => {
      const text = keep(`appending_${i}`, a.key_concept_text);
      return text ? { ...a, key_concept_text: text } : null;
    })
    .filter(Boolean) as AppendedConcept[];

  const bgText = keep("background_extension", state.backgroundExtension?.additional_paragraphs ?? "");
  const summaryText = keep("summary_extension", state.summaryExtension?.additional_paragraphs ?? "");

  const detailSubsections = (state.detailExtension?.subsections ?? [])
    .map((s, i) => {
      const content = keep(`detail_subsection_${i}`, s.content);
      return content ? { ...s, content } : null;
    })
    .filter(Boolean) as DetailExtension["subsections"];

  const abstractText = keep("abstract", state.abstractRewrite?.abstract_text ?? "");

  return {
    keyConceptsBroadened,
    keyConceptsAppended,
    backgroundExtension: bgText ? { additional_paragraphs: bgText } : { additional_paragraphs: "" },
    summaryExtension: summaryText ? { additional_paragraphs: summaryText } : { additional_paragraphs: "" },
    detailExtension: { subsections: detailSubsections },
    abstractText: abstractText ?? "",
  };
}

import { callAgentJSON, loadAgentConfig, loadPrompt } from "../../../ai/client";

export type PohcFactor = "conception" | "quality" | "known_concepts";

export interface FactorSummarizerInput {
  factor: PohcFactor;
  factor_question: string;
  factor_definition: string;
  claim_text: string;
  raw_source_text: string;
  source_breakdown: Array<{ text: string; tag: string; source: string; charCount: number }>;
}

export interface FactorSummarizerOutput {
  draft: string;
  quote_seeds: string[];
  insufficient: boolean;
  missing: string[];
}

const FACTOR_DEFINITIONS: Record<PohcFactor, string> = {
  conception: "When and how the inventor mentally conceived the specific technical mechanism, including timeline, documentation, and the thought process behind it.",
  quality: "Whether the technical contribution is a meaningful advance versus an obvious combination of known elements — the sophistication and inventive character.",
  known_concepts: "How the invention exceeds what was previously known in the field — prior-art awareness and the specific ways the invention differs from existing solutions.",
};

const FALLBACK_QUESTIONS: Record<PohcFactor, string> = {
  conception: "When and how did you conceive this specific mechanism, and what evidence anchors the timeline?",
  quality: "Why is this contribution a meaningful advance rather than an obvious combination of known elements?",
  known_concepts: "What was previously known in this area, and how does your approach exceed it?",
};

export function fallbackFactorQuestion(factor: PohcFactor): string {
  return FALLBACK_QUESTIONS[factor];
}

export function factorDefinition(factor: PohcFactor): string {
  return FACTOR_DEFINITIONS[factor];
}

export async function runFactorSummarizer(
  input: FactorSummarizerInput,
): Promise<{ success: true; result: FactorSummarizerOutput } | { success: false; error: string }> {
  try {
    const config = loadAgentConfig("module4/4c-pannu/human-conception-factor-summarizer.config.json");
    const systemPrompt = loadPrompt("module4/4c-pannu/human-conception-factor-summarizer.md");
    const userMessage = JSON.stringify(input);

    const parsed = await callAgentJSON<FactorSummarizerOutput>({
      systemPrompt,
      userMessage,
      config,
      usage: { agentCode: "module4/4c-pannu-factor-summarizer" },
    });

    if (!parsed || typeof parsed !== "object") throw new Error("Summarizer returned no object");
    const draft = typeof parsed.draft === "string" ? parsed.draft : "";
    const quoteSeeds = Array.isArray(parsed.quote_seeds) ? parsed.quote_seeds.filter((s) => typeof s === "string") : [];
    const insufficient = typeof parsed.insufficient === "boolean" ? parsed.insufficient : true;
    const missing = Array.isArray(parsed.missing) ? parsed.missing.filter((s) => typeof s === "string") : [];

    // Forbidden-token guard (defense in depth)
    const tokenRe = /pannu/i;
    if (tokenRe.test(draft) || quoteSeeds.some((s) => tokenRe.test(s)) || missing.some((s) => tokenRe.test(s))) {
      throw new Error("Summarizer output contained forbidden token");
    }

    // Branch invariants
    if (!insufficient) {
      if (draft.length < 40) throw new Error("Sufficient draft below minimum length");
      if (quoteSeeds.length < 1) throw new Error("Sufficient branch missing quote_seeds");
      for (const q of quoteSeeds) {
        if (q.length < 8) throw new Error("quote_seed shorter than 8 chars");
        if (!input.raw_source_text.includes(q)) throw new Error("quote_seed not found in raw_source_text");
        if (!draft.includes(q)) throw new Error("quote_seed not found in draft");
      }
    }

    return {
      success: true,
      result: { draft, quote_seeds: quoteSeeds, insufficient, missing },
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    console.warn(">>> [M4-4c PANNU/SUMMARIZER] <<< failed:", message);
    return { success: false, error: message };
  }
}

interface PannuQuestion {
  factor: "conception" | "quality" | "known_concepts";
  question: string;
  hint: string;
}

interface PannuQuestionsResult {
  status?: string;
  concept_id?: string;
  questions: PannuQuestion[];
}

interface PannuQuestionsPayload {
  claim_text: string;
  concept_id: string;
  strategy_context?: string;
}

export async function runPannuQuestions(payload: PannuQuestionsPayload) {
  console.log(">>> [M4-4c PANNU/QUESTIONS] <<< generating questions for", payload.concept_id);

  try {
    const config = loadAgentConfig("module4/4c-pannu/questions.config.json");
    const systemPrompt = loadPrompt("module4/4c-pannu/questions.md");

    const userMessage =
      `Claim Text: ${payload.claim_text}\n\n` +
      `Concept ID: ${payload.concept_id}\n\n` +
      `White Space Strategy: ${payload.strategy_context || ""}\n\n` +
      `Generate the three Pannu Test questions in JSON format.`;

    const parsed = await callAgentJSON<PannuQuestionsResult>({
      systemPrompt,
      userMessage,
      config,
      usage: { agentCode: "module4/4c-pannu-questions" },
    });

    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return { success: false as const, error: "AI returned no questions." };
    }

    return {
      success: true as const,
      status: "success",
      concept_id: payload.concept_id,
      questions: parsed.questions,
    };
  } catch (error: any) {
    console.error(">>> [M4-4c PANNU/QUESTIONS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message.includes("Failed to parse AI response as JSON")
        ? "AI service returned invalid JSON. Please try again."
        : message || "Pannu questions generation failed";
    return { success: false as const, error: errorMessage };
  }
}

interface PannuAnswer {
  factor: string;
  answer: string;
}

interface PannuScorerPayload {
  claim_text: string;
  concept_id: string;
  human_answers: PannuAnswer[] | Record<string, any>;
}

interface BatchedScorerResultRow {
  claim_id: string;
  certification_status: "Certified" | "Needs Clarification" | "Rejected";
  confidence_score: number;
  factor_scores: { conception: number; quality: number; known_concepts: number };
  pannu_record_text: string;
  weak_factors: Array<"conception" | "quality" | "known_concepts">;
}

interface BatchedScorerResult {
  results: BatchedScorerResultRow[];
}

const VALID_STATUSES = new Set(["Certified", "Needs Clarification", "Rejected"]);

function normalizeAnswers(
  raw: PannuAnswer[] | Record<string, any>,
): { conception: { text: string; sources: string[] }; quality: { text: string; sources: string[] }; known_concepts: { text: string; sources: string[] } } {
  const out = {
    conception: { text: "", sources: [] as string[] },
    quality: { text: "", sources: [] as string[] },
    known_concepts: { text: "", sources: [] as string[] },
  };
  if (Array.isArray(raw)) {
    for (const a of raw) {
      const key = a?.factor as keyof typeof out;
      if (key in out) out[key].text = a?.answer ?? "";
    }
  } else if (raw && typeof raw === "object") {
    for (const key of Object.keys(out) as Array<keyof typeof out>) {
      const v = (raw as any)[key];
      if (typeof v === "string") out[key].text = v;
      else if (v && typeof v === "object" && typeof v.text === "string") {
        out[key].text = v.text;
        if (Array.isArray(v.sources)) out[key].sources = v.sources;
      }
    }
  }
  return out;
}

export async function runPannuScorer(payload: PannuScorerPayload) {
  console.log(">>> [M4-4c PANNU/SCORER] <<< scoring answers for", payload.concept_id);

  try {
    const config = loadAgentConfig("module4/4c-pannu/scorer.config.json");
    const systemPrompt = loadPrompt("module4/4c-pannu/pannu-scorer.md");

    const batchedInput = {
      project_context: { white_space_strategy: "" },
      claims: [
        {
          claim_id: payload.concept_id,
          claim_text: payload.claim_text,
          answers: normalizeAnswers(payload.human_answers),
        },
      ],
    };

    const userMessage = JSON.stringify(batchedInput);

    const parsed = await callAgentJSON<BatchedScorerResult>({
      systemPrompt,
      userMessage,
      config,
      usage: { agentCode: "module4/4c-pannu-scorer" },
    });

    const row = parsed?.results?.[0];
    if (!row) throw new Error("Batched scorer returned no results");
    if (!VALID_STATUSES.has(row.certification_status)) {
      throw new Error(`Invalid certification_status: ${row.certification_status}`);
    }
    if (
      typeof row.confidence_score !== "number" ||
      row.confidence_score < 0 ||
      row.confidence_score > 1
    ) {
      throw new Error(`confidence_score out of range: ${row.confidence_score}`);
    }

    return {
      success: true as const,
      certification_status: row.certification_status,
      concept_id: row.claim_id || payload.concept_id,
      confidence_score: row.confidence_score,
      pannu_record_text: row.pannu_record_text || "",
    };
  } catch (error: any) {
    console.error(">>> [M4-4c PANNU/SCORER] <<< failed:", error);
    const message = error?.message || String(error);
    // n8n's fallback on scorer errors was to return Rejected/0.0 — preserve that behavior
    return {
      success: false as const,
      certification_status: "Rejected" as const,
      concept_id: payload.concept_id,
      confidence_score: 0.0,
      pannu_record_text: `Scoring failed: ${message}`,
      error: message,
    };
  }
}

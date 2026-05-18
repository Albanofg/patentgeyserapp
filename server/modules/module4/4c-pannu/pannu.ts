import { callAgentJSON, loadAgentConfig, loadPrompt } from "../../../ai/client";

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

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

interface PannuScorerResult {
  certification_status: "Certified" | "Needs Clarification" | "Rejected";
  concept_id?: string;
  confidence_score: number;
  pannu_record_text: string;
}

const VALID_STATUSES = new Set(["Certified", "Needs Clarification", "Rejected"]);

export async function runPannuScorer(payload: PannuScorerPayload) {
  console.log(">>> [M4-4c PANNU/SCORER] <<< scoring answers for", payload.concept_id);

  try {
    const config = loadAgentConfig("module4/4c-pannu/scorer.config.json");
    const systemPrompt = loadPrompt("module4/4c-pannu/scorer.md");

    const userMessage =
      `Claim Text: ${payload.claim_text}\n\n` +
      `Concept ID: ${payload.concept_id}\n\n` +
      `Human Answers:\n${JSON.stringify(payload.human_answers, null, 2)}\n\n` +
      `Analyze and provide the compliance score in the required JSON format.`;

    const parsed = await callAgentJSON<PannuScorerResult>({
      systemPrompt,
      userMessage,
      config,
      usage: { agentCode: "module4/4c-pannu-scorer" },
    });

    if (!VALID_STATUSES.has(parsed.certification_status)) {
      throw new Error(`Invalid certification_status: ${parsed.certification_status}`);
    }
    if (
      typeof parsed.confidence_score !== "number" ||
      parsed.confidence_score < 0 ||
      parsed.confidence_score > 1
    ) {
      throw new Error(`confidence_score out of range: ${parsed.confidence_score}`);
    }

    return {
      success: true as const,
      certification_status: parsed.certification_status,
      concept_id: payload.concept_id,
      confidence_score: parsed.confidence_score,
      pannu_record_text: parsed.pannu_record_text || "",
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

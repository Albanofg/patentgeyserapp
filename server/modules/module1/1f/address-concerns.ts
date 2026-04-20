import { callAgentJSON, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface Concern {
  id: string;
  title: string;
  type?: string;
  severity?: string;
  description?: string;
  question?: string;
}

interface ConcernResponse {
  concernId: string;
  action: "FIX" | "DELETE" | string;
  fixText?: string;
}

interface Glossary {
  canonicalTerms?: any[];
  [k: string]: any;
}

interface AddressConcernsPayload {
  sessionId?: string;
  glossary?: Glossary;
  originalIdea: string;
  examinerConcerns: Concern[];
  concernResponses: ConcernResponse[];
}

interface ExaminerVerdict {
  verdict: "RESOLVED" | "NEEDS_MORE";
  reasoning: string;
  followUpQuestion: string | null;
  glossaryIssues: string[];
}

interface VerdictRecord {
  concernId: string;
  concernTitle: string;
  concernType?: string;
  originalDescription?: string;
  originalQuestion?: string;
  action: "FIX" | "DELETE" | string;
  fixText?: string;
  verdict: "RESOLVED" | "NEEDS_MORE" | "DELETED";
  reasoning: string;
  followUpQuestion: string | null;
  glossaryIssues?: string[];
  sessionId?: string;
}

async function reviewFix(
  concern: Concern,
  fixText: string,
  originalIdea: string,
  glossary: Glossary,
  sessionId: string | undefined,
  systemPrompt: string,
  config: any
): Promise<VerdictRecord> {
  const userMessage =
    `**CONCERN UNDER REVIEW:**\n` +
    `ID: ${concern.id}\n` +
    `Title: ${concern.title}\n` +
    `Type: ${concern.type || ""}\n` +
    `Severity: ${concern.severity || ""}\n` +
    `Original Description: ${concern.description || ""}\n` +
    `Original Question: ${concern.question || ""}\n\n` +
    `**INVENTOR'S FIX:**\n${fixText}\n\n` +
    `**ORIGINAL INVENTION CONTEXT:**\n${originalIdea}\n\n` +
    `**CANONICAL GLOSSARY (Terms inventor should use):**\n${JSON.stringify(glossary.canonicalTerms || [], null, 2)}\n\n` +
    `---\n\n` +
    `Evaluate whether the inventor's fix adequately addresses this concern. Return your verdict as JSON.`;

  let parsed: ExaminerVerdict;
  try {
    parsed = await callAgentJSON<ExaminerVerdict>({ systemPrompt, userMessage, config });
  } catch (err: any) {
    console.error(`>>> [M1-1f ADDRESS-CONCERNS] <<< Concern "${concern.id}" review failed:`, err.message);
    parsed = {
      verdict: "NEEDS_MORE",
      reasoning: "Unable to parse examiner response. Manual review required.",
      followUpQuestion: "Please clarify your fix with more technical detail.",
      glossaryIssues: [],
    };
  }

  return {
    concernId: concern.id,
    concernTitle: concern.title,
    concernType: concern.type,
    originalDescription: concern.description,
    originalQuestion: concern.question,
    action: "FIX",
    fixText,
    verdict: parsed.verdict,
    reasoning: parsed.reasoning,
    followUpQuestion: parsed.followUpQuestion ?? null,
    glossaryIssues: parsed.glossaryIssues || [],
    sessionId,
  };
}

function handleDelete(concern: Concern, sessionId?: string): VerdictRecord {
  return {
    concernId: concern.id,
    concernTitle: concern.title,
    concernType: concern.type,
    originalDescription: concern.description,
    action: "DELETE",
    verdict: "DELETED",
    reasoning:
      "User marked this concern as not part of the claimed invention (implementation detail or out of scope).",
    followUpQuestion: null,
    sessionId,
  };
}

export async function runAddressConcerns(payload: AddressConcernsPayload) {
  const {
    sessionId,
    glossary = {},
    originalIdea,
    examinerConcerns = [],
    concernResponses = [],
  } = payload;

  console.log(
    `>>> [M1-1f ADDRESS-CONCERNS] <<< Addressing concerns — ${examinerConcerns.length} concerns, ${concernResponses.length} responses`
  );

  const responseMap = new Map<string, ConcernResponse>();
  for (const r of concernResponses) responseMap.set(r.concernId, r);

  const items = examinerConcerns
    .map((concern) => {
      const response = responseMap.get(concern.id);
      if (!response) return null;
      return { concern, response };
    })
    .filter((x): x is { concern: Concern; response: ConcernResponse } => x !== null);

  const config = loadAgentConfig("module1/1f/examiner-review.config.json");
  const systemPrompt = loadPrompt("module1/1f/examiner-review.md");

  const verdicts = await Promise.all(
    items.map(({ concern, response }) => {
      if (response.action === "DELETE") {
        return Promise.resolve(handleDelete(concern, sessionId));
      }
      return reviewFix(concern, response.fixText || "", originalIdea, glossary, sessionId, systemPrompt, config);
    })
  );

  const resolved = verdicts.filter((v) => v.verdict === "RESOLVED");
  const needsMore = verdicts.filter((v) => v.verdict === "NEEDS_MORE");
  const deleted = verdicts.filter((v) => v.verdict === "DELETED");

  const allConcernsAddressed = needsMore.length === 0;
  const nextStep = allConcernsAddressed
    ? "All concerns addressed. Ready to proceed to /brainstorm-finalize to generate the final concept."
    : `${needsMore.length} concern(s) need more detail. Review the followUpQuestion for each and submit updated fixes via /brainstorm-address again.`;

  console.log(
    `>>> [M1-1f ADDRESS-CONCERNS] <<< Verdicts — resolved ${resolved.length}, needsMore ${needsMore.length}, deleted ${deleted.length}`
  );

  return {
    success: true,
    sessionId: sessionId || "",
    verdicts,
    summary: {
      total: verdicts.length,
      resolved: resolved.length,
      needsMore: needsMore.length,
      deleted: deleted.length,
    },
    byVerdict: { resolved, needsMore, deleted },
    glossary,
    allConcernsAddressed,
    nextStep,
    timestamp: new Date().toISOString(),
  };
}

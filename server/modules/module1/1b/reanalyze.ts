import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface ReanalyzePayload {
  mainIdea: string;
  previousAdvocate: string;
  previousExaminer: string;
  newIdea: string;
  category?: string;
  projectId?: string;
  sessionId?: string;
  discardedTopics?: string;
}

export async function runReanalyze(payload: ReanalyzePayload) {
  console.log(">>> [M1-1b REANALYZE] <<< direct AI — Advocate + Examiner audit in parallel");
  const [advocateResult, examinerResult] = await Promise.all([
    runAdvocateAudit(payload),
    runExaminerAudit(payload),
  ]);
  console.log(">>> [M1-1b REANALYZE] <<< complete — both agents responded");

  const transcript = `🎭 PATENT GEYSER - ROUND 2 AUDIT\n${'='.repeat(60)}\n\n` +
    `💡 ORIGINAL IDEA: ${payload.mainIdea.substring(0, 100)}...\n\n` +
    `📝 NEW CONSOLIDATED IDEA: ${payload.newIdea.substring(0, 100)}...\n\n` +
    `✅ ADVOCATE AUDIT:\n${advocateResult}\n\n` +
    `❌ EXAMINER AUDIT:\n${examinerResult}\n\n` +
    `${'='.repeat(60)}`;

  return {
    success: true,
    round: 2,
    auditResults: [
      { speaker: "Advocate", message: advocateResult },
      { speaker: "Examiner", message: examinerResult },
    ],
    transcript,
    category: payload.category,
    projectId: payload.projectId,
    sessionId: payload.sessionId,
    metadata: {
      timestamp: new Date().toISOString(),
      roundType: "audit",
      totalAudits: 2,
    },
  };
}

async function runAdvocateAudit(payload: ReanalyzePayload): Promise<string> {
  console.log("[M1-1b/Advocate] Running audit...");
  const config = loadAgentConfig("module1/1b/advocate.config.json");
  const systemPrompt = loadPrompt("module1/1b/advocate.md");

  const userMessage = `CONTEXT DATA:
1. Main Idea (Original): ${payload.mainIdea}
2. My Previous Analysis (The Checklist): ${payload.previousAdvocate}
3. New Consolidated Idea (The Target): ${payload.newIdea}
4. User Discards (Authorized Removals): ${payload.discardedTopics || "None"}

INSTRUCTION:
Perform a "Value Preservation Audit" of the New Consolidated Idea against My Previous Analysis.
Adhere strictly to the "Discard Rule": If a topic is in the User Discards list, mark it DISMISSED.
Return the audit log in strict JSON.`;

  const result = await callAgent({ systemPrompt, userMessage, config, jsonMode: true, usage: { agentCode: "module1/1b-reanalyze-advocate" } });
  console.log("[M1-1b/Advocate] Done");
  return result;
}

async function runExaminerAudit(payload: ReanalyzePayload): Promise<string> {
  console.log("[M1-1b/Examiner] Running audit...");
  const config = loadAgentConfig("module1/1b/examiner.config.json");
  const systemPrompt = loadPrompt("module1/1b/examiner.md");

  const userMessage = `CONTEXT DATA:
1. Main Idea (Original): ${payload.mainIdea}
2. My Previous Analysis (The Checklist): ${payload.previousExaminer}
3. New Consolidated Idea (The Target): ${payload.newIdea}
4. User Discards (Authorized Overrides): ${payload.discardedTopics || "None"}

INSTRUCTION:
Perform a "Rigorous Technical Audit" of the New Consolidated Idea against My Previous Analysis.
Adhere strictly to the "Discard Rule": If a topic is in the User Discards list, mark it DISMISSED.
Return the audit log in strict JSON.`;

  const result = await callAgent({ systemPrompt, userMessage, config, jsonMode: true, usage: { agentCode: "module1/1b-reanalyze-examiner" } });
  console.log("[M1-1b/Examiner] Done");
  return result;
}

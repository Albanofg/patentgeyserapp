import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface DebatePayload {
  idea: string;
  category?: string;
}

export async function runDebate(payload: DebatePayload) {
  const idea = payload.idea;
  console.log(">>> [M1-1a DEBATE] <<< direct AI — Advocate + Examiner in parallel");

  try {
    const [advocateResult, examinerResult] = await Promise.all([
      runAdvocate(idea),
      runExaminer(idea),
    ]);
    console.log(">>> [M1-1a DEBATE] <<< complete — both agents responded");

    const transcript = `🎭 PATENT GEYSER\n${'='.repeat(60)}\n\n` +
      `💡 IDEA: ${idea}\n\n` +
      `✅ ADVOCATE:\n${advocateResult}\n\n` +
      `❌ EXAMINER:\n${examinerResult}\n\n` +
      `${'='.repeat(60)}`;

    return {
      success: true as const,
      data: {
        fullDebate: [
          { speaker: "Advocate", message: advocateResult },
          { speaker: "Examiner", message: examinerResult },
        ],
        transcript,
        category: payload.category || "software",
        totalRounds: 1,
        debateComplete: true,
        metadata: {
          timestamp: new Date().toISOString(),
          rounds: 1,
          totalExchanges: 2,
        },
      },
    };
  } catch (error: any) {
    console.error(">>> [M1-1a DEBATE] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message.includes("empty") || message.includes("no response")
        ? "AI service returned an empty response. Please try again."
        : message || "AI debate failed";
    return {
      success: false as const,
      error: errorMessage,
    };
  }
}

async function runAdvocate(idea: string): Promise<string> {
  console.log("[M1-1a/Advocate] Running...");
  const config = loadAgentConfig("module1/1a/advocate.config.json");
  const systemPrompt = loadPrompt("module1/1a/advocate.md", { idea });
  const result = await callAgent({ systemPrompt, userMessage: idea, config });
  console.log("[M1-1a/Advocate] Done");
  return result;
}

async function runExaminer(idea: string): Promise<string> {
  console.log("[M1-1a/Examiner] Running...");
  const config = loadAgentConfig("module1/1a/examiner.config.json");
  const systemPrompt = loadPrompt("module1/1a/examiner.md", { idea });
  const result = await callAgent({ systemPrompt, userMessage: idea, config });
  console.log("[M1-1a/Examiner] Done");
  return result;
}

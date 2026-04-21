import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface AiModifierPayload {
  projectId?: string;
  sessionId?: string;
  mainIdea: string;
  item: string;
  fromOriginal?: string;
  fromGoodCop?: string;
  fromBadCop?: string;
}

export async function runAiModifier(payload: AiModifierPayload) {
  console.log(`>>> [M1-1e AI-MODIFIER] <<< AI Idea Modifier — refining item: "${payload.item?.substring(0, 60)}..."`);

  try {
    const config = loadAgentConfig("module1/1e/ai-modifier.config.json");
    const systemPrompt = loadPrompt("module1/1e/ai-modifier.md");

    const userMessage =
      `Here is the MAIN IDEA (Context):\n${payload.mainIdea || ""}\n\n` +
      `Here is the TITLE:\n${payload.item || ""}\n\n` +
      `Here is the ORIGINAL IDEA (Draft):\n${payload.fromOriginal || ""}\n\n` +
      `GOOD COP (Features to Integrate):\n${payload.fromGoodCop || ""}\n\n` +
      `BAD COP (Flaws to Fix):\n${payload.fromBadCop || ""}\n\n` +
      `**INSTRUCTIONS:**\n` +
      `Rewrite the ORIGINAL IDEA into a single, scientifically robust technical paragraph.\n` +
      `• **If it's in the ORIGINAL or GOOD COP:** Keep the feature, but describe it with technical precision (e.g., change "it writes like me" to "emulates user-specific syntactic patterns").\n` +
      `• **If it's in the BAD COP:** Fix the flaw by defining the missing mechanism.\n` +
      `• **Format:** Single dense paragraph. Patent English.\n\n` +
      `Output strictly the rewritten text, followed by a line "Improvements Made:" and a short bulleted list of the specific changes applied.`;

    const raw = await callAgent({ systemPrompt, userMessage, config });

    // Parse: split on "Improvements Made:" — improvedIdea is above, improvementsMade is below.
    const parts = raw.split(/Improvements Made:/i);
    const improvedIdea = (parts[0] || "").trim();
    const improvementsMade = parts.length > 1 ? parts[1].trim() : "";

    console.log(`>>> [M1-1e AI-MODIFIER] <<< Done — improvedIdea ${improvedIdea.length} chars, improvementsMade ${improvementsMade.length} chars`);

    return {
      success: true as const,
      data: { improvedIdea, improvementsMade },
    };
  } catch (error: any) {
    console.error(">>> [M1-1e AI-MODIFIER] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message || "AI idea modifier failed";
    return {
      success: false as const,
      error: errorMessage,
    };
  }
}

import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface MechanicPayload {
  projectId?: string;
  sessionId?: string;
  currentIdea: string;
  userRequest: string;
}

/**
 * Patent Mechanic — applies a single inline refinement command (add / fix /
 * remove / change / modify) to the current invention description. Replaces the
 * legacy n8n webhook at /webhook/idea-modifier; the call site in routes.ts
 * uses `n8nResponse.data.modifiedIdea`, so the success-shape mirrors that
 * exactly. Optional fields (qualityScore, validation, transcript) are left
 * undefined and the route falls back to its existing defaults.
 */
export async function runMechanic(payload: MechanicPayload) {
  const requestPreview = (payload.userRequest || "").substring(0, 80);
  console.log(`>>> [M1-mechanic] <<< Patent Mechanic — applying: "${requestPreview}"`);

  try {
    const config = loadAgentConfig("module1/mechanic/mechanic.config.json");
    const systemPrompt = loadPrompt("module1/mechanic/mechanic.md");

    const userMessage =
      `CURRENT IDEA:\n${payload.currentIdea || ""}\n\n` +
      `USER REQUEST:\n${payload.userRequest || ""}\n\n` +
      `Apply the USER REQUEST to the CURRENT IDEA per your output format.`;

    const raw = await callAgent({
      systemPrompt,
      userMessage,
      config,
      usage: { agentCode: "module1/mechanic" },
    });

    // Mirror the 1e-ai-modifier splitter pattern: text output divided by a
    // literal label. modifiedIdea is everything above "Changes Applied:";
    // changesApplied is everything below.
    const parts = raw.split(/Changes Applied:/i);
    const modifiedIdea = (parts[0] || "").trim();
    const changesApplied = parts.length > 1 ? parts[1].trim() : "";

    console.log(
      `>>> [M1-mechanic] <<< Done — modifiedIdea ${modifiedIdea.length} chars, ` +
        `changesApplied ${changesApplied.length} chars`,
    );

    return {
      success: true as const,
      data: { modifiedIdea, changesApplied },
    };
  } catch (error: any) {
    console.error(">>> [M1-mechanic] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage =
      message.includes("timeout") || message.includes("timed out")
        ? "AI service timed out. Please try again."
        : message.includes("empty") || message.includes("no response")
          ? "AI service returned an empty response. Please try again."
          : message || "AI mechanic failed";
    return {
      success: false as const,
      error: errorMessage,
    };
  }
}

import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface NeedsWorkItem {
  original: string;
  advocate: string;
  examiner: string;
  reasoning?: string;
}

interface R3FixesPayload {
  coreIdea: string;
  needsWorkItems: NeedsWorkItem[];
}

export interface R3FixResult extends NeedsWorkItem {
  ai_fix: string;
}

export async function runR3Fixes(payload: R3FixesPayload) {
  const { coreIdea, needsWorkItems } = payload;
  console.log(`>>> [M1-1c R3-FIXES] <<< Generating R3 fixes for ${needsWorkItems.length} items`);

  if (!needsWorkItems || needsWorkItems.length === 0) {
    return { success: true, data: [] as R3FixResult[] };
  }

  const config = loadAgentConfig("module1/1c/r3-fixes.config.json");
  const systemPrompt = loadPrompt("module1/1c/r3-fixes.md");

  const results = await Promise.all(
    needsWorkItems.map(async (item, idx): Promise<R3FixResult> => {
      const userMessage =
        `Core Idea: ${coreIdea}\n\n` +
        `Original: ${item.original || ""}\n` +
        `Advocate: ${item.advocate || ""}\n` +
        `Examiner: ${item.examiner || ""}\n\n` +
        `Generate a SHORT fix (max 2-3 sentences). Address the examiner's concerns while maintaining claim strength.`;

      try {
        const ai_fix = (await callAgent({ systemPrompt, userMessage, config, usage: { agentCode: "module1/1c-r3-fixes" } })).trim();
        return { ...item, ai_fix };
      } catch (err: any) {
        console.error(`>>> [M1-1c R3-FIXES] <<< Item ${idx} failed:`, err.message);
        return { ...item, ai_fix: "" };
      }
    })
  );

  console.log(`>>> [M1-1c R3-FIXES] <<< Generated ${results.filter((r) => r.ai_fix).length}/${results.length} fixes`);
  return { success: true, data: results };
}

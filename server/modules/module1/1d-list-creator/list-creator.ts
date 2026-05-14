import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface ListCreatorPayload {
  projectId?: string;
  sessionId?: string;
  original: string;
  goodCop: string;
  badCop: string;
}

export interface UnifiedItem {
  label: string;
  fromOriginal: string;
  fromGoodCop: string;
  fromBadCop: string;
}

interface RemovedItem extends UnifiedItem {
  reason?: string;
}

// Parse the List Maker's freeform text output into structured items.
// Expected format per item:
//   Item:
//   <label>
//   From Original:
//   <text>
//   From Good Cop:
//   <text>
//   From Bad Cop:
//   <text>
function parseUnifiedList(agentOutput: string): UnifiedItem[] {
  if (!agentOutput || typeof agentOutput !== "string") return [];

  const itemBlocks = agentOutput.split(/\n\s*Item:/i).slice(1);
  const items: UnifiedItem[] = [];

  for (const block of itemBlocks) {
    const lines = block.trim().split("\n");
    const item: UnifiedItem = { label: "", fromOriginal: "", fromGoodCop: "", fromBadCop: "" };

    item.label = (lines[0] || "").trim();

    let section: keyof UnifiedItem | "" = "";
    let buffer: string[] = [];

    const flush = () => {
      if (section && section !== "label" && buffer.length > 0) {
        item[section] = buffer.join(" ").trim();
      }
    };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("From Original:")) {
        flush();
        section = "fromOriginal";
        buffer = [line.replace("From Original:", "").trim()];
      } else if (line.startsWith("From Good Cop:")) {
        flush();
        section = "fromGoodCop";
        buffer = [line.replace("From Good Cop:", "").trim()];
      } else if (line.startsWith("From Bad Cop:")) {
        flush();
        section = "fromBadCop";
        buffer = [line.replace("From Bad Cop:", "").trim()];
      } else if (line && section) {
        buffer.push(line);
      }
    }
    flush();

    if (item.label) items.push(item);
  }

  return items;
}

async function filterItem(item: UnifiedItem, systemPrompt: string, config: any): Promise<boolean> {
  const userMessage =
    `Evaluate this item for inclusion in final output:\n\n` +
    `Label: ${item.label}\n` +
    `From Original: ${item.fromOriginal}\n` +
    `From Good Cop: ${item.fromGoodCop}\n` +
    `From Bad Cop: ${item.fromBadCop}\n\n` +
    `Respond with ONLY "KEEP" or "REMOVE" (one word only).`;

  try {
    const decision = (await callAgent({ systemPrompt, userMessage, config, usage: { agentCode: "module1/1d-filter" } })).trim().toUpperCase();
    return decision.startsWith("KEEP");
  } catch (err: any) {
    console.error(`[M1-1d/Filter] Item "${item.label}" failed:`, err.message);
    // On failure, default to keeping the item so we don't silently drop content.
    return true;
  }
}

export async function runListCreator(payload: ListCreatorPayload) {
  console.log(">>> [M1-1d LIST-CREATOR] <<< List Creator — generating unified items");

  try {
    const listConfig = loadAgentConfig("module1/1d-list-creator/list-maker.config.json");
    const listSystem = loadPrompt("module1/1d-list-creator/list-maker.md");
    const listUserMessage =
      `Here are the three texts you must analyze:\n\n` +
      `ORIGINAL:\n${payload.original || ""}\n\n` +
      `GOOD COP:\n${payload.goodCop || ""}\n\n` +
      `BAD COP:\n${payload.badCop || ""}\n\n` +
      `Please generate a Unified Items List based on your system rules.\n\n` +
      `Use one unified item per unique idea, and for each item include:\n\n` +
      `Item:\n[a neutral label of the merged idea]\n\n` +
      `From Original:\n[summary or quote, or "Not mentioned"]\n\n` +
      `From Good Cop:\n[summary or quote, or "Not mentioned"]\n\n` +
      `From Bad Cop:\n[summary or quote, or "Not mentioned"]\n\n` +
      `Output only the Unified Items List.`;

    const rawList = await callAgent({
      systemPrompt: listSystem,
      userMessage: listUserMessage,
      config: listConfig,
      usage: { agentCode: "module1/1d-list-maker" },
    });

    const items = parseUnifiedList(rawList);
    console.log(`>>> [M1-1d LIST-CREATOR] <<< Parsed ${items.length} unified items — filtering in parallel`);

    if (items.length === 0) {
      return {
        success: true as const,
        data: { kept: [], removed: [], totalKept: 0, totalRemoved: 0 },
      };
    }

    const filterConfig = loadAgentConfig("module1/1d-list-creator/filter.config.json");
    const filterSystem = loadPrompt("module1/1d-list-creator/filter.md");

    const decisions = await Promise.all(items.map((item) => filterItem(item, filterSystem, filterConfig)));

    const kept: UnifiedItem[] = [];
    const removed: RemovedItem[] = [];
    items.forEach((item, idx) => {
      if (decisions[idx]) {
        kept.push(item);
      } else {
        removed.push({ ...item, reason: "Filter agent marked as redundant" });
      }
    });

    console.log(`>>> [M1-1d LIST-CREATOR] <<< Kept ${kept.length}, removed ${removed.length}`);

    return {
      success: true as const,
      data: {
        kept,
        removed,
        totalKept: kept.length,
        totalRemoved: removed.length,
      },
    };
  } catch (error: any) {
    console.error(">>> [M1-1d LIST-CREATOR] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message || "List creator failed";
    return {
      success: false as const,
      error: errorMessage,
    };
  }
}

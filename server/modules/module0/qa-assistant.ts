import { callAgent, loadAgentConfig, loadPrompt } from "../../ai/client";

interface QAPayload {
  message: string;
  conversationHistory: Array<{ role: string; content: string }>;
  projectContext: {
    projectTitle: string;
    category: string;
    currentStage: number;
    ideaSummary: string;
    extractedIdeas: any[];
    approvedIdeas: any[];
    expandedConcepts: any[];
    selectedConcepts: any[];
    priorArtResults: string;
    whiteSpaceAnalysis: string;
    claimsGenerated: number;
    provisionalDraftStatus: string;
    hasProvisionalDraft: boolean;
    specificClaims: any[];
    broaderClaims: any[];
    hasDiagrams: boolean;
    diagramCount: number;
  };
  currentLocation: string;
}

// Build context sections exactly like the n8n "Parse Chat Input" node
function buildContext(payload: QAPayload): string {
  const { projectContext, conversationHistory, currentLocation } = payload;
  const sections: string[] = [];

  // Project info
  if (projectContext.projectTitle || projectContext.category || projectContext.currentStage) {
    let projectInfo = "## PROJECT INFO";
    if (projectContext.projectTitle) projectInfo += `\nTitle: ${projectContext.projectTitle}`;
    if (projectContext.category) projectInfo += `\nCategory: ${projectContext.category}`;
    if (projectContext.currentStage) projectInfo += `\nCurrent Stage: Module ${projectContext.currentStage}`;
    if (currentLocation) projectInfo += `\nLocation: ${currentLocation}`;
    sections.push(projectInfo);
  }

  // Idea summary
  if (projectContext.ideaSummary) {
    sections.push(`## IDEA SUMMARY\n${projectContext.ideaSummary}`);
  }

  // Status fields
  const statusParts: string[] = [];
  if (projectContext.priorArtResults) statusParts.push(`Prior Art: ${projectContext.priorArtResults}`);
  if (projectContext.whiteSpaceAnalysis) statusParts.push(`White Space: ${projectContext.whiteSpaceAnalysis}`);
  if (projectContext.claimsGenerated) statusParts.push(`Claims Generated: ${projectContext.claimsGenerated}`);
  if (projectContext.hasProvisionalDraft) statusParts.push(`Provisional Draft: Ready`);
  if (projectContext.hasDiagrams) statusParts.push(`Diagrams: ${projectContext.diagramCount || "Yes"}`);
  if (statusParts.length) sections.push(`## STATUS\n${statusParts.join("\n")}`);

  // Claims (truncated for token efficiency)
  if (projectContext.specificClaims?.length) {
    const claimsPreview = projectContext.specificClaims.slice(0, 3).join("\n\n");
    const moreCount = projectContext.specificClaims.length - 3;
    sections.push(
      `## SPECIFIC CLAIMS (${projectContext.specificClaims.length} total)\n${claimsPreview}${moreCount > 0 ? `\n\n[...and ${moreCount} more claims]` : ""}`
    );
  }

  // Broader claims
  if (projectContext.broaderClaims?.length) {
    sections.push(
      `## BROADER CLAIMS (${projectContext.broaderClaims.length} total)\n${projectContext.broaderClaims.slice(0, 2).join("\n\n")}`
    );
  }

  // Conversation history (last 4 messages, truncated)
  if (conversationHistory?.length) {
    const recentHistory = conversationHistory
      .slice(-4)
      .map((m) => `${m.role.toUpperCase()}: ${m.content.length > 300 ? m.content.substring(0, 300) + "..." : m.content}`)
      .join("\n\n");
    sections.push(`## RECENT CONVERSATION\n${recentHistory}`);
  }

  return sections.length ? sections.join("\n\n---\n\n") : "";
}

export async function runQAAssistant(payload: QAPayload): Promise<string> {
  console.log("[Module0/QA-Assistant] Running...");
  const config = loadAgentConfig("module0/qa-assistant.config.json");
  const systemPrompt = loadPrompt("module0/qa-assistant.md");

  const context = buildContext(payload);

  // Match exactly what n8n sends to the agent
  const userMessage = `This is the User Input:\n${payload.message}\n\nThis is the Project Context:\n${context}`;

  const result = await callAgent({
    systemPrompt,
    userMessage,
    config,
    jsonMode: false,
  });
  console.log("[Module0/QA-Assistant] Done");
  return result;
}

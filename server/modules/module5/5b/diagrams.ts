import { callAgentJSON, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface CodeSnippet {
  text?: string;
  code?: string;
}

interface DiagramsPayload {
  title?: string;
  detailed_description?: string;
  patent_text?: string;
  patent_title?: string;
  codeFromTheUser?: Record<string, CodeSnippet>;
  // User-selected key concepts (this app's claims-equivalent). Passed
  // explicitly so the planner is required to cover each one with a figure,
  // independent of how prominently they appear in the patent text blob.
  keyConcepts?: string;
}

interface PlannedDiagram {
  title?: string;
  diagramType?: string;
  figureId?: string | null;
  detailed_description?: string;
  referenced_components?: string[];
  eraserDSL?: string;
}

interface PlannerOutput {
  diagrams?: PlannedDiagram[];
}

interface FlowchartResult {
  chartNumber: number;
  title: string;
  figureId: string | null;
  diagramType: string;
  imageUrl: string | null;
  editLink: string | null;
  diagramCode: string | null;
  markdown: string;
  success: boolean;
  error?: string;
  referenced_components?: string[];
  referenced_components_missing?: string[];
}

const ERASER_ENDPOINT = "https://app.eraser.io/api/render/prompt";

const ERASER_TYPE_MAP: Record<string, string> = {
  flowchart: "cloud-architecture-diagram",
  "system-architecture": "cloud-architecture-diagram",
  "data-model": "entity-relationship-diagram",
  "component-map": "cloud-architecture-diagram",
  "sequence-diagram": "sequence-diagram",
};

function extractPatentText(payload: DiagramsPayload) {
  const title = payload.title || payload.patent_title || "Untitled";
  const patentText = payload.detailed_description || payload.patent_text || "";

  const codeFromTheUser = payload.codeFromTheUser || {};
  const codeSnippets: { id: string; text: string; code: string }[] = [];
  let formattedCode = "";

  for (const key of Object.keys(codeFromTheUser)) {
    if (!key.startsWith("code")) continue;
    const snippet = codeFromTheUser[key] || {};
    codeSnippets.push({
      id: key,
      text: snippet.text || "",
      code: snippet.code || "",
    });
    formattedCode += `\n--- ${snippet.text || key} ---\n${snippet.code || ""}\n`;
  }

  return { title, patentText, codeSnippets, codeCount: codeSnippets.length, formattedCode };
}

function allocateFigureIds(diagrams: PlannedDiagram[]): PlannedDiagram[] {
  let nextFig = 1;
  for (const d of diagrams) {
    const fig = d.figureId;
    if (fig && typeof fig === "string") {
      const match = fig.match(/(\d+)/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n >= nextFig) nextFig = n + 1;
      }
    }
  }
  return diagrams.map((d) => {
    if (d.figureId) return d;
    return { ...d, figureId: `FIG. ${nextFig++}` };
  });
}

function checkComponents(d: PlannedDiagram): {
  present: string[];
  missing: string[];
} {
  const desc = d.detailed_description || "";
  const comps = Array.isArray(d.referenced_components) ? d.referenced_components : [];
  const present: string[] = [];
  const missing: string[] = [];
  for (const c of comps) {
    if (!c) continue;
    if (desc.includes(String(c))) present.push(c);
    else missing.push(c);
  }
  return { present, missing };
}

function buildEraserPrompt(d: PlannedDiagram): {
  userPrompt: string;
  diagramType: string;
  eraserDSL: string | null;
  useElementsAPI: boolean;
} {
  const title = d.title || "Untitled";
  const detailedDescription = d.detailed_description || "";
  const rawDiagramType = (d.diagramType || "flowchart").toLowerCase().trim();
  const eraserDSL = d.eraserDSL || null;

  const eraserType = ERASER_TYPE_MAP[rawDiagramType] || "flowchart-diagram";
  const useElementsAPI = eraserType === "flowchart-diagram" && !!eraserDSL;

  const layoutInstruction =
    !useElementsAPI && (eraserType === "flowchart-diagram" || eraserType === "cloud-architecture-diagram")
      ? "IMPORTANT: Use vertical top-to-bottom layout (direction down). The flow must go from top to bottom, NOT left to right. This is required for patent PDF formatting.\n\n"
      : "";

  const bwInstruction =
    "CRITICAL STYLE REQUIREMENT: This diagram must be black and white only, with no color of any kind. All shapes must have a white fill and black borders. All lines and arrows must be black. All text must be black. All group containers and bounding boxes must have a white or transparent fill with a black border — no colored backgrounds on groups. Do not use any color fills, gradients, shadows, or colored backgrounds on any element, group, or container. This is a strict requirement for USPTO/PCT patent compliance.\n\n";

  const userPrompt = `Title: ${title}\n\n${bwInstruction}${layoutInstruction}${detailedDescription}`;

  return { userPrompt, diagramType: eraserType, eraserDSL, useElementsAPI };
}

async function callEraser(
  prompt: string,
  diagramType: string,
): Promise<{ imageUrl: string | null; editLink: string | null; diagramCode: string | null; raw: any }> {
  const apiKey = process.env.ERASER_API_KEY;
  if (!apiKey) {
    throw new Error("ERASER_API_KEY not set");
  }

  const resp = await fetch(ERASER_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      text: prompt,
      diagramType,
      mode: "standard",
      theme: "light",
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Eraser API ${resp.status}: ${errText.substring(0, 300)}`);
  }

  const data: any = await resp.json();
  return {
    imageUrl: data?.imageUrl || null,
    editLink: data?.createEraserFileUrl || null,
    diagramCode: data?.diagrams?.[0]?.code || null,
    raw: data,
  };
}

export async function runDiagrams(payload: DiagramsPayload) {
  console.log(">>> [M5-5b DIAGRAMS] <<< Generating patent diagrams");

  try {
    const { title, patentText, codeCount, formattedCode } = extractPatentText(payload);

    // Step 1: AI plans diagrams
    const config = loadAgentConfig("module5/5b/planner.config.json");
    const systemPrompt = loadPrompt("module5/5b/planner.md");

    const keyConceptsBlock = (payload.keyConcepts || "").trim();
    const userMessage =
      `Provisional Patent Title: ${title}\n` +
      `Provisional Patent Text: ${patentText}\n\n` +
      (keyConceptsBlock
        ? `MANDATORY KEY CONCEPTS TO COVER (each MUST be represented in at least one figure):\n${keyConceptsBlock}\n\n`
        : "") +
      `Code Snippets Uploaded by the User (${codeCount} total):\n${formattedCode}`;

    const plan = await callAgentJSON<PlannerOutput>({
      systemPrompt,
      userMessage,
      config,
    });

    let diagrams = Array.isArray(plan.diagrams) ? plan.diagrams : [];
    if (diagrams.length === 0) {
      return {
        success: false as const,
        error: "Planner returned no diagrams.",
      };
    }

    // Step 2: Allocate figure IDs
    diagrams = allocateFigureIds(diagrams);

    // Step 3: Call Eraser per diagram, in parallel
    const results: FlowchartResult[] = await Promise.all(
      diagrams.map(async (d, index) => {
        const chartNumber = index + 1;
        const diagramTitle = d.title || `Diagram ${chartNumber}`;
        const figureId = d.figureId || null;
        const { present, missing } = checkComponents(d);
        const { userPrompt, diagramType } = buildEraserPrompt(d);

        try {
          const eraserResp = await callEraser(userPrompt, diagramType);
          const markdown = eraserResp.imageUrl
            ? `![Flowchart](${eraserResp.imageUrl})\n\n**[Edit in Eraser](${eraserResp.editLink || ""})**`
            : "";
          return {
            chartNumber,
            title: diagramTitle,
            figureId,
            diagramType,
            imageUrl: eraserResp.imageUrl,
            editLink: eraserResp.editLink,
            diagramCode: eraserResp.diagramCode,
            markdown,
            success: !!eraserResp.imageUrl,
            referenced_components: present,
            referenced_components_missing: missing,
          };
        } catch (err: any) {
          console.error(`>>> [M5-5b DIAGRAMS] <<< Eraser failed for "${diagramTitle}":`, err.message);
          return {
            chartNumber,
            title: diagramTitle,
            figureId,
            diagramType,
            imageUrl: null,
            editLink: null,
            diagramCode: null,
            markdown: "",
            success: false,
            error: err.message || String(err),
            referenced_components: present,
            referenced_components_missing: missing,
          };
        }
      }),
    );

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;

    console.log(
      `>>> [M5-5b DIAGRAMS] <<< Done — ${results.length} diagrams (${successful} ok, ${failed} failed)`,
    );

    return {
      success: true as const,
      totalFlowcharts: results.length,
      successful,
      failed,
      flowcharts: results,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(">>> [M5-5b DIAGRAMS] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message.includes("ERASER_API_KEY")
        ? "Eraser API key is not configured. Set ERASER_API_KEY in environment."
        : message.includes("Failed to parse AI response as JSON")
          ? "Diagram planner returned invalid JSON. Please try again."
          : message || "Diagrams generation failed";
    return { success: false as const, error: errorMessage };
  }
}

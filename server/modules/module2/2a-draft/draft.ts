import { callAgent, loadAgentConfig, loadPrompt } from "../../../ai/client";

interface DraftPayload {
  sessionId?: string;
  ideaSummary: string;
  goodCopInsights?: unknown;
  badCopChallenges?: unknown;
  fullTranscript?: string;
  additionalNotes?: string;
  refinementFeedback?: string;
  idea?: string;
  category?: string;
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join("\n\n");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export async function runDraft(payload: DraftPayload) {
  console.log(">>> [M2 DRAFT] <<< Generating provisional draft");

  try {
    const config = loadAgentConfig("module2/2a-draft/draft.config.json");
    const systemPrompt = loadPrompt("module2/2a-draft/draft.md");

    // ─── User-message construction — pinned to COMPILATION mode ───────────
    // The draft.md prompt has two modes:
    //   COMPILATION — five canonical inputs (IDEA SUMMARY, GOOD COP, BAD COP,
    //     FULL TRANSCRIPT, optional INVENTOR-CONFIRMED CANDIDATES). Rebuilds
    //     the Core Concept Definition from source-confirmed material.
    //   REFINEMENT — requires both PRIOR CORE CONCEPT DEFINITION and a
    //     TYPED OPERATIONS LIST (ADD | REMOVE | MODIFY | PROMOTE | REJECT).
    //     If non-conforming entries arrive (e.g., free-text feedback), LAW_9
    //     mandates the model emit "TYPED_OPERATION_INVALID" and halt — which
    //     used to land verbatim as the inventor's draft on the Expand Idea
    //     screen because the server saved whatever the model returned.
    //
    // The server does not have typed operations to send (we collect free-text
    // refinement feedback from a textarea, not structured ops), so we must
    // never trigger REFINEMENT mode. Previously we sent the feedback under a
    // "REFINEMENT FEEDBACK:" label, which (a) is not a recognized mode-
    // detection trigger, and (b) sometimes primed the model to interpret the
    // call as a refinement anyway and fire TYPED_OPERATION_INVALID.
    //
    // Fix: route the inventor's feedback through "INVENTOR-CONFIRMED
    // CANDIDATES" — the optional fifth COMPILATION input. Per the prompt's
    // PHASE_2 conflict-resolution order, that channel "wins over all," which
    // is exactly the semantic the inventor wants ("do what I say"). We never
    // send PRIOR CORE CONCEPT DEFINITION or TYPED OPERATIONS LIST under any
    // circumstance, so mode detection in PHASE_1 cannot select REFINEMENT.
    //
    // Result: every call is a clean COMPILATION pass, the prompt's well-
    // tested compilation pipeline runs every time, and TYPED_OPERATION_INVALID
    // can no longer emit. The defensive sentinel detection below stays as
    // belt-and-suspenders in case the model ever returns a sentinel for a
    // reason we haven't anticipated.
    const inventorFeedback = stringify(payload.refinementFeedback).trim();
    const userMessage =
      `IDEA SUMMARY:\n${stringify(payload.ideaSummary)}\n\n` +
      `GOOD COP ANALYSIS:\n${stringify(payload.goodCopInsights)}\n\n` +
      `BAD COP ANALYSIS:\n${stringify(payload.badCopChallenges)}\n\n` +
      `FULL TRANSCRIPT:\n${stringify(payload.fullTranscript)}\n\n` +
      `INVENTOR-CONFIRMED CANDIDATES:\n${inventorFeedback || "(none — initial compilation pass)"}\n\n` +
      `Your task is to evaluate all five sections in COMPILATION MODE.\nUse them exactly as provided.\nDo not infer priority — the system message defines the authority chain and conflict-resolution order.\nINVENTOR-CONFIRMED CANDIDATES wins over all other sources per PHASE_2.`;

    const provisionalDraft = await callAgent({ systemPrompt, userMessage, config, usage: { agentCode: "module2/2a-draft" } });

    console.log(`>>> [M2 DRAFT] <<< Done — ${provisionalDraft.length} chars`);

    // The draft.md prompt defines three failure sentinels that the model
    // returns on its own when its contract is violated (LAW_1/LAW_9/LAW_10):
    //   - TYPED_OPERATION_INVALID       (refinement got free-text instead of typed ops)
    //   - MODE_DETECTION_FAILED          (neither compilation nor refinement inputs complete)
    //   - DIFF_TRACEABILITY_VIOLATION    (refinement produced orphan diff entries)
    // When the model emits one of these as a single line, it has halted and
    // the response is NOT a draft — it's a self-reported error. Saving it
    // verbatim as `provisionalDraft` (which is what used to happen) overwrites
    // the inventor's previous good draft with a string like "TYPED_OPERATION_INVALID 1. Remove all references…",
    // visible on the Expand Idea screen. Detect any of the sentinels here and
    // return success:false so the route's existing error path fires: 503 with
    // a clear "Please try again" message, no DB write, no stale snapshot, and
    // the inventor's prior draft is preserved untouched.
    const SENTINEL_RE = /^\s*(TYPED_OPERATION_INVALID|MODE_DETECTION_FAILED|DIFF_TRACEABILITY_VIOLATION)\b/;
    const sentinelMatch = provisionalDraft.match(SENTINEL_RE);
    if (sentinelMatch) {
      const sentinel = sentinelMatch[1];
      console.warn(`>>> [M2 DRAFT] <<< model emitted ${sentinel} — treating as failure, not saving to draft`);
      const isRefinement = !!payload.refinementFeedback;
      const guidance = sentinel === "TYPED_OPERATION_INVALID"
        ? (isRefinement
            ? "The refinement instructions couldn't be applied cleanly. Try rephrasing the feedback as a clearer list of specific edits (e.g., 'replace X with Y', 'add Z to the Anatomy paragraph'), then regenerate."
            : "The model rejected the input as malformed. Please try again.")
        : sentinel === "MODE_DETECTION_FAILED"
          ? "Some required input is missing. Make sure the original idea, debate, and transcript are all present, then try again."
          : "The refinement produced an inconsistent change set. Please try again with a slightly different phrasing.";
      return {
        success: false as const,
        error: guidance,
      };
    }

    return {
      success: true as const,
      provisionalDraft,
      idea: payload.idea ?? payload.ideaSummary,
      category: payload.category || "software",
      metadata: {
        timestamp: new Date().toISOString(),
        wordCount: provisionalDraft.split(/\s+/).filter(Boolean).length,
        draftType: "provisional",
      },
    };
  } catch (error: any) {
    console.error(">>> [M2 DRAFT] <<< failed:", error);
    const message = error?.message || String(error);
    const errorMessage = message.includes("timeout") || message.includes("timed out")
      ? "AI service timed out. Please try again."
      : message.includes("empty") || message.includes("no response")
        ? "AI service returned an empty response. Please try again."
        : message || "Provisional draft generation failed";
    return {
      success: false as const,
      error: errorMessage,
    };
  }
}

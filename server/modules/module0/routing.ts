/**
 * Turn-router state-machine computation for the Module 0 AI Helper.
 *
 * Implements the SERVER_CONTRACT section of qa-assistant.md (v5.4):
 *   1. SCOPE DETERMINATION — derive the in-scope stable ids per stage
 *   2. PROGRESS COMPUTATION — leapProgress map from pohcLog + openQuestions
 *   3. TARGET SELECTION — lowest-numbered non-complete id
 *   4. PHASE EMISSION — currentLeapPhase from target's progress
 *
 * v1 coverage:
 *   - Stages 1, 3, 7 → procedural (empty scope)
 *   - Stage 4 → selected concepts from agent3 / projectContext
 *   - Stages 2, 5, 6 → empty scope for now (procedural fallback)
 *
 * The agent reads the emitted fields verbatim and never re-derives them.
 */

export type LeapStatus =
  | "not_started"
  | "turn_a_pending"
  | "turn_b_pending"
  | "complete";

export interface RoutingFields {
  scope: string[];
  leapProgress: Record<string, LeapStatus>;
  currentLeapTarget: string | null;
  currentLeapPhase: LeapStatus | null;
}

interface PohcLogRow {
  entryType: string | null;
  verbatimText: string | null;
  editedText?: string | null;
  tags: string[] | null;
}

interface OpenQuestionRow {
  question: string;
  // The display id minted by the server when the question was created.
  displayId?: string;
  tags?: string[] | null;
}

/**
 * Stage 2 scope per SERVER_CONTRACT: Concept ids in the expansion stage.
 * The contract's narrower heuristic ("expansions introducing new architectural
 * framing") can't be computed without re-parsing chat history, so we expose
 * every expanded concept and let leapProgress completion drive routing.
 */
function stage2Scope(projectContext: Record<string, any>): string[] {
  const expanded: any[] = (projectContext.expandedConcepts as any[]) || [];
  return expanded.map((_, i) => `Concept ${i + 1}`);
}

/**
 * Stage 4 scope per SERVER_CONTRACT: "all selected Concept ids ... surviving
 * into the white space analysis." That's exactly the array of concepts the 4a
 * whitespace step analyzed — conceptAnalyses (new shape) or nuggetAnalyses
 * (legacy). Array order = Concept N numbering; stable as long as the
 * analysis isn't re-run mid-session.
 */
function stage4Scope(projectContext: Record<string, any>): string[] {
  const analyses: any[] = (projectContext.conceptAnalyses as any[]) || [];
  return analyses.map((_, i) => `Concept ${i + 1}`);
}

/**
 * Stage 5 scope per SERVER_CONTRACT: Key Concept Set ids selected in 4b.
 * Order in selectedKeyConcepts defines the "Key Concept Set N" numbering.
 */
function stage5Scope(projectContext: Record<string, any>): string[] {
  const kcs: any[] = (projectContext.selectedKeyConcepts as any[]) || [];
  return kcs.map((_, i) => `Key Concept Set ${i + 1}`);
}

/**
 * Stage 6 scope per SERVER_CONTRACT and PHASE_6 spec (qa-assistant.md:688):
 * compound ids `<Key Concept Set N>_<dimension>` for every (KCSet, dimension)
 * pair. Dimensions are the three Proof of Human Conception validation axes:
 * conception, contribution_quality, exceeding_known. The server enumerates
 * all pairs and lets leapProgress completion drive which one gets attention
 * via currentLeapTarget.
 */
const STAGE6_DIMENSIONS = ["conception", "contribution_quality", "exceeding_known"];

function stage6Scope(projectContext: Record<string, any>): string[] {
  const kcs: any[] = (projectContext.selectedKeyConcepts as any[]) || [];
  const out: string[] = [];
  kcs.forEach((_, i) => {
    for (const dim of STAGE6_DIMENSIONS) {
      out.push(`Key Concept Set ${i + 1}_${dim}`);
    }
  });
  return out;
}

/**
 * Match a tag list against a target id. The agent tags entries with the
 * exact stable id ("Concept 21"), so a strict equality check is sufficient.
 */
function tagsInclude(tags: string[] | null | undefined, id: string): boolean {
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => typeof t === "string" && t === id);
}

/**
 * Does an entry's tag set satisfy a scope id? Stage 6 scope ids are compound
 * (`Key Concept Set N_<dimension>`) but the agent tags pohc_answer entries with
 * the COMPONENTS separately — `["<questionId>", "Key Concept Set N", "<dimension>"]`
 * per qa-assistant.md PHASE_6 — so a strict equality check against the compound
 * id never matches, leaving every dimension stuck at not_started and freezing
 * the walk on the first concept. Accept either the compound id as a single tag
 * OR both component tags present. Non-compound ids fall back to exact match, so
 * stages 1–5 are unaffected.
 */
export function tagsSatisfyScopeId(tags: string[] | null | undefined, id: string): boolean {
  if (tagsInclude(tags, id)) return true;
  const compound = id.match(/^(Key Concept Set \d+)_(.+)$/);
  if (compound) {
    const [, setId, dimension] = compound;
    return tagsInclude(tags, setId) && tagsInclude(tags, dimension);
  }
  return false;
}

/**
 * Compute the per-id leap progress map. A leap is complete when pohcLog
 * contains a first_conceptual_leap entry tagged to the id (Stages 2/4/5)
 * OR a pohc_answer entry tagged to the id (Stage 6). It's turn_b_pending
 * when an open question is tagged to the id without a completing entry.
 * Otherwise not_started.
 */
function computeLeapProgress(
  scope: string[],
  pohcLog: PohcLogRow[],
  openQuestions: OpenQuestionRow[],
  stage: number,
): Record<string, LeapStatus> {
  const out: Record<string, LeapStatus> = {};
  const completionTypes = stage === 6
    ? new Set(["pohc_answer"])
    : new Set(["first_conceptual_leap"]);

  // First pass: mark complete-or-not_started without considering open
  // questions. We do this independently because the agent's
  // `addOpenQuestion` tool doesn't always tag the question with the leap
  // target, so a tag-based match was producing false negatives — the
  // question existed in the raw list but routing reported `not_started`,
  // and the prompt treated that pair as a state contradiction.
  for (const id of scope) {
    const completed = pohcLog.some(
      (e) => completionTypes.has(e.entryType || "") && tagsSatisfyScopeId(e.tags, id),
    );
    out[id] = completed ? "complete" : "not_started";
  }

  // SERVER_CONTRACT enforces "one open question at a time, attached to the
  // current leap target" (addOpenQuestion dismisses all prior open questions
  // when a new one is added). So if any open question exists, it belongs to
  // the lowest-numbered non-complete scope id — that's the currentLeapTarget
  // by definition. Mark that id as turn_b_pending. If the question is
  // explicitly tagged to a scope id, prefer that tag — but never produce
  // the "question exists but everyone is not_started" contradiction.
  const anyOpenQ = openQuestions.length > 0;
  if (anyOpenQ) {
    const explicitlyTagged = scope.filter((id) =>
      openQuestions.some((q) => tagsInclude(q.tags ?? null, id)),
    );
    const idsToFlag = explicitlyTagged.length > 0
      ? explicitlyTagged
      : (() => {
          const nonComplete = scope
            .filter((id) => out[id] !== "complete")
            .sort(compareIds);
          return nonComplete.length > 0 ? [nonComplete[0]] : [];
        })();
    for (const id of idsToFlag) {
      if (out[id] !== "complete") {
        out[id] = "turn_b_pending";
      }
    }
  }

  return out;
}

/**
 * Stable id ordering for "Concept N" and "Key Concept Set N" — numeric
 * suffix ascending. Compound ids ("Concept 21_conception") sort by the
 * numeric portion of the leading label.
 */
function compareIds(a: string, b: string): number {
  const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
  const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
  if (numA !== numB) return numA - numB;
  return a.localeCompare(b);
}

export function computeRouting(
  stage: number | null | undefined,
  projectContext: Record<string, any>,
  pohcLog: PohcLogRow[],
  openQuestions: OpenQuestionRow[],
): RoutingFields {
  // Procedural stages — no leap activity.
  if (stage == null || stage === 1 || stage === 3 || stage === 7) {
    return {
      scope: [],
      leapProgress: {},
      currentLeapTarget: null,
      currentLeapPhase: null,
    };
  }

  let scope: string[];
  if (stage === 2) {
    scope = stage2Scope(projectContext);
  } else if (stage === 4) {
    scope = stage4Scope(projectContext);
  } else if (stage === 5) {
    scope = stage5Scope(projectContext);
  } else if (stage === 6) {
    scope = stage6Scope(projectContext);
  } else {
    scope = [];
  }

  const leapProgress = computeLeapProgress(scope, pohcLog, openQuestions, stage);

  // Target = lowest-numbered id whose status is not complete. Null if
  // every in-scope id is complete OR the scope is empty.
  const nonComplete = scope.filter((id) => leapProgress[id] !== "complete");
  nonComplete.sort(compareIds);
  const currentLeapTarget = nonComplete[0] ?? null;
  const currentLeapPhase = currentLeapTarget
    ? leapProgress[currentLeapTarget]
    : null;

  return { scope, leapProgress, currentLeapTarget, currentLeapPhase };
}

/**
 * Render the routing fields as a markdown block for the Runtime Context Block.
 * Matches the field names the prompt's TURN_ROUTER reads.
 */
export function renderRouting(routing: RoutingFields): string {
  const lines: string[] = [];
  lines.push(`scope: [${routing.scope.map((s) => `"${s}"`).join(", ")}]`);
  const entries = Object.entries(routing.leapProgress);
  if (entries.length === 0) {
    lines.push(`leapProgress: {}`);
  } else {
    lines.push(`leapProgress:`);
    for (const [id, status] of entries) {
      lines.push(`  ${id}: ${status}`);
    }
  }
  lines.push(
    `currentLeapTarget: ${routing.currentLeapTarget === null ? "null" : `"${routing.currentLeapTarget}"`}`,
  );
  lines.push(
    `currentLeapPhase: ${routing.currentLeapPhase === null ? "null" : `"${routing.currentLeapPhase}"`}`,
  );
  return lines.join("\n");
}

// Project Families library — CRUD, ownership check, save-time digest writer,
// and the read-only sibling/overlap read paths.
//
// Cost-control design (locked in with the user):
//   - The digest of a sibling's notable content (idea summary, extracted ideas,
//     key concepts) is computed exactly ONCE per save by the owning project
//     and cached in inventor_geyser.project_family_artifacts.
//   - Every later sibling-reference / overlap check is a pure indexed SQL read
//     against that cache. No agents fire, no AI calls, no live re-read of
//     other projects.
//   - V1 ships hash-only (instant exact-match overlap). The `embedding` JSONB
//     column is populated lazily (V1.1) without schema change.
//   - All write paths here are safe no-ops when the project has no familyId —
//     so families introduce zero overhead for projects that never join one.
//
// All DB operations are additive (INSERT / UPDATE / ON DELETE SET NULL by FK).
// No DROP / DELETE / TRUNCATE — DB is shared with 3 sibling apps.

import { createHash } from "crypto";
import type { Request } from "express";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  agentData,
  projectFamilies,
  projectFamilyArtifacts,
  projects,
  type ProjectFamily,
  type ProjectFamilyArtifact,
} from "@shared/schema";
import { db } from "../db";
import { embedBatch, embedOne } from "./embeddings";

// -----------------------------------------------------------------------------
// Ownership
// -----------------------------------------------------------------------------

export type FamilyOwnerKind = "legacy" | "paid";

export function sessionOwnsFamily(
  req: Request,
  family: Pick<ProjectFamily, "ownerUserId" | "inventorsUserId"> | null | undefined,
): boolean {
  if (!family) return false;
  const session = req.session as any;
  const sid: string | undefined = session?.userId;
  if (!sid) return false;
  const kind: FamilyOwnerKind = session.userKind === "paid" ? "paid" : "legacy";
  return kind === "paid"
    ? family.inventorsUserId === sid
    : family.ownerUserId === sid;
}

// -----------------------------------------------------------------------------
// Family CRUD
// -----------------------------------------------------------------------------

export interface CreateFamilyInput {
  ownerKind: FamilyOwnerKind;
  ownerId: string;
  title: string;
  description?: string | null;
}

export async function createFamily(input: CreateFamilyInput): Promise<ProjectFamily> {
  const [row] = await db
    .insert(projectFamilies)
    .values({
      title: input.title,
      description: input.description ?? null,
      ownerUserId: input.ownerKind === "legacy" ? input.ownerId : null,
      inventorsUserId: input.ownerKind === "paid" ? input.ownerId : null,
    })
    .returning();
  return row;
}

export async function getFamily(id: string): Promise<ProjectFamily | undefined> {
  const [row] = await db
    .select()
    .from(projectFamilies)
    .where(and(eq(projectFamilies.id, id), isNull(projectFamilies.deletedAt)))
    .limit(1);
  return row;
}

export async function listFamiliesByOwner(
  owner: { kind: "legacy"; ownerId: string } | { kind: "paid"; ownerId: string },
): Promise<ProjectFamily[]> {
  const condition =
    owner.kind === "legacy"
      ? eq(projectFamilies.ownerUserId, owner.ownerId)
      : eq(projectFamilies.inventorsUserId, owner.ownerId);
  return db
    .select()
    .from(projectFamilies)
    .where(and(condition, isNull(projectFamilies.deletedAt)))
    .orderBy(desc(projectFamilies.updatedAt));
}

export async function updateFamily(
  id: string,
  patch: { title?: string; description?: string | null },
): Promise<ProjectFamily | undefined> {
  const set: Record<string, any> = { updatedAt: new Date() };
  if (typeof patch.title === "string") set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  const [row] = await db
    .update(projectFamilies)
    .set(set)
    .where(and(eq(projectFamilies.id, id), isNull(projectFamilies.deletedAt)))
    .returning();
  return row;
}

// Soft-delete: marks the family deleted and detaches its members. Member
// projects are NEVER deleted — credits and provenance chains stay intact.
export async function softDeleteFamily(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(projectFamilies)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(projectFamilies.id, id), isNull(projectFamilies.deletedAt)));
    await tx
      .update(projects)
      .set({ familyId: null, updatedAt: new Date() })
      .where(eq(projects.familyId, id));
    // Also null out the cached family_id on the artifact rows so they no
    // longer surface in sibling queries. We keep the rows themselves so
    // re-attaching the project to a new family is instant.
    await tx
      .update(projectFamilyArtifacts)
      .set({ familyId: null })
      .where(eq(projectFamilyArtifacts.familyId, id));
  });
}

// -----------------------------------------------------------------------------
// Membership
// -----------------------------------------------------------------------------

export async function attachProjectToFamily(
  projectId: string,
  familyId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ familyId, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    // Sync the cached family_id on all existing artifact rows for this
    // project. New saves go through refreshFamilyArtifactsBackground.
    await tx
      .update(projectFamilyArtifacts)
      .set({ familyId })
      .where(eq(projectFamilyArtifacts.projectId, projectId));
  });
  // Schedule a backfill for projects that already have agent data — so
  // existing content shows up in the sibling/territory view immediately.
  refreshFamilyArtifactsBackground(projectId, "all");
}

// Batch attach: used when an inventor with many existing patents adds a
// dozen+ siblings to a freshly-created family in one go. Per-project
// transaction so a single failure doesn't roll back the others.
export async function attachManyProjectsToFamily(
  projectIds: string[],
  familyId: string,
): Promise<{ ok: string[]; failed: Array<{ id: string; error: string }> }> {
  const ok: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of projectIds) {
    try {
      await attachProjectToFamily(id, familyId);
      ok.push(id);
    } catch (err: any) {
      failed.push({ id, error: err?.message ?? String(err) });
    }
  }
  return { ok, failed };
}

export async function detachProjectFromFamily(projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ familyId: null, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    await tx
      .update(projectFamilyArtifacts)
      .set({ familyId: null })
      .where(eq(projectFamilyArtifacts.projectId, projectId));
  });
}

export async function listProjectsInFamily(familyId: string) {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.familyId, familyId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.updatedAt));
}

// -----------------------------------------------------------------------------
// Save-time digest writer — the heart of the cost-control story.
// -----------------------------------------------------------------------------

// The cache stores the FULL artifact text — no arbitrary truncation. A cut
// at N characters lands mid-sentence and produces fragments without meaning,
// which defeats the whole point of an overlap preview. If a downstream
// consumer needs to bound size (e.g. the QA prompt's per-turn budget), it
// truncates at a sentence boundary then, not here.

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function normalizeForHash(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

interface DigestRow {
  artifactKind: "idea_summary" | "extracted_idea" | "key_concept";
  artifactRef: string;
  preview: string;
  charCount: number;
  hash: string;
}

// Extracts notable content from an Agent N data blob. Defensive: unknown
// shapes degrade to zero rows rather than throwing — the digest writer must
// never break the existing save path.
function extractDigests(agentNumber: number, data: any): DigestRow[] {
  if (!data || typeof data !== "object") return [];
  const rows: DigestRow[] = [];

  if (agentNumber === 1) {
    const summary: string | undefined =
      typeof data.ideaSummary === "string"
        ? data.ideaSummary
        : typeof data.currentIdea === "string"
        ? data.currentIdea
        : undefined;
    if (summary && summary.trim()) {
      rows.push({
        artifactKind: "idea_summary",
        artifactRef: "main",
        preview: summary,
        charCount: summary.length,
        hash: sha256(normalizeForHash(summary)),
      });
    }
  }

  if (agentNumber === 2) {
    const ideas: any[] =
      Array.isArray(data.extractedIdeas) ? data.extractedIdeas :
      Array.isArray(data.unifiedIdeas) ? data.unifiedIdeas :
      Array.isArray(data.approvedIdeas) ? data.approvedIdeas : [];
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];
      const title: string =
        typeof idea?.title === "string" ? idea.title :
        typeof idea?.name === "string" ? idea.name :
        typeof idea === "string" ? idea : "";
      if (!title.trim()) continue;
      const ref = typeof idea?.id === "string" ? idea.id : String(i);
      rows.push({
        artifactKind: "extracted_idea",
        artifactRef: ref,
        preview: title,
        charCount: title.length,
        hash: sha256(normalizeForHash(title)),
      });
    }
  }

  if (agentNumber === 4) {
    // Agent 4b's selected key concepts. Shapes seen in the wild:
    //  - data.selectedKeyConcepts: string[] | { text }[]
    //  - data.keyConcepts: same
    const concepts: any[] =
      Array.isArray(data.selectedKeyConcepts) ? data.selectedKeyConcepts :
      Array.isArray(data.keyConcepts) ? data.keyConcepts : [];
    for (let i = 0; i < concepts.length; i++) {
      const c = concepts[i];
      const text: string =
        typeof c === "string" ? c :
        typeof c?.text === "string" ? c.text :
        typeof c?.concept === "string" ? c.concept : "";
      if (!text.trim()) continue;
      const ref = typeof c?.id === "string" ? c.id : String(i);
      rows.push({
        artifactKind: "key_concept",
        artifactRef: ref,
        preview: text,
        charCount: text.length,
        hash: sha256(normalizeForHash(text)),
      });
    }
  }

  return rows;
}

// Synchronous core. Re-builds the digest rows for one agent (or all agents)
// on one project, then atomically swaps them in. Idempotent.
async function refreshFamilyArtifacts(
  projectId: string,
  scope: "all" | 1 | 2 | 4,
): Promise<void> {
  const [project] = await db
    .select({ id: projects.id, familyId: projects.familyId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) return;

  const agentNumbers: number[] = scope === "all" ? [1, 2, 4] : [scope];

  // Load only the agent rows we need.
  const agentRows = await db
    .select()
    .from(agentData)
    .where(
      and(
        eq(agentData.projectId, projectId),
        inArray(agentData.agentNumber, agentNumbers),
      ),
    );

  // Build new digest rows for each agent we touched.
  const newRowsByAgent: Map<number, DigestRow[]> = new Map();
  for (const n of agentNumbers) newRowsByAgent.set(n, []);
  for (const row of agentRows) {
    const digests = extractDigests(row.agentNumber, row.data);
    newRowsByAgent.set(row.agentNumber, digests);
  }

  // Map agentNumber → artifact_kind(s) we manage so we can delete-by-kind
  // before re-inserting. Keeps the table tidy when an artifact is removed
  // (e.g. inventor deselects a key concept).
  const kindsByAgent: Record<number, string[]> = {
    1: ["idea_summary"],
    2: ["extracted_idea"],
    4: ["key_concept"],
  };

  // Batch-embed every new artifact's full text in a single API call before
  // the transaction. Best-effort: a null embedding still produces a valid
  // row (the row is just invisible to semantic retrieval until next refresh).
  const allNewRows: DigestRow[] = [];
  for (const n of agentNumbers) allNewRows.push(...(newRowsByAgent.get(n) ?? []));
  const embeddings = allNewRows.length
    ? await embedBatch(allNewRows.map((r) => r.preview))
    : [];
  const embedByIndex = new Map<DigestRow, number[] | null>();
  for (let i = 0; i < allNewRows.length; i++) embedByIndex.set(allNewRows[i], embeddings[i]);

  await db.transaction(async (tx) => {
    for (const n of agentNumbers) {
      const kinds = kindsByAgent[n] ?? [];
      if (kinds.length) {
        await tx
          .delete(projectFamilyArtifacts)
          .where(
            and(
              eq(projectFamilyArtifacts.projectId, projectId),
              inArray(projectFamilyArtifacts.artifactKind, kinds),
            ),
          );
      }
      const rows = newRowsByAgent.get(n) ?? [];
      if (rows.length === 0) continue;
      await tx.insert(projectFamilyArtifacts).values(
        rows.map((r) => ({
          projectId,
          familyId: project.familyId ?? null,
          artifactKind: r.artifactKind,
          artifactRef: r.artifactRef,
          preview: r.preview,
          charCount: r.charCount,
          hash: r.hash,
          embedding: embedByIndex.get(r) ?? null,
        })),
      );
    }
  });
}

// Fire-and-forget. Mirrors `recordEventBackground` so the existing save
// paths are not blocked. Errors are logged but never propagate.
export function refreshFamilyArtifactsBackground(
  projectId: string,
  scope: "all" | 1 | 2 | 4,
): void {
  refreshFamilyArtifacts(projectId, scope).catch((err) => {
    console.error("[families] refresh failed", { projectId, scope, error: err?.message ?? err });
  });
}

// One-shot pass that re-builds the artifact cache for every Project that
// currently belongs to a family. Safe to run any number of times — the
// underlying refresh is idempotent. Used at startup to migrate cached rows
// whose previews were written with an older cap.
export async function backfillAllFamilyProjects(): Promise<{ refreshed: number; failed: number }> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(isNull(projects.deletedAt), sql`${projects.familyId} IS NOT NULL`));
  let refreshed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await refreshFamilyArtifacts(row.id, "all");
      refreshed++;
    } catch (err) {
      failed++;
      console.error("[families] backfill failed for project", row.id, err);
    }
  }
  return { refreshed, failed };
}

// -----------------------------------------------------------------------------
// Read paths — siblings reference + overlap check.
// -----------------------------------------------------------------------------

export interface SiblingReference {
  id: string;
  title: string;
  currentStage: number;
  completed: number;
  updatedAt: string | null;
  artifacts: {
    ideaSummary: { preview: string; charCount: number; hash: string } | null;
    extractedIdeas: Array<{ title: string; hash: string }>;
    keyConcepts: Array<{ preview: string; hash: string }>;
  };
}

// Returns compact digests for every OTHER project in the same family. Skips
// soft-deleted projects. Empty array if the source project has no family.
export async function getSiblingsReference(
  sourceProjectId: string,
): Promise<SiblingReference[]> {
  const [source] = await db
    .select({ id: projects.id, familyId: projects.familyId })
    .from(projects)
    .where(eq(projects.id, sourceProjectId))
    .limit(1);
  if (!source?.familyId) return [];

  const siblings = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.familyId, source.familyId),
        ne(projects.id, sourceProjectId),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(desc(projects.updatedAt));
  if (siblings.length === 0) return [];

  const ids = siblings.map((s) => s.id);
  const digests = await db
    .select()
    .from(projectFamilyArtifacts)
    .where(inArray(projectFamilyArtifacts.projectId, ids));

  const byProject = new Map<string, ProjectFamilyArtifact[]>();
  for (const d of digests) {
    const list = byProject.get(d.projectId) ?? [];
    list.push(d);
    byProject.set(d.projectId, list);
  }

  return siblings.map((s) => {
    const list = byProject.get(s.id) ?? [];
    const ideaSummary = list.find((d) => d.artifactKind === "idea_summary");
    const extractedIdeas = list.filter((d) => d.artifactKind === "extracted_idea");
    const keyConcepts = list.filter((d) => d.artifactKind === "key_concept");
    return {
      id: s.id,
      title: s.title,
      currentStage: s.currentStage,
      completed: s.completed,
      updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
      artifacts: {
        ideaSummary: ideaSummary
          ? { preview: ideaSummary.preview, charCount: ideaSummary.charCount, hash: ideaSummary.hash }
          : null,
        extractedIdeas: extractedIdeas.map((d) => ({ title: d.preview, hash: d.hash })),
        keyConcepts: keyConcepts.map((d) => ({ preview: d.preview, hash: d.hash })),
      },
    };
  });
}

export interface OverlapHit {
  siblingProjectId: string;
  siblingTitle: string;
  artifactKind: "idea_summary" | "extracted_idea" | "key_concept";
  preview: string;
}

// Pure hash lookup against the family's cache. <50ms typical, no AI calls.
// `candidates` is the inventor's current draft pieces, normalised the same
// way as the writer does (lower / collapse-whitespace / trim).
export async function findOverlapsInFamily(
  sourceProjectId: string,
  candidates: Array<{ kind: "key_concept" | "extracted_idea" | "idea_summary"; text: string }>,
): Promise<OverlapHit[]> {
  if (candidates.length === 0) return [];
  const [source] = await db
    .select({ familyId: projects.familyId })
    .from(projects)
    .where(eq(projects.id, sourceProjectId))
    .limit(1);
  if (!source?.familyId) return [];

  const hashes = candidates.map((c) => sha256(normalizeForHash(c.text)));
  const rows = await db
    .select({
      siblingProjectId: projectFamilyArtifacts.projectId,
      artifactKind: projectFamilyArtifacts.artifactKind,
      preview: projectFamilyArtifacts.preview,
      hash: projectFamilyArtifacts.hash,
      siblingTitle: projects.title,
    })
    .from(projectFamilyArtifacts)
    .innerJoin(projects, eq(projects.id, projectFamilyArtifacts.projectId))
    .where(
      and(
        eq(projectFamilyArtifacts.familyId, source.familyId),
        ne(projectFamilyArtifacts.projectId, sourceProjectId),
        inArray(projectFamilyArtifacts.hash, hashes),
        isNull(projects.deletedAt),
      ),
    );

  return rows.map((r) => ({
    siblingProjectId: r.siblingProjectId,
    siblingTitle: r.siblingTitle,
    artifactKind: r.artifactKind as OverlapHit["artifactKind"],
    preview: r.preview,
  }));
}

// Exposed so callers (e.g. the coach) can hash a candidate string with the
// exact same normalisation the writer uses.
export function digestHashFor(text: string): string {
  return sha256(normalizeForHash(text));
}

// -----------------------------------------------------------------------------
// Semantic retrieval — pgvector cosine-similarity over the family's cached
// artifacts. Used by the QA assistant on edit-text stages to surface the
// most relevant content across the entire family, not just the most recent
// N siblings.
// -----------------------------------------------------------------------------

export interface RetrievedArtifact {
  siblingId: string;
  siblingTitle: string;
  siblingStage: number;
  siblingCompleted: number;
  artifactKind: "idea_summary" | "extracted_idea" | "key_concept";
  artifactRef: string;
  text: string; // full artifact text (the preview column now holds it whole)
  similarity: number; // cosine similarity, 0..1 (1 = identical direction)
}

// Find the top-K family artifacts most semantically similar to `query`.
// Excludes the source Project's own artifacts (we want sibling content).
// Returns empty array if the Project has no family, no siblings, the query
// embeds fails, or no rows have embeddings yet.
export async function getRelevantFamilyArtifacts(
  sourceProjectId: string,
  query: string,
  topK: number = 15,
): Promise<RetrievedArtifact[]> {
  if (!query || !query.trim()) return [];
  const [source] = await db
    .select({ familyId: projects.familyId })
    .from(projects)
    .where(eq(projects.id, sourceProjectId))
    .limit(1);
  if (!source?.familyId) return [];

  const qvec = await embedOne(query);
  if (!qvec) return [];
  const qLiteral = `[${qvec.join(",")}]`;

  // Raw SQL: pgvector's `<=>` is cosine *distance* (0 = identical, 2 = opposite).
  // similarity = 1 - distance, then clamped at the application layer for safety.
  // We filter to the family, exclude the source project, exclude soft-deleted
  // siblings, and require an embedding to be present.
  const rows = await db.execute(sql`
    SELECT
      a.project_id      AS sibling_id,
      p.title           AS sibling_title,
      p.current_stage   AS sibling_stage,
      p.completed       AS sibling_completed,
      a.artifact_kind   AS artifact_kind,
      a.artifact_ref    AS artifact_ref,
      a.preview         AS text,
      1 - (a.embedding <=> ${qLiteral}::vector) AS similarity
    FROM inventor_geyser.project_family_artifacts a
    INNER JOIN inventor_geyser.projects p ON p.id = a.project_id
    WHERE a.family_id = ${source.familyId}
      AND a.project_id <> ${sourceProjectId}
      AND a.embedding IS NOT NULL
      AND p.deleted_at IS NULL
    ORDER BY a.embedding <=> ${qLiteral}::vector ASC
    LIMIT ${topK}
  `);

  const out: RetrievedArtifact[] = [];
  for (const r of (rows as any).rows ?? []) {
    out.push({
      siblingId: r.sibling_id,
      siblingTitle: r.sibling_title,
      siblingStage: Number(r.sibling_stage),
      siblingCompleted: Number(r.sibling_completed),
      artifactKind: r.artifact_kind,
      artifactRef: r.artifact_ref,
      text: r.text,
      similarity: Math.max(0, Math.min(1, Number(r.similarity))),
    });
  }
  return out;
}

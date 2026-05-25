// Human-input ledger storage layer. All reads/writes against the
// `inventor_geyser.human_inputs` table funnel through here so the writer
// sites in each module stay tiny.
//
// Key invariant: a row is identified by (projectId, source, sourceRefId).
// Upsert semantics: writing again with the same triple replaces the prior
// row's answerText / tags / promptText / conceptId. This matches how the
// UI behaves — when a user edits a field and re-saves, we keep the latest
// verbatim words, not a history. (Other surfaces like ideaSnapshots already
// cover history-of-snapshots if we need it later.)

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { humanInputs, type HumanInput } from "@shared/schema";
import { recordEventBackground } from "../../lib/provenance/hash-chain";

export interface RecordHumanInputArgs {
  projectId: string;
  source: string;
  sourceRefId?: string | null;
  promptText?: string | null;
  answerText: string;
  tags?: string[];
  conceptId?: string | null;
}

export async function recordHumanInput(args: RecordHumanInputArgs): Promise<HumanInput> {
  const answerText = (args.answerText ?? "").trim();
  if (!answerText) {
    throw new Error("recordHumanInput: answerText is empty");
  }
  const tags = Array.isArray(args.tags) ? Array.from(new Set(args.tags)) : [];
  const charCount = answerText.length;

  // Try to find an existing row for the same (projectId, source, sourceRefId).
  // sourceRefId being null is treated as a distinct key from any non-null value.
  const refIdMatch =
    args.sourceRefId === undefined || args.sourceRefId === null
      ? isNull(humanInputs.sourceRefId)
      : eq(humanInputs.sourceRefId, args.sourceRefId);

  const existing = await db
    .select()
    .from(humanInputs)
    .where(
      and(
        eq(humanInputs.projectId, args.projectId),
        eq(humanInputs.source, args.source),
        refIdMatch,
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(humanInputs)
      .set({
        promptText: args.promptText ?? null,
        answerText,
        tags: tags as any,
        conceptId: args.conceptId ?? null,
        charCount,
        updatedAt: new Date(),
      })
      .where(eq(humanInputs.id, existing[0].id))
      .returning();
    recordEventBackground({
      projectId: args.projectId,
      eventType: "human_input_saved",
      refTable: "human_inputs",
      refId: updated.id,
      payload: {
        source: args.source,
        sourceRefId: args.sourceRefId ?? null,
        answerText,
        tags,
        conceptId: args.conceptId ?? null,
      },
      metadata: { action: "update", charCount },
    });
    return updated;
  }

  const [inserted] = await db
    .insert(humanInputs)
    .values({
      projectId: args.projectId,
      source: args.source,
      sourceRefId: args.sourceRefId ?? null,
      promptText: args.promptText ?? null,
      answerText,
      tags: tags as any,
      conceptId: args.conceptId ?? null,
      charCount,
    })
    .returning();
  recordEventBackground({
    projectId: args.projectId,
    eventType: "human_input_saved",
    refTable: "human_inputs",
    refId: inserted.id,
    payload: {
      source: args.source,
      sourceRefId: args.sourceRefId ?? null,
      answerText,
      tags,
      conceptId: args.conceptId ?? null,
    },
    metadata: { action: "insert", charCount },
  });
  return inserted;
}

// Delete a ledger row (used when the user clears the underlying field).
// Idempotent: missing rows are not an error.
export async function deleteHumanInput(args: {
  projectId: string;
  source: string;
  sourceRefId?: string | null;
}): Promise<void> {
  const refIdMatch =
    args.sourceRefId === undefined || args.sourceRefId === null
      ? isNull(humanInputs.sourceRefId)
      : eq(humanInputs.sourceRefId, args.sourceRefId);

  await db
    .delete(humanInputs)
    .where(
      and(
        eq(humanInputs.projectId, args.projectId),
        eq(humanInputs.source, args.source),
        refIdMatch,
      ),
    );
}

// Pull every ledger row for a project, optionally scoped to a concept.
// Concept-scoped reads include both concept-tagged rows and project-wide rows
// (conceptId IS NULL), since project-wide statements still apply per-concept.
export async function listHumanInputs(args: {
  projectId: string;
  conceptId?: string | null;
}): Promise<HumanInput[]> {
  const conceptFilter =
    args.conceptId === undefined || args.conceptId === null
      ? undefined
      : or(eq(humanInputs.conceptId, args.conceptId), isNull(humanInputs.conceptId));

  const where = conceptFilter
    ? and(eq(humanInputs.projectId, args.projectId), conceptFilter)
    : eq(humanInputs.projectId, args.projectId);

  return await db
    .select()
    .from(humanInputs)
    .where(where)
    .orderBy(desc(humanInputs.updatedAt));
}

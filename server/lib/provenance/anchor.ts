// Daily Merkle anchor. Once per day, fold every provenance_event for every
// project that received events that day into per-project Merkle trees, then
// submit each project's root to the OpenTimestamps Bitcoin calendars. The
// resulting .ots proof is stored in provenance_anchors.
//
// Why per-project: anchors are stored project-scoped (FK to projects), and
// the proof package for an event must show inclusion in a tree the verifier
// can recompute. Computing a per-project tree from "all events for project
// P with created_at on date D, ordered by created_at, then id" is fully
// deterministic and reproducible offline by a third party.

import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "../../db";
import { provenanceEvents, provenanceAnchors } from "@shared/schema";
import { buildMerkleTree } from "./merkle";
import { submitDigestToAllCalendars, type OtsAnchorResult } from "./ots";

export interface AnchorRunResult {
  date: string;
  perProject: Array<{
    projectId: string;
    eventCount: number;
    merkleRoot: string | null;
    anchorId: string | null;
    calendarSuccesses: number;
    calendarFailures: number;
    skippedReason?: string;
  }>;
}

// Walk all events created on the given UTC date (YYYY-MM-DD), grouped by
// project. For each project: build the Merkle root, submit to OTS, store
// one provenance_anchors row. Idempotent — the (project_id, anchor_date)
// unique index ensures a re-run skips projects already anchored.
export async function runDailyAnchor(targetDate: Date): Promise<AnchorRunResult> {
  const startUtc = new Date(Date.UTC(
    targetDate.getUTCFullYear(),
    targetDate.getUTCMonth(),
    targetDate.getUTCDate(),
    0, 0, 0, 0,
  ));
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  const dateStr = startUtc.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: provenanceEvents.id,
      projectId: provenanceEvents.projectId,
      eventHash: provenanceEvents.eventHash,
      createdAt: provenanceEvents.createdAt,
    })
    .from(provenanceEvents)
    .where(and(
      gte(provenanceEvents.createdAt, startUtc),
      lt(provenanceEvents.createdAt, endUtc),
    ));

  // Deterministic order: created_at ASC, id ASC as tiebreaker. The same
  // order MUST be used at verify time, which is why we don't rely on DB
  // row order.
  rows.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  const byProject = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byProject.get(r.projectId) ?? [];
    arr.push(r);
    byProject.set(r.projectId, arr);
  }

  const perProject: AnchorRunResult["perProject"] = [];

  for (const [projectId, events] of byProject.entries()) {
    // Skip projects already anchored for this date (idempotency).
    const existing = await db
      .select({ id: provenanceAnchors.id })
      .from(provenanceAnchors)
      .where(and(
        eq(provenanceAnchors.projectId, projectId),
        eq(provenanceAnchors.anchorDate, dateStr),
      ))
      .limit(1);
    if (existing.length > 0) {
      perProject.push({
        projectId,
        eventCount: events.length,
        merkleRoot: null,
        anchorId: existing[0].id,
        calendarSuccesses: 0,
        calendarFailures: 0,
        skippedReason: "already_anchored",
      });
      continue;
    }

    const tree = buildMerkleTree(events.map((e) => e.eventHash));
    const rootBytes = Buffer.from(tree.rootHex, "hex");

    let result: OtsAnchorResult;
    try {
      result = await submitDigestToAllCalendars(rootBytes);
    } catch (err: any) {
      console.warn(`[anchor] OTS submit threw for project ${projectId}:`, err?.message || err);
      result = { successes: [], failures: [] };
    }

    if (result.successes.length === 0) {
      console.warn(`[anchor] project ${projectId} root ${tree.rootHex} got zero calendar attestations — skipping insert; will retry next run`);
      perProject.push({
        projectId,
        eventCount: events.length,
        merkleRoot: tree.rootHex,
        anchorId: null,
        calendarSuccesses: 0,
        calendarFailures: result.failures.length,
        skippedReason: "no_calendar_attestations",
      });
      continue;
    }

    // Store every successful calendar response so the proof package is
    // robust to any single calendar disappearing. The schema column is
    // TEXT, so we serialize the multi-calendar payload as JSON.
    const payload = {
      digestHex: tree.rootHex,
      calendars: result.successes.map((s) => ({
        label: s.label,
        url: s.url,
        proofB64: Buffer.from(s.proof).toString("base64"),
      })),
      failures: result.failures,
      submittedAt: new Date().toISOString(),
    };

    const [row] = await db
      .insert(provenanceAnchors)
      .values({
        projectId,
        anchorDate: dateStr,
        eventCount: events.length,
        merkleRoot: tree.rootHex,
        otsProof: JSON.stringify(payload),
      })
      .returning({ id: provenanceAnchors.id });

    perProject.push({
      projectId,
      eventCount: events.length,
      merkleRoot: tree.rootHex,
      anchorId: row.id,
      calendarSuccesses: result.successes.length,
      calendarFailures: result.failures.length,
    });

    console.log(
      `[anchor] project ${projectId} ${dateStr}: ${events.length} events, root ${tree.rootHex.slice(0, 16)}…, ` +
      `${result.successes.length} calendar(s) ok, ${result.failures.length} failed`,
    );
  }

  return { date: dateStr, perProject };
}

// Append-only hash-chained provenance log. One row per meaningful write.
//
// Invariants per project:
//   - Rows are ordered by created_at.
//   - prev_hash of row N equals event_hash of row N-1 (null for the first).
//   - event_hash = sha256(prev_hash || payload_hash || event_type || created_at_iso).
//
// Any later mutation of a historic payload breaks the chain at that row and
// every row after it. The /provenance/verify route walks the chain and
// reports the first break.
//
// All call sites use fire-and-forget so a transient DB issue in the chain
// can never block the user's primary save.

import { createHash } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { provenanceEvents } from "@shared/schema";
import { canonicalize } from "./canonical";

export type ProvenanceEventType =
  | "human_input_saved"
  | "pohc_record_saved"
  | "agent_data_saved"
  | "snapshot_created"
  | "finalize_brainstorm"
  | "finalize_provisional"
  | "finalize_gs"
  | "generate_first_draft"
  | "update_spec_section"
  | "generate_diagrams"
  | "apply_gs_to_draft"
  | "export_pohc"
  | "export_provisional"
  | "export_full_docx"
  | "export_proof_package";

export interface RecordEventArgs {
  projectId: string;
  userId?: string | null;
  eventType: ProvenanceEventType;
  refTable: string;
  refId?: string | null;
  payload: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface ProvenanceEventRow {
  id: string;
  projectId: string;
  userId: string | null;
  eventType: string;
  refTable: string;
  refId: string | null;
  payloadHash: string;
  payloadCanonical: string | null;
  prevHash: string | null;
  eventHash: string;
  metadata: any;
  createdAt: Date | null;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
}

// Synchronous-style insert that returns the new row. Wrapped at call sites
// with `void recordEvent(...)` so failures log but don't propagate.
export async function recordEvent(args: RecordEventArgs): Promise<ProvenanceEventRow> {
  const payloadCanonical: string = canonicalize(args.payload ?? null);
  const payloadHash = sha256Hex(payloadCanonical);

  const prev = await db
    .select({ eventHash: provenanceEvents.eventHash })
    .from(provenanceEvents)
    .where(eq(provenanceEvents.projectId, args.projectId))
    .orderBy(desc(provenanceEvents.createdAt))
    .limit(1);
  const prevHash = prev.length > 0 ? prev[0].eventHash : null;

  const createdAt = new Date();
  const createdAtIso = createdAt.toISOString();
  const eventHash = sha256Hex(prevHash ?? "", payloadHash, args.eventType, createdAtIso);

  const [row] = await db
    .insert(provenanceEvents)
    .values({
      projectId: args.projectId,
      userId: args.userId ?? null,
      eventType: args.eventType,
      refTable: args.refTable,
      refId: args.refId ?? null,
      payloadHash,
      payloadCanonical,
      prevHash,
      eventHash,
      metadata: (args.metadata ?? null) as any,
      createdAt,
    })
    .returning();

  return row as unknown as ProvenanceEventRow;
}

// Fire-and-forget helper used by writers that must not block on chain insert.
export function recordEventBackground(args: RecordEventArgs): void {
  void recordEvent(args).catch((err) => {
    console.warn("[provenance] recordEvent failed:", err?.message || err);
  });
}

// Walks the chain for a project and returns the verification result.
// Used by /provenance/verify. Recomputes each event_hash from the stored
// prev_hash / payload_hash / event_type / created_at — if any row was
// mutated in-place, its recomputed hash will differ and the chain breaks
// at that row.
export interface ChainVerificationResult {
  chainValid: boolean;
  totalEvents: number;
  breakAt: string | null;        // event id where the chain first fails
  breakReason: string | null;
  headEventId: string | null;
  headHash: string | null;
}

export async function verifyChain(projectId: string): Promise<ChainVerificationResult> {
  const rows = await db
    .select()
    .from(provenanceEvents)
    .where(eq(provenanceEvents.projectId, projectId))
    .orderBy(provenanceEvents.createdAt);

  if (rows.length === 0) {
    return {
      chainValid: true,
      totalEvents: 0,
      breakAt: null,
      breakReason: null,
      headEventId: null,
      headHash: null,
    };
  }

  let expectedPrev: string | null = null;
  for (const r of rows) {
    const createdAtIso = r.createdAt ? new Date(r.createdAt).toISOString() : "";
    const recomputed = sha256Hex(expectedPrev ?? "", r.payloadHash, r.eventType, createdAtIso);
    if (r.prevHash !== expectedPrev) {
      return {
        chainValid: false,
        totalEvents: rows.length,
        breakAt: r.id,
        breakReason: `prev_hash mismatch: stored=${r.prevHash ?? "null"} expected=${expectedPrev ?? "null"}`,
        headEventId: rows[rows.length - 1].id,
        headHash: rows[rows.length - 1].eventHash,
      };
    }
    if (r.eventHash !== recomputed) {
      return {
        chainValid: false,
        totalEvents: rows.length,
        breakAt: r.id,
        breakReason: `event_hash mismatch: stored=${r.eventHash} recomputed=${recomputed}`,
        headEventId: rows[rows.length - 1].id,
        headHash: rows[rows.length - 1].eventHash,
      };
    }
    expectedPrev = r.eventHash;
  }

  const head = rows[rows.length - 1];
  return {
    chainValid: true,
    totalEvents: rows.length,
    breakAt: null,
    breakReason: null,
    headEventId: head.id,
    headHash: head.eventHash,
  };
}

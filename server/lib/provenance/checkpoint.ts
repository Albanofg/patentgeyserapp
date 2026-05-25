// Checkpoint stamping. Wraps recordEvent + parallel TSA stamps + DB inserts.
//
// Called at every finalize / export endpoint after the underlying business
// write succeeds. The flow is:
//   1. Insert the chain event (synchronous — must land before stamps so they
//      can FK to it). recordEvent persists the canonical payload bytes.
//   2. Use event.payloadHash as the imprint sent to every TSA. This is the
//      sha256 of canonicalize(payload), so a third party with the proof
//      package can recompute the same hash from the bundled canonical JSON
//      and verify it against each .tsr's MessageImprint.
//   3. Fan out to every enabled TSA in parallel. Each success → one row in
//      provenance_stamps. Failures are logged but non-fatal.
//
// Minimum proof = chain event + ≥1 stamp. Strong proof = chain + multiple
// stamps from independent TSAs.

import { db } from "../../db";
import { provenanceStamps } from "@shared/schema";
import { recordEvent, type ProvenanceEventType } from "./hash-chain";
import { requestTimestamp } from "./tsq";
import { TSA_PROVIDERS } from "./tsa-providers";

export interface CheckpointArgs {
  projectId: string;
  userId?: string | null;
  eventType: ProvenanceEventType;
  refTable: string;
  refId?: string | null;
  payload: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface StampOutcome {
  tsaLabel: string;
  tsaUrl: string;
  stampId: string | null;
  ok: boolean;
  error: string | null;
}

function bytesToBase64(bytes: Uint8Array | null): string | null {
  if (!bytes) return null;
  return Buffer.from(bytes).toString("base64");
}

export async function createCheckpoint(args: CheckpointArgs): Promise<{
  eventId: string;
  requestHash: string;
  stamps: StampOutcome[];
  stampedCount: number;
}> {
  const event = await recordEvent({
    projectId: args.projectId,
    userId: args.userId,
    eventType: args.eventType,
    refTable: args.refTable,
    refId: args.refId,
    payload: args.payload,
    metadata: args.metadata,
  });

  // The imprint sent to every TSA is the canonical-payload hash that's
  // already stored on the chain row. A verifier with the proof package
  // recomputes sha256(canonicalize(canonical-disclosure.json)) and confirms
  // it equals this value and equals the MessageImprint inside each .tsr.
  const requestHash = event.payloadHash;

  const results = await Promise.allSettled(
    TSA_PROVIDERS.map((p) => requestTimestamp(p, requestHash)),
  );

  const outcomes: StampOutcome[] = [];
  for (let i = 0; i < TSA_PROVIDERS.length; i++) {
    const provider = TSA_PROVIDERS[i];
    const r = results[i];
    if (r.status === "fulfilled") {
      try {
        const [row] = await db
          .insert(provenanceStamps)
          .values({
            projectId: args.projectId,
            eventId: event.id,
            tsaUrl: r.value.tsaUrl,
            requestHash,
            tsaResponse: bytesToBase64(r.value.tsaResponse)!,
            tsaCert: bytesToBase64(r.value.tsaCert),
          })
          .returning();
        outcomes.push({
          tsaLabel: provider.label,
          tsaUrl: provider.url,
          stampId: row.id,
          ok: true,
          error: null,
        });
        console.log(`[provenance] stamped event ${event.id} via ${provider.label} (stamp ${row.id})`);
      } catch (dbErr: any) {
        outcomes.push({
          tsaLabel: provider.label,
          tsaUrl: provider.url,
          stampId: null,
          ok: false,
          error: `db insert failed: ${dbErr?.message || dbErr}`,
        });
        console.warn(`[provenance] ${provider.label} stamp DB insert failed:`, dbErr?.message || dbErr);
      }
    } else {
      const msg = r.reason?.message || String(r.reason);
      outcomes.push({
        tsaLabel: provider.label,
        tsaUrl: provider.url,
        stampId: null,
        ok: false,
        error: msg,
      });
      console.warn(`[provenance] ${provider.label} stamp failed for event ${event.id}: ${msg}`);
    }
  }

  const stampedCount = outcomes.filter((o) => o.ok).length;
  if (stampedCount === 0) {
    console.warn(`[provenance] event ${event.id} has no TSA stamps — chain entry only`);
  }

  return {
    eventId: event.id,
    requestHash,
    stamps: outcomes,
    stampedCount,
  };
}

// Fire-and-forget — used by endpoints that should not wait on TSA roundtrips.
export function createCheckpointBackground(args: CheckpointArgs): void {
  void createCheckpoint(args).catch((err) => {
    console.warn("[provenance] createCheckpoint failed:", err?.message || err);
  });
}

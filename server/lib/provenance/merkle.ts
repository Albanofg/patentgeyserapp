// Binary SHA-256 Merkle tree + inclusion-proof helpers.
//
// Used to fold a day's worth of provenance_event hashes into a single root,
// which then gets submitted to OpenTimestamps Bitcoin calendars. A verifier
// re-derives the root from {leaf, audit path} and confirms it matches the
// root that the OTS calendar(s) timestamped.
//
// Convention: when a level has an odd count we duplicate the last node
// (standard Bitcoin-style Merkle). The same rule must hold at verify time.

import { createHash } from "crypto";

function sha256(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

function hexToBuf(hex: string): Buffer {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`merkle: invalid hex "${hex.slice(0, 16)}…"`);
  }
  return Buffer.from(hex, "hex");
}

export interface MerkleInclusionStep {
  sibling: string;   // hex
  side: "L" | "R";   // sibling is on this side of the current node
}

export interface MerkleTree {
  rootHex: string;
  leafCount: number;
  // Audit path for each input leaf, in the original input order.
  proofs: MerkleInclusionStep[][];
}

// Build a Merkle tree from an ordered list of hex-encoded SHA-256 hashes
// (one per leaf). Returns the root plus an inclusion proof for each leaf.
export function buildMerkleTree(leafHexes: string[]): MerkleTree {
  if (leafHexes.length === 0) throw new Error("merkle: cannot build tree of 0 leaves");

  const leaves = leafHexes.map(hexToBuf);
  if (leaves.some((b) => b.length !== 32)) {
    throw new Error("merkle: every leaf must be a 32-byte sha256");
  }

  // proofs[i] accumulates the audit path for the i-th leaf as we walk up.
  const proofs: MerkleInclusionStep[][] = leaves.map(() => []);
  // indexOf[i] tracks where the i-th original leaf currently sits in the
  // active level (changes as the level shrinks).
  let level = leaves;
  let positions = leaves.map((_, i) => i);

  while (level.length > 1) {
    const next: Buffer[] = [];
    const nextPositions: number[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i]; // duplicate last on odd
      const parent = sha256(Buffer.concat([left, right]));
      next.push(parent);

      // Record audit-path steps for every original leaf that sits at
      // position i or i+1 in the current level.
      for (let k = 0; k < positions.length; k++) {
        if (positions[k] === i) {
          proofs[k].push({ sibling: right.toString("hex"), side: "R" });
        } else if (positions[k] === i + 1) {
          proofs[k].push({ sibling: left.toString("hex"), side: "L" });
        }
      }

      // Both leaves at i and i+1 collapse into the same parent index in
      // the next level.
      for (let k = 0; k < positions.length; k++) {
        if (positions[k] === i || positions[k] === i + 1) {
          nextPositions[k] = next.length - 1;
        }
      }
    }
    level = next;
    positions = nextPositions.map((v, k) => v ?? positions[k]);
  }

  return {
    rootHex: level[0].toString("hex"),
    leafCount: leaves.length,
    proofs,
  };
}

// Pure-function verifier: recompute the root from {leaf, audit path} and
// compare against the claimed root. Used by the verification report and by
// third-party verifiers shipping with the proof package.
export function verifyInclusion(leafHex: string, path: MerkleInclusionStep[], rootHex: string): boolean {
  let acc = hexToBuf(leafHex);
  for (const step of path) {
    const sib = hexToBuf(step.sibling);
    acc = step.side === "L" ? sha256(Buffer.concat([sib, acc])) : sha256(Buffer.concat([acc, sib]));
  }
  return acc.toString("hex") === rootHex.toLowerCase();
}

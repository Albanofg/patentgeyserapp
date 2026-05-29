// Thin wrapper around the existing OpenAI client for text-embedding-3-small.
// Used by:
//   - the family-artifact save-time writer (one embed per saved artifact, ever)
//   - the QA assistant per-turn retrieval (one embed of the inventor's message,
//     only on edit-text stages)
//
// Cost: ~$0.02 per million tokens. A typical artifact (~500 chars / ~125
// tokens) costs ~$0.0000025 to embed. A typical user message likewise. The
// per-turn footprint is invisible in usage logs.
//
// Failures degrade silently — embedding is best-effort. A missing embedding
// simply means the row won't surface via semantic retrieval; exact-match
// hash detection still works.

import OpenAI from "openai";
import { requireEnv } from "./env";

const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

const MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

// Normalise input before embedding: trim, collapse whitespace, drop newlines.
// Same shape regardless of how the inventor formatted the original text.
function normalize(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

// Embed a single string. Returns null on any failure (rate limit, network,
// auth, empty input) so the caller can treat the result as best-effort.
export async function embedOne(text: string): Promise<number[] | null> {
  const t = normalize(text);
  if (!t) return null;
  try {
    const res = await openai.embeddings.create({
      model: MODEL,
      input: t,
    });
    const v = res.data?.[0]?.embedding;
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMS) return null;
    return v;
  } catch (err: any) {
    console.error("[embeddings] embedOne failed", err?.message ?? err);
    return null;
  }
}

// Embed an array of strings in a single API call. Returns an array of the
// same length; failed slots are null. Used by the artifact writer when
// multiple artifacts change in one save (e.g. selectedKeyConcepts swap).
export async function embedBatch(texts: string[]): Promise<Array<number[] | null>> {
  const normalised = texts.map(normalize);
  const indices = normalised
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.length > 0);
  if (indices.length === 0) return texts.map(() => null);
  try {
    const res = await openai.embeddings.create({
      model: MODEL,
      input: indices.map(({ t }) => t),
    });
    const out: Array<number[] | null> = texts.map(() => null);
    for (let i = 0; i < indices.length; i++) {
      const v = res.data?.[i]?.embedding;
      if (Array.isArray(v) && v.length === EMBEDDING_DIMS) {
        out[indices[i].i] = v;
      }
    }
    return out;
  } catch (err: any) {
    console.error("[embeddings] embedBatch failed", err?.message ?? err);
    return texts.map(() => null);
  }
}

// pgvector text literal format: '[1.2,3.4,...]' that the server parses to
// vector. Drizzle's vector column type accepts this string when written via
// raw SQL parameters.
export function toPgVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

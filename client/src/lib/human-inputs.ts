// Client-side helper for the human-input ledger.
//
// Every textarea in the app that asks the user to type something potentially
// useful for Pannu pre-fill should pass its current value through here. The
// hook debounces writes so we don't spam the server on every keystroke, and
// upserts by (source, sourceRefId) so editing the same field replaces the
// prior row instead of appending.
//
// Tags MUST come from the controlled vocabulary. The server rejects unknown
// tags. See server/modules/human-inputs/tags.ts.

import { useEffect, useRef } from "react";

export type HumanInputTag =
  | "conception_timeline"
  | "conception_mechanism"
  | "problem_narrative"
  | "technical_advance"
  | "vs_obvious_combo"
  | "implementation_detail"
  | "prior_art_awareness"
  | "differentiation"
  | "whitespace_rationale"
  | "free_text";

export interface RecordHumanInputArgs {
  projectId: string | undefined;
  source: string;
  sourceRefId?: string | null;
  promptText?: string | null;
  answerText: string;
  tags: HumanInputTag[];
  conceptId?: string | null;
}

// One-shot writer. Fire-and-forget; failures are logged but don't surface
// to the user (the underlying field's own save status is the source of truth).
export async function recordHumanInput(args: RecordHumanInputArgs): Promise<void> {
  if (!args.projectId) return;
  // Skip empty answer text — the server rejects empty rows with a 500.
  // Hooks fire on every render including the initial empty state; this guard
  // keeps server logs clean and avoids pointless network calls.
  if (!args.answerText || !args.answerText.trim()) return;
  try {
    await fetch(`/api/projects/${args.projectId}/human-inputs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: args.source,
        sourceRefId: args.sourceRefId ?? null,
        promptText: args.promptText ?? null,
        answerText: args.answerText,
        tags: args.tags,
        conceptId: args.conceptId ?? null,
      }),
    });
  } catch (err) {
    console.warn("[human-inputs] write failed:", err);
  }
}

// Debounced hook. Pass the current value of the field and the metadata
// needed to identify it. Writes ~1.2s after the last keystroke. If the
// value goes empty the server deletes the row.
export function useHumanInputWriter(args: RecordHumanInputArgs, delayMs = 1200): void {
  const lastWrittenRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!args.projectId) return;
    // Skip the very first render if value matches what's already on the
    // server — we don't have that info on the client, so a single write on
    // mount is acceptable. The dedupe below catches subsequent no-ops.
    if (lastWrittenRef.current === args.answerText) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastWrittenRef.current = args.answerText;
      void recordHumanInput(args);
    }, delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // We intentionally depend on the value + the dynamic identifying fields,
    // not the whole args object, so a stable hook call doesn't re-fire on
    // every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.projectId,
    args.source,
    args.sourceRefId,
    args.conceptId,
    args.answerText,
    args.tags.join(","),
    delayMs,
  ]);
}

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Reusable progress indicator for long-running AI calls (15s–120s range).
//
// Why this exists: most agent pages already disable their trigger button via
// `mutation.isPending` and show a generic spinner with text like "Searching…".
// At 30s+ with no other signal, users assume the page is frozen and either
// refresh (losing the in-flight call) or double-submit (now there are two
// running). This component renders the missing context: a live elapsed timer
// proves the page is alive, the duration hint sets expectations, and the
// optional rotating messages give per-stage visibility when the backend
// doesn't stream progress.
//
// Drop in next to (or instead of) an existing spinner block. Mounts when the
// caller is in its pending state, unmounts when the call resolves — the
// internal timer is bound to the mount lifecycle, so callers don't need to
// reset anything.
//
// The visual style intentionally matches agent5's full-page expansion
// takeover (rotating messages every 4s, mm:ss elapsed counter) so users get
// a consistent "the app is working on it" experience across modules.

export interface LongCallProgressProps {
  /** Top-line description, e.g. "Searching prior art databases…" */
  title: string;
  /** Duration expectation copy. e.g. "This usually takes 30–60 seconds." */
  expectedDuration: string;
  /**
   * Optional rotating sub-messages. If provided, one is shown at a time and
   * rotates every 4s. Useful when the backend can't stream progress but the
   * call goes through known phases.
   */
  messages?: string[];
  /**
   * Optional reassurance line shown beneath the timer. Defaults to a
   * "keep this tab open" message — explicit because users frequently switch
   * tabs / refresh during long calls.
   */
  reassurance?: string;
}

const DEFAULT_REASSURANCE =
  "Keep this tab open — you can leave it in the background while we work.";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  // mm:ss with zero padding on seconds. Two-digit seconds avoid the visual
  // "jump" between "0:9" and "0:10" that one-digit formatting causes.
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function LongCallProgress({
  title,
  expectedDuration,
  messages,
  reassurance,
}: LongCallProgressProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!messages || messages.length === 0) return;
    const rotate = setInterval(() => {
      setMessageIndex((i) => (i + 1) % messages.length);
    }, 4000);
    return () => clearInterval(rotate);
  }, [messages]);

  const currentMessage = messages && messages.length > 0 ? messages[messageIndex] : null;

  return (
    <div
      className="rounded-lg border bg-card/50 p-4 space-y-3"
      data-testid="long-call-progress"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <Loader2 className="h-5 w-5 text-primary animate-spin mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium leading-tight">{title}</h3>
            <span
              className="text-xs font-mono text-muted-foreground tabular-nums shrink-0"
              data-testid="long-call-progress-elapsed"
            >
              {formatElapsed(elapsedSec)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{expectedDuration}</p>
        </div>
      </div>

      {currentMessage && (
        <div
          className="text-xs text-muted-foreground pl-8 transition-opacity duration-300"
          data-testid="long-call-progress-message"
        >
          {currentMessage}
        </div>
      )}

      <div className="text-xs text-muted-foreground/80 pl-8">
        {reassurance ?? DEFAULT_REASSURANCE}
      </div>
    </div>
  );
}

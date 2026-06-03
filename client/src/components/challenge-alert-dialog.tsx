import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Marketing nudge shown to authenticated users on a time-based cadence rather
// than only at login — once-per-login left users who keep a tab open for days
// never seeing it. The component stamps the localStorage timestamp whenever
// it opens the dialog, then short-circuits subsequent checks within the
// SHOW_INTERVAL_MS window. The check runs on first mount AND every time the
// tab regains focus (visibilitychange), so a user who comes back from lunch
// gets a fresh nudge if 12 hours have passed since the last one.
const STORAGE_KEY = "challenge-alert-last-shown";
const SHOW_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours — aggressive nudge while the challenge week is live; widen back to 12h after

const CHALLENGE_TITLE = "🔔 Join us for the Patent Geyser Challenge";
const CHALLENGE_DESCRIPTION =
  "Day 4 starts Thu June 4 at noon PDT. Use the Challenge meeting link in the sidebar to join.";

export function ChallengeAlertDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkAndMaybeShow = () => {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const lastShown = raw ? Number(raw) : 0;
      const now = Date.now();
      // Guard against future-dated timestamps (clock skew / manual edits) by
      // treating any NaN-or-future value as "never shown" so the user still
      // sees the alert instead of being permanently silenced.
      const validLast = Number.isFinite(lastShown) && lastShown <= now ? lastShown : 0;
      if (now - validLast >= SHOW_INTERVAL_MS) {
        window.localStorage.setItem(STORAGE_KEY, String(now));
        setOpen(true);
      }
    };

    checkAndMaybeShow();

    // Re-check when the tab regains focus — handles the "left the tab open
    // for hours" case so the user gets re-nudged after a long idle.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkAndMaybeShow();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{CHALLENGE_TITLE}</AlertDialogTitle>
          <AlertDialogDescription>{CHALLENGE_DESCRIPTION}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setOpen(false)}>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

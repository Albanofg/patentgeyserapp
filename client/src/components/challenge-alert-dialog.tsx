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

// Marketing nudge shown once per login session. The flag is written to
// sessionStorage by every "login-just-completed" code path (login.tsx onSuccess
// when no 2FA is required, plus authenticated-shell's 2FA onSuccess for users
// with 2FA enabled). We read+clear it on mount here, so the dialog never
// re-shows on a page refresh and naturally pops up again on the next login.
const SHOW_FLAG_KEY = "show-challenge-alert";

const CHALLENGE_TITLE = "🔔 5-Day Filing Challenge";
const CHALLENGE_DESCRIPTION =
  "Starts Monday at noon PT! Bring an idea, file by Friday. Your join link is on your dashboard.";

export function ChallengeAlertDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SHOW_FLAG_KEY) === "1") {
      window.sessionStorage.removeItem(SHOW_FLAG_KEY);
      setOpen(true);
    }
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

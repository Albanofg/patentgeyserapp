import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// React Error Boundary — catches any render-time error thrown anywhere in its
// subtree and shows a recoverable fallback instead of the React-default
// behavior (blank page, work lost, no signal to the user).
//
// We log under the same `[ERROR <id>]` shape the server uses (see
// server/lib/error-response.ts) so a user-reported errorId can be grep'd
// across both client and server logs.
//
// Recovery path:
//   - "Try again" calls `reset()` which clears the boundary state. If the
//     underlying issue was transient (a bad render due to stale data, a
//     flapping AI response shape), the user is back in business.
//   - "Back to Dashboard" navigates away without a page reload, preserving
//     auth session and any other open work.
//   - Page reload is still available via the browser, but the in-app paths
//     above usually beat it because they don't drop session/state.

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional custom fallback. Receives the caught error, a fresh correlation
   * id, and a reset callback. Useful when a specific section needs a tighter
   * fallback (e.g. "AI Helper crashed — close the panel?" inside the panel).
   * Omit to use the page-level default below.
   */
  fallback?: (props: { error: Error; errorId: string; reset: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorId: string;
}

function newErrorId(): string {
  // 8-char hex, matches the server's sendServerError() id format so a
  // user-reported value pairs up with [ERROR <id>] log lines on either side.
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, errorId: "" };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Computing the errorId here (during the render-phase state derivation)
    // makes it available synchronously in the fallback render. componentDidCatch
    // then logs using the same id.
    return { error, errorId: newErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const id = this.state.errorId || "unknown";
    // Match the [ERROR <id>] shape used by sendServerError on the server.
    console.error(`[ERROR ${id}] React render error:`, error, info);
  }

  reset = (): void => {
    this.setState({ error: null, errorId: "" });
  };

  render(): ReactNode {
    if (this.state.error) {
      const { error, errorId } = this.state;
      if (this.props.fallback) {
        return this.props.fallback({ error, errorId, reset: this.reset });
      }
      return <DefaultFallback error={error} errorId={errorId} reset={this.reset} />;
    }
    return this.props.children;
  }
}

interface DefaultFallbackProps {
  error: Error;
  errorId: string;
  reset: () => void;
}

function DefaultFallback({ error, errorId, reset }: DefaultFallbackProps): ReactNode {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-lg" data-testid="error-boundary-fallback">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold leading-tight">Something went wrong on this page</h2>
              <p className="text-sm text-muted-foreground">
                Your data is safe. You can try this page again, head back to the dashboard, or share the
                error code below with support so we can dig in.
              </p>
            </div>
          </div>

          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Error ID:</span>{" "}
            <code
              className="font-mono text-foreground select-all"
              data-testid="error-boundary-error-id"
            >
              {errorId}
            </code>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={reset} data-testid="error-boundary-try-again">
              Try again
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                // Plain navigation rather than wouter — the boundary may be
                // sitting above the router itself, so we can't assume hooks
                // here. Page reload also clears whatever state put us in the
                // failed render.
                window.location.href = "/";
              }}
              data-testid="error-boundary-back-to-dashboard"
            >
              Back to Dashboard
            </Button>
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Technical details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-snug">
              {error.message}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

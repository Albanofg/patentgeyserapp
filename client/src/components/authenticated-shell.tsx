import { useEffect, useState, useRef, lazy, Suspense } from "react";
import { useLocation, useRoute, Switch, Route } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { QAAssistantPanel } from "@/components/qa-assistant-modal";
import { Loader2, Menu, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import geyserLogo from "@/assets/geyser-logo.png";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Agent1 = lazy(() => import("@/pages/agent1"));
const Agent1a = lazy(() => import("@/pages/agent1a"));
const Agent1aAudit = lazy(() => import("@/pages/agent1a-audit"));
const Agent1Inspect = lazy(() => import("@/pages/agent1-inspect"));
const Agent2 = lazy(() => import("@/pages/agent2"));
const Agent2a = lazy(() => import("@/pages/agent2a"));
const Agent2b = lazy(() => import("@/pages/agent2b"));
const Agent3 = lazy(() => import("@/pages/agent3"));
const Agent4 = lazy(() => import("@/pages/agent4"));
const Agent4b = lazy(() => import("@/pages/agent4b"));
const Agent4PannuIntro = lazy(() => import("@/pages/agent4-pannu-intro"));
const Agent4Pannu = lazy(() => import("@/pages/agent4-pannu"));
const Agent4c = lazy(() => import("@/pages/agent4c"));
const Agent5 = lazy(() => import("@/pages/agent5"));
const Agent5Practitioner = lazy(() => import("@/pages/agent5-practitioner"));
const PriorArtCheck = lazy(() => import("@/pages/prior-art-check"));
const UserSettings = lazy(() => import("@/pages/user-settings"));
const AdminWhitelist = lazy(() => import("@/pages/admin-whitelist"));
const AdminUsers = lazy(() => import("@/pages/admin-users"));
const AdminCredits = lazy(() => import("@/pages/admin-credits"));
const AdminUsage = lazy(() => import("@/pages/admin-usage"));
const TwoFactorVerify = lazy(() => import("@/pages/two-factor-verify"));
const NotFound = lazy(() => import("@/pages/not-found"));

function RouteLoader() {
  return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

interface AuthenticatedUser {
  id: number;
  email: string;
  twoFactorEnabled: boolean;
  twoFactorMethod: 'email' | 'totp' | null;
  twoFactorVerified: boolean;
  subscriptionStatus: 'active' | 'read_only';
}

// Mobile header component with sidebar trigger
function MobileHeader() {
  const { toggleSidebar, isMobile } = useSidebar();
  
  // Only show on mobile
  if (!isMobile) return null;
  
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between px-4 py-3 border-b bg-background md:hidden">
      <div className="flex items-center gap-2">
        <img src={geyserLogo} alt="Patent Geyser" className="h-6 w-6" />
        <div className="flex flex-col leading-tight">
          <span className="font-semibold text-sm">Patent Geyser</span>
          <span className="text-[9px] text-muted-foreground">Provisional Patent Draft Generator</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          data-testid="button-mobile-menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}

// Redirect component for legacy 2c route
function Agent2cRedirect() {
  const [, params] = useRoute("/project/:id/agent/2c");
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    if (params?.id) {
      setLocation(`/project/${params.id}/agent/2b`);
    }
  }, [params?.id, setLocation]);
  
  return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

// Redirect component for legacy 4 route (redirects to 4a)
function Agent4Redirect() {
  const [, params] = useRoute("/project/:id/agent/4");
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    if (params?.id) {
      setLocation(`/project/${params.id}/agent/4a`);
    }
  }, [params?.id, setLocation]);
  
  return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export function AuthenticatedShell() {
  const [, setLocation] = useLocation();
  const [twoFactorComplete, setTwoFactorComplete] = useState(false);

  // Check authentication
  const { data: user, isLoading, error, refetch } = useQuery<AuthenticatedUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  // Extract project ID from current route for sidebar
  const [, agent1Params] = useRoute("/project/:id/agent/1");
  const [, agent1aParams] = useRoute("/project/:id/agent/1a");
  const [, agent1aAuditParams] = useRoute("/project/:id/agent/1a-audit");
  const [, agent1bParams] = useRoute("/project/:id/agent/1b");
  const [, agent2Params] = useRoute("/project/:id/agent/2");
  const [, agent2aParams] = useRoute("/project/:id/agent/2a");
  const [, agent2bParams] = useRoute("/project/:id/agent/2b");
  const [, agent3Params] = useRoute("/project/:id/agent/3");
  const [, agent4Params] = useRoute("/project/:id/agent/4");
  const [, agent4aParams] = useRoute("/project/:id/agent/4a");
  const [, agent4bParams] = useRoute("/project/:id/agent/4b");
  const [, agent4PannuIntroParams] = useRoute("/project/:id/agent/4-conception-intro");
  const [, agent4PannuParams] = useRoute("/project/:id/agent/4-conception");
  const [, agent4cParams] = useRoute("/project/:id/agent/4c");
  const [, agent5Params] = useRoute("/project/:id/agent/5");
  const [, agent5PractitionerParams] = useRoute("/project/:id/agent/5-practitioner");
  
  const projectId = 
    agent1Params?.id || 
    agent1aParams?.id ||
    agent1aAuditParams?.id ||
    agent1bParams?.id ||
    agent2Params?.id || 
    agent2aParams?.id ||
    agent2bParams?.id ||
    agent3Params?.id || 
    agent4Params?.id ||
    agent4aParams?.id ||
    agent4bParams?.id ||
    agent4PannuIntroParams?.id ||
    agent4PannuParams?.id ||
    agent4cParams?.id ||
    agent5Params?.id ||
    agent5PractitionerParams?.id ||
    undefined;

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && (error || !user)) {
      setLocation("/auth/login");
    }
  }, [isLoading, error, user, setLocation]);

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Don't render protected UI if not authenticated
  if (!user) {
    return null;
  }

  // Check if 2FA verification is required
  const needs2FAVerification = user.twoFactorEnabled && 
    !user.twoFactorVerified && 
    !twoFactorComplete;

  if (needs2FAVerification) {
    return (
      <Suspense fallback={<RouteLoader />}>
        <TwoFactorVerify
          method={user.twoFactorMethod || 'email'}
          userId={user.id}
          email={user.email}
          onSuccess={() => {
            setTwoFactorComplete(true);
            refetch();
          }}
        />
      </Suspense>
    );
  }

  const style = {
    "--sidebar-width": "22rem",
    "--sidebar-width-icon": "4rem",
  };

  const isReadOnly = user.subscriptionStatus === "read_only";

  return (
    <SidebarProvider defaultOpen={true} style={style as React.CSSProperties}>
      <ShellWithHelperPanel projectId={projectId} isReadOnly={isReadOnly}>
        <MobileHeader />
        {isReadOnly && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300 shrink-0" data-testid="banner-subscription-lapsed">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Your subscription has lapsed. You can view your existing projects, but AI features are paused until you renew.{" "}
              <a href="https://patentgeyser.com/pricing" className="font-medium underline underline-offset-2">
                Renew here
              </a>
            </span>
          </div>
        )}
          <main className="flex-1 overflow-y-auto">
            <Suspense fallback={<RouteLoader />}>
            <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/prior-art-check" component={PriorArtCheck} />
            <Route path="/settings" component={UserSettings} />
            <Route path="/admin/whitelist" component={AdminWhitelist} />
            <Route path="/admin/users" component={AdminUsers} />
            <Route path="/admin/credits" component={AdminCredits} />
            <Route path="/admin/usage" component={AdminUsage} />
            <Route path="/project/:id/agent/1" component={Agent1} />
            <Route path="/project/:id/agent/1a" component={Agent1a} />
            <Route path="/project/:id/agent/1a-audit" component={Agent1aAudit} />
            <Route path="/project/:id/agent/1b" component={Agent1Inspect} />
            <Route path="/project/:id/agent/2a" component={Agent2a} />
            <Route path="/project/:id/agent/2b" component={Agent2b} />
            <Route path="/project/:id/agent/2c" component={Agent2cRedirect} />
            <Route path="/project/:id/agent/2" component={Agent2} />
            <Route path="/project/:id/agent/3" component={Agent3} />
            <Route path="/project/:id/agent/4a" component={Agent4} />
            <Route path="/project/:id/agent/4b" component={Agent4b} />
            <Route path="/project/:id/agent/4-conception-intro" component={Agent4PannuIntro} />
            <Route path="/project/:id/agent/4-conception" component={Agent4Pannu} />
            <Route path="/project/:id/agent/4c" component={Agent4c} />
            <Route path="/project/:id/agent/4" component={Agent4Redirect} />
            <Route path="/project/:id/agent/5" component={Agent5} />
            <Route path="/project/:id/agent/5-practitioner" component={Agent5Practitioner} />
            <Route component={NotFound} />
            </Switch>
            </Suspense>
          </main>
      </ShellWithHelperPanel>
    </SidebarProvider>
  );
}

/**
 * Inner layout component that has access to `useSidebar()`. Holds the AI
 * Helper docked-panel state and enforces mutual exclusivity with the left
 * sidebar: opening the panel collapses the sidebar; expanding the sidebar
 * closes the panel.
 */
const HELPER_PANEL_WIDTH_KEY = "ai-helper-panel-width";
const HELPER_PANEL_MIN_WIDTH = 360;
const HELPER_PANEL_MAX_WIDTH = 900;
const HELPER_PANEL_DEFAULT_WIDTH = 520;

function ShellWithHelperPanel({
  projectId,
  isReadOnly: _isReadOnly,
  children,
}: {
  projectId?: string;
  isReadOnly: boolean;
  children: React.ReactNode;
}) {
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const [helperOpen, setHelperOpen] = useState(false);
  const [helperInitialText, setHelperInitialText] = useState<string | undefined>(undefined);
  const sidebarWasOpenWhenHelperOpenedRef = useRef(false);

  // User-resizable panel width (persisted across sessions).
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return HELPER_PANEL_DEFAULT_WIDTH;
    const stored = Number(window.localStorage.getItem(HELPER_PANEL_WIDTH_KEY));
    if (!Number.isFinite(stored) || stored < HELPER_PANEL_MIN_WIDTH) return HELPER_PANEL_DEFAULT_WIDTH;
    return Math.min(stored, HELPER_PANEL_MAX_WIDTH);
  });
  const [isResizing, setIsResizing] = useState(false);

  // Track lg breakpoint so the inline width only applies on desktop;
  // on mobile the panel is a full-screen overlay.
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Save width to localStorage on commit (mouseup).
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HELPER_PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  // Drag handler: dragging LEFT widens the panel (since it's docked on the right).
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      const next = startWidth - (ev.clientX - startX);
      const clamped = Math.max(HELPER_PANEL_MIN_WIDTH, Math.min(HELPER_PANEL_MAX_WIDTH, next));
      setPanelWidth(clamped);
    };
    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Opening the helper collapses the left sidebar.
  useEffect(() => {
    if (helperOpen) {
      sidebarWasOpenWhenHelperOpenedRef.current = sidebarOpen;
      if (sidebarOpen) setSidebarOpen(false);
    }
    // We intentionally only run this when helperOpen flips; sidebarOpen is
    // captured in the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helperOpen]);

  // Re-expanding the left sidebar closes the helper.
  useEffect(() => {
    if (sidebarOpen && helperOpen) setHelperOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen]);

  const openHelper = (initialText?: string) => {
    setHelperInitialText(initialText);
    setHelperOpen(true);
  };

  const closeHelper = () => {
    setHelperOpen(false);
    setHelperInitialText(undefined);
  };

  return (
    <div className="flex h-screen w-full">
      <AppSidebar projectId={projectId} onOpenAIHelper={openHelper} />
      <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
      {helperOpen && projectId && (
        <aside
          className="border-l bg-background shrink-0 fixed lg:static inset-0 z-40 lg:z-auto flex flex-row w-full lg:w-auto"
          style={{
            // Tailwind handles mobile full-width; on lg+ we apply the pixel width.
            // CSS variable approach so a parent can override later if needed.
          }}
          data-testid="ai-helper-aside"
        >
          {/* Drag handle (desktop only). 6px wide hit area with a 1px visual stripe on hover/active. */}
          <div
            onMouseDown={startResize}
            className={`hidden lg:block w-1.5 cursor-col-resize select-none group ${
              isResizing ? "bg-primary/40" : "hover:bg-primary/20"
            }`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize AI Helper panel"
            data-testid="ai-helper-resize-handle"
          />
          <div
            className="flex flex-col flex-1 min-w-0 lg:flex-none"
            style={isDesktop ? { width: `${panelWidth}px` } : undefined}
          >
            <QAAssistantPanel
              projectId={projectId}
              onClose={closeHelper}
              initialText={helperInitialText}
              onInitialTextConsumed={() => setHelperInitialText(undefined)}
            />
          </div>
        </aside>
      )}
    </div>
  );
}

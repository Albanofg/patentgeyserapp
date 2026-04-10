import { useEffect, useState } from "react";
import { useLocation, useRoute, Switch, Route } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Loader2, Menu, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import geyserLogo from "@assets/geyser logo_1763486061835.png";
import Dashboard from "@/pages/dashboard";
import Agent1 from "@/pages/agent1";
import Agent1a from "@/pages/agent1a";
import Agent1aAudit from "@/pages/agent1a-audit";
import Agent1Inspect from "@/pages/agent1-inspect";
import Agent2 from "@/pages/agent2";
import Agent2a from "@/pages/agent2a";
import Agent2b from "@/pages/agent2b";
import Agent3 from "@/pages/agent3";
import Agent4 from "@/pages/agent4";
import Agent4b from "@/pages/agent4b";
import Agent4PannuIntro from "@/pages/agent4-pannu-intro";
import Agent4Pannu from "@/pages/agent4-pannu";
import Agent4c from "@/pages/agent4c";
import Agent5 from "@/pages/agent5";
import Agent5Practitioner from "@/pages/agent5-practitioner";
import PriorArtCheck from "@/pages/prior-art-check";
import UserSettings from "@/pages/user-settings";
import AdminWhitelist from "@/pages/admin-whitelist";
import AdminUsers from "@/pages/admin-users";
import TwoFactorVerify from "@/pages/two-factor-verify";
import NotFound from "@/pages/not-found";

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
  const [, agent4PannuIntroParams] = useRoute("/project/:id/agent/4-pannu-intro");
  const [, agent4PannuParams] = useRoute("/project/:id/agent/4-pannu");
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
      <TwoFactorVerify
        method={user.twoFactorMethod || 'email'}
        userId={user.id}
        email={user.email}
        onSuccess={() => {
          setTwoFactorComplete(true);
          refetch();
        }}
      />
    );
  }

  const style = {
    "--sidebar-width": "22rem",
    "--sidebar-width-icon": "4rem",
  };

  const isReadOnly = user.subscriptionStatus === "read_only";

  return (
    <SidebarProvider defaultOpen={true} style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar projectId={projectId} />
        <div className="flex-1 flex flex-col overflow-hidden">
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
            <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/prior-art-check" component={PriorArtCheck} />
            <Route path="/settings" component={UserSettings} />
            <Route path="/admin/whitelist" component={AdminWhitelist} />
            <Route path="/admin/users" component={AdminUsers} />
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
            <Route path="/project/:id/agent/4-pannu-intro" component={Agent4PannuIntro} />
            <Route path="/project/:id/agent/4-pannu" component={Agent4Pannu} />
            <Route path="/project/:id/agent/4c" component={Agent4c} />
            <Route path="/project/:id/agent/4" component={Agent4Redirect} />
            <Route path="/project/:id/agent/5" component={Agent5} />
            <Route path="/project/:id/agent/5-practitioner" component={Agent5Practitioner} />
            <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

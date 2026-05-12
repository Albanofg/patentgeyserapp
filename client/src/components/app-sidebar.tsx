import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ASK_AI_EVENT, type AskAIEventDetail } from "@/components/copy-selection-button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { CurrentIdeaModal } from "@/components/current-idea-modal";
import { Home, LogOut, Sparkles, Wrench, Search, TrendingUp, Image, Lightbulb, Code, FileSearch, MessageCircleQuestion, Settings } from "lucide-react";
import { CodeModal } from "@/components/code-modal";
import type { Project, User } from "@shared/schema";
import geyserLogo from "@/assets/geyser-logo.png";

const agentStages = [
  { number: 1, name: "Brainstorm", icon: Sparkles, description: "Advocate/Examiner", substages: [
    { id: '1a', name: "Advocate / Examiner", description: "Agent debate" },
    { id: '1b', name: "Inspect & Refine", description: "Review ideas" },
  ]},
  { number: 2, name: "Refinement", icon: Wrench, description: "Review & Polish", substages: [
    { id: '2a', name: "Expand Idea", description: "Detailed concept" },
    { id: '2b', name: "Extract & Select", description: "Ideas for research" },
  ]},
  { number: 3, name: "Prior Art", icon: Search, description: "Research Existing Patents" },
  { number: 4, name: "Provisional", icon: TrendingUp, description: "Strategy & Key Concepts", substages: [
    { id: '4a', name: "White Space Strategy", description: "White space analysis" },
    { id: '4b', name: "Key Concepts", description: "Draft key concept ideas" },
    { id: '4-conception', name: "Proof of Human Conception", description: "Inventorship validation" },
  ]},
  { number: 5, name: "The Showcase", icon: Image, description: "Download Your Patent", substages: [
    { id: '5', name: "Provisional Patent Draft", description: "Draft & diagrams" },
    { id: '5-practitioner', name: "Find a Practitioner", description: "Practitioner match", requiresPrereqs: true },
  ]},
];

interface AppSidebarProps {
  projectId?: string;
  /**
   * Called when the user clicks the AI Helper trigger. Optionally carries a
   * pre-fill string (e.g. selected text from an Ask AI event).
   */
  onOpenAIHelper?: (initialText?: string) => void;
}

// Map routes to human-readable location descriptions
function getLocationDescription(path: string): string {
  if (path === "/" || path === "/home") return "Dashboard - Project List";
  if (path === "/prior-art-check") return "Quick Prior Art Check Tool";
  if (path.includes("/agent/1")) return "Module 1: Intake & Screening (Advocate/Examiner Debate, Idea Extraction)";
  if (path.includes("/agent/2")) return "Module 2: Concept Refinement (Expand & Select Ideas)";
  if (path.includes("/agent/3")) return "Module 3: Prior Art Research (Patent Landscape Analysis)";
  if (path.includes("/agent/4")) return "Module 4: White Space Analysis & Key Concepts Generation";
  if (path.includes("/agent/5")) return "Module 5: The Showcase (Final Review, Diagrams, Export)";
  return "Patent Geyser Application";
}

export function AppSidebar({ projectId, onOpenAIHelper }: AppSidebarProps) {
  const [location, setLocation] = useLocation();
  const { open } = useSidebar();
  const [ideaModalOpen, setIdeaModalOpen] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  // currentLocationDescription is intentionally retained for future panel-aware
  // wiring; suppress the lint warning by referencing it explicitly below.
  const currentLocationDescription = getLocationDescription(location);
  void currentLocationDescription;

  // Listen for Ask AI events from text selection — forward the selected text
  // to the panel via the shared open handler.
  useEffect(() => {
    const handleAskAI = (event: Event) => {
      const customEvent = event as CustomEvent<AskAIEventDetail>;
      if (customEvent.detail?.selectedText && projectId) {
        onOpenAIHelper?.(customEvent.detail.selectedText);
      }
    };

    window.addEventListener(ASK_AI_EVENT, handleAskAI);
    return () => {
      window.removeEventListener(ASK_AI_EVENT, handleAskAI);
    };
  }, [projectId, onOpenAIHelper]);

  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent5Data } = useQuery({
    queryKey: ["/api/projects", projectId, "agent", 5],
    enabled: !!projectId && (project?.currentStage || 0) >= 5,
  });

  const agent5Obj = (agent5Data as any)?.data || {};
  const practitionerPrereqsMet = Array.isArray(agent5Obj?.diagrams) && agent5Obj.diagrams.length > 0;

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout", {});
    },
    onSuccess: () => {
      queryClient.clear();
      window.location.href = "/auth/login";
    },
  });

  const currentStage = project?.currentStage || 1;
  const isOnDashboard = location === "/" || location === "/dashboard";

  return (
    <TooltipProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b p-4">
          {open ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <img src={geyserLogo} alt="Patent Geyser" className="h-8 w-8" />
                <div className="flex flex-col leading-tight">
                  <span className="font-semibold text-base">Patent Geyser</span>
                  <span className="text-[10px] text-muted-foreground">Provisional Patent Draft Generator</span>
                </div>
              </div>
              <SidebarTrigger data-testid="button-sidebar-toggle" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 w-full">
              <img src={geyserLogo} alt="Patent Geyser" className="h-8 w-8" />
              <SidebarTrigger data-testid="button-sidebar-toggle" />
            </div>
          )}
        </SidebarHeader>

      <SidebarContent>
        {/* Dashboard Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      onClick={() => setLocation("/dashboard")}
                      isActive={isOnDashboard}
                      data-testid="nav-dashboard"
                      className="group-data-[collapsible=icon]:justify-center"
                    >
                      <Home className="h-4 w-4" />
                      <span className="group-data-[collapsible=icon]:hidden">Dashboard</span>
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  {!open && <TooltipContent side="right">Dashboard</TooltipContent>}
                </Tooltip>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      onClick={() => setLocation("/prior-art-check")}
                      isActive={location === "/prior-art-check"}
                      data-testid="nav-prior-art-check"
                      className="group-data-[collapsible=icon]:justify-center"
                    >
                      <FileSearch className="h-4 w-4" />
                      <span className="group-data-[collapsible=icon]:hidden">Quick Prior Art Check</span>
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  {!open && <TooltipContent side="right">Quick Prior Art Check</TooltipContent>}
                </Tooltip>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Current Project - only show when expanded */}
        {project && open && (
          <SidebarGroup>
            <SidebarGroupLabel>Current Project</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="px-3 py-2 text-sm">
                <p className="font-medium truncate">{project.title}</p>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Current Idea Button - accessible from any stage */}
        {projectId && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        onClick={() => setIdeaModalOpen(true)}
                        data-testid="button-view-current-idea"
                        className="group-data-[collapsible=icon]:justify-center bg-primary/10 border border-primary/30 text-primary font-medium hover:bg-primary/20"
                      >
                        <Lightbulb className="h-4 w-4 text-primary fill-primary/20" />
                        <span className="group-data-[collapsible=icon]:hidden">Your Current Idea</span>
                      </SidebarMenuButton>
                    </TooltipTrigger>
                    {!open && <TooltipContent side="right">Your Current Idea</TooltipContent>}
                  </Tooltip>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        onClick={() => setCodeModalOpen(true)}
                        data-testid="button-add-custom-code"
                        className="group-data-[collapsible=icon]:justify-center bg-accent/50 border border-accent text-foreground font-medium hover:bg-accent"
                      >
                        <Code className="h-4 w-4" />
                        <span className="group-data-[collapsible=icon]:hidden">Add Custom Code</span>
                      </SidebarMenuButton>
                    </TooltipTrigger>
                    {!open && <TooltipContent side="right">Add Custom Code</TooltipContent>}
                  </Tooltip>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        onClick={() => onOpenAIHelper?.()}
                        data-testid="button-qa-assistant"
                        className="group-data-[collapsible=icon]:justify-center bg-accent/50 border border-accent text-foreground font-medium hover:bg-accent"
                      >
                        <MessageCircleQuestion className="h-4 w-4" />
                        <span className="group-data-[collapsible=icon]:hidden">AI Helper</span>
                      </SidebarMenuButton>
                    </TooltipTrigger>
                    {!open && <TooltipContent side="right">AI Helper</TooltipContent>}
                  </Tooltip>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Agent Stages */}
        {projectId && (
          <SidebarGroup>
            <SidebarGroupLabel>Patent Workflow</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {agentStages.map((stage) => {
                  const Icon = stage.icon;
                  const isActive = location.includes(`/agent/${stage.number}`) && !stage.substages; // Not active if has substages
                  // Allow clicking on current and all completed stages (backward navigation allowed)
                  const isAccessible = stage.number <= currentStage;
                  const isCompleted = stage.number < currentStage;
                  // Show substages when we've reached the stage or beyond
                  const showSubstages = stage.substages && currentStage >= stage.number;

                  return (
                    <div key={stage.number}>
                      <SidebarMenuItem>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              onClick={() => {
                                if (isAccessible) {
                                  // For stages with substages, redirect to current substage or default to first
                                  if (stage.substages) {
                                    const currentSubstage = project?.currentSubstage;
                                    // Determine which substage to navigate to
                                    let targetSubstage = stage.substages[0].id;
                                    if (currentSubstage && currentSubstage.startsWith(`${stage.number}`)) {
                                      targetSubstage = currentSubstage;
                                    }
                                    setLocation(`/project/${projectId}/agent/${targetSubstage}`);
                                  } else {
                                    setLocation(`/project/${projectId}/agent/${stage.number}`);
                                  }
                                }
                              }}
                              isActive={isActive}
                              disabled={!isAccessible}
                              data-testid={`nav-agent-${stage.number}`}
                              className="group-data-[collapsible=icon]:justify-center"
                            >
                              <Icon className={`h-4 w-4 shrink-0 ${isCompleted ? 'text-green-600 dark:text-green-400' : ''}`} />
                              <span className="text-sm font-medium truncate flex-1 group-data-[collapsible=icon]:hidden">
                                {stage.name}
                              </span>
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          {!open && (
                            <TooltipContent side="right">
                              <div className="font-medium">{stage.name}</div>
                              <div className="text-xs text-muted-foreground">{stage.description}</div>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </SidebarMenuItem>

                      {/* Substages - nested under parent stage */}
                      {showSubstages && stage.substages.map((substage) => {
                        const isSubstageActive = location.includes(`/agent/${substage.id}`);
                        
                        // Accessible if: we're at this stage (can navigate freely between substages), OR we're beyond this stage
                        const isSubstageAccessible = (currentStage === stage.number) || currentStage > stage.number;

                        // For substages that require extra prereqs (e.g. practitioner match needs diagrams + broad claims)
                        const prereqsRequired = (substage as any).requiresPrereqs;
                        const prereqsLocked = prereqsRequired && !practitionerPrereqsMet;
                        const isClickable = isSubstageAccessible && !prereqsLocked;
                        
                        return (
                          <SidebarMenuItem
                            key={substage.id}
                            className="ml-6 group-data-[collapsible=icon]:hidden"
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <SidebarMenuButton
                                  onClick={() => {
                                    if (isClickable) {
                                      setLocation(`/project/${projectId}/agent/${substage.id}`);
                                    }
                                  }}
                                  isActive={isSubstageActive}
                                  disabled={!isClickable}
                                  data-testid={`nav-agent-${substage.id}`}
                                  size="sm"
                                >
                                  <span className="text-sm truncate flex-1">
                                    {substage.name}
                                  </span>
                                </SidebarMenuButton>
                              </TooltipTrigger>
                              {(!isSubstageAccessible || prereqsLocked) && (
                                <TooltipContent side="right">
                                  <div className="text-xs">
                                    {prereqsLocked
                                      ? "Generate drawings first"
                                      : "Complete earlier stages to unlock"}
                                  </div>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </SidebarMenuItem>
                        );
                      })}
                    </div>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

        <SidebarFooter className="border-t p-4 space-y-2">
          {user && open && (
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="text-sm text-muted-foreground truncate">{user.email}</span>
              <ThemeToggle />
            </div>
          )}
          {!open && <ThemeToggle />}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={open ? "sm" : "icon"}
                className="w-full justify-start"
                onClick={() => setLocation("/settings")}
                data-testid="button-settings"
              >
                <Settings className="h-4 w-4" />
                {open && <span className="ml-2">Settings</span>}
              </Button>
            </TooltipTrigger>
            {!open && <TooltipContent side="right">Settings</TooltipContent>}
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size={open ? "sm" : "icon"}
                className="w-full"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
                {open && <span className="ml-2">Logout</span>}
              </Button>
            </TooltipTrigger>
            {!open && <TooltipContent side="right">Logout</TooltipContent>}
          </Tooltip>
        </SidebarFooter>
      </Sidebar>
      
      {/* Current Idea Modal */}
      {projectId && (
        <CurrentIdeaModal
          projectId={projectId}
          open={ideaModalOpen}
          onOpenChange={setIdeaModalOpen}
        />
      )}
      
      {/* Code Modal */}
      {projectId && (
        <CodeModal
          projectId={projectId}
          open={codeModalOpen}
          onOpenChange={setCodeModalOpen}
        />
      )}
      
    </TooltipProvider>
  );
}

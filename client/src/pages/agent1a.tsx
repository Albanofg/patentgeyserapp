import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseAuditData, hasAuditFormat } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, MessageSquare, Search, ArrowRight, ArrowLeft, Clipboard } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Project } from "@shared/schema";
import { usePageSnapshot, type PageSnapshot } from "@/lib/page-snapshot";
import { useHumanInputWriter } from "@/lib/human-inputs";

interface IdeaSnapshot {
  id: string;
  snapshotType: string;
  title: string | null;
  content: string;
  command: string | null;
  qualityScore: string | null;
  metadata: { [key: string]: any } | null;
  version: number;
  createdAt: string;
}

interface CurrentIdeaData {
  currentIdea: string | null;
  currentVersion: number;
  snapshots: IdeaSnapshot[];
}

interface ConversationRound {
  id: string;
  userMessage: string;
  agentsDebate: any[];
  transcript?: string;
  roundType?: "brainstorm" | "mechanic";
  command?: string;
  qualityScore?: number;
  createdAt: string;
}

interface Agent1Data {
  ideaSummary: string;
  rounds: ConversationRound[];
  status?: "active" | "finalized";
}

export default function Agent1a() {
  const [, params] = useRoute("/project/:id/agent/1a");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;

  const [initialIdea, setInitialIdea] = useState("");

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent1Data, isLoading: dataLoading } = useQuery<{ data: Agent1Data }>({
    queryKey: ["/api/projects", projectId, "agent", 1],
    enabled: !!projectId,
  });

  const { data: currentIdeaData } = useQuery<CurrentIdeaData>({
    queryKey: ["/api/projects", projectId, "current-idea"],
    enabled: !!projectId,
  });

  const startBrainstormMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/projects/${projectId}/agent/1/rounds`, {
        idea: initialIdea,
        message: initialIdea,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 1] });
      setInitialIdea("");
      toast({
        title: "Brainstorming started!",
        description: "Advocate and Examiner are analyzing your idea.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to start brainstorm",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const inspectAndRefineMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/projects/${projectId}/agent/1/extract-ideas`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 1] });
      setLocation(`/project/${projectId}/agent/1b`);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to extract ideas",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const continueToAgent2Mutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/projects/${projectId}/agent/1/finalize`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      setLocation(`/project/${projectId}/agent/2a`);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to continue",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ── Page snapshot for the AI Helper ─────────────────────────────────────
  // 1a is the initial Advocate/Examiner brainstorm. Two display modes:
  // (1) no rounds yet → a single editable idea Textarea + "Send to A/E";
  // (2) rounds exist → read-only debate panels, plus "Inspect & Refine"
  // (extract ideas) or "Continue to Stage 2" actions.
  const snapshot = useMemo<PageSnapshot>(() => {
    const roundsLocal = (agent1Data?.data?.rounds || []) as ConversationRound[];
    const hasStartedLocal = roundsLocal.length > 0;
    const brainstormRoundsLocal = roundsLocal.filter((r) => r.roundType !== "mechanic");
    const latestRound = brainstormRoundsLocal[brainstormRoundsLocal.length - 1];
    const hasDebateLocal = !!(latestRound?.agentsDebate && Array.isArray(latestRound.agentsDebate));
    const originalIdeaLocal = brainstormRoundsLocal[0]?.userMessage || "";
    const hasRound2Local =
      brainstormRoundsLocal.length > 1 &&
      brainstormRoundsLocal[brainstormRoundsLocal.length - 1]?.agentsDebate &&
      hasAuditFormat(brainstormRoundsLocal[brainstormRoundsLocal.length - 1].agentsDebate);

    const items: NonNullable<PageSnapshot["items"]> = [];
    const drafts: Record<string, string> = {};

    if (!hasStartedLocal) {
      if (initialIdea) drafts["idea"] = initialIdea;
      items.push({
        id: "idea_input",
        type: "invention_description_field",
        status: initialIdea.trim() ? "drafted" : "empty",
        editable: true,
        editTarget: "idea",
        content: { currentValue: initialIdea },
      });
    } else {
      items.push({
        id: "original_idea",
        type: "invention_description",
        status: "submitted",
        editable: false,
        content: originalIdeaLocal,
      });
      if (latestRound?.agentsDebate && Array.isArray(latestRound.agentsDebate)) {
        latestRound.agentsDebate.forEach((agent: any, idx: number) => {
          const speaker = agent.speaker || (idx === 0 ? "Advocate" : idx === 1 ? "Examiner" : `Agent ${idx + 1}`);
          items.push({
            id: `debate_${speaker.toLowerCase()}_${idx}`,
            type: "debate_panel",
            editable: false,
            content: { speaker, message: agent.message ?? "" },
          });
        });
      }
    }

    const actions: NonNullable<PageSnapshot["actions"]> = [];
    if (!hasStartedLocal) {
      actions.push({
        id: "paste-idea",
        label: "Paste",
        kind: "secondary",
        enabled: !startBrainstormMutation.isPending,
      });
      actions.push({
        id: "start-brainstorm",
        label: "Send to Advocate / Examiner",
        kind: "primary",
        enabled: !startBrainstormMutation.isPending && initialIdea.trim().length > 0,
        reason: !initialIdea.trim() ? "Idea field is empty" : undefined,
      });
    } else {
      if (hasRound2Local) {
        actions.push({
          id: "view-round-2-audit",
          label: "View Round 2 Audit",
          kind: "secondary",
          enabled: true,
          navigatesTo: `/project/${projectId}/agent/1a-audit`,
        });
      }
      actions.push({
        id: "inspect-and-refine",
        label: "Inspect & Refine",
        kind: "secondary",
        enabled:
          !inspectAndRefineMutation.isPending &&
          !continueToAgent2Mutation.isPending &&
          hasDebateLocal,
        reason: !hasDebateLocal ? "Debate has not produced results yet" : undefined,
        navigatesTo: `/project/${projectId}/agent/1b`,
      });
      actions.push({
        id: "continue-to-stage-2",
        label: "Continue to Stage 2",
        kind: "primary",
        enabled:
          !continueToAgent2Mutation.isPending &&
          !inspectAndRefineMutation.isPending &&
          hasDebateLocal,
        reason: !hasDebateLocal ? "Debate has not produced results yet" : undefined,
        navigatesTo: `/project/${projectId}/agent/2a`,
      });
    }

    return {
      // Prompt-phase mapping: PHASE_1_INSPECT_AND_REFINE_IDEAS — both the
      // describe-invention and Advocate/Examiner debate surfaces are part of
      // Stage 1's idea-refinement loop in the prompt's mental model.
      phase: 1,
      pageName: hasStartedLocal
        ? "Advocate / Examiner Debate (Stage 1a)"
        : "Describe Your Invention (Stage 1a)",
      route: `/project/${projectId}/agent/1a`,
      description: hasStartedLocal
        ? "User reviews the Advocate/Examiner debate of their invention idea. The idea field is no longer editable on this page; user can move on by inspecting+refining or by continuing to stage 2."
        : "User describes their invention in a Textarea, then sends it to the Advocate/Examiner debate. The Textarea is the only editable surface.",
      items,
      drafts,
      actions,
      source: "structured",
    };
  }, [
    agent1Data,
    initialIdea,
    startBrainstormMutation.isPending,
    inspectAndRefineMutation.isPending,
    continueToAgent2Mutation.isPending,
    projectId,
  ]);
  usePageSnapshot(snapshot);

  // Human-input ledger writer for the original idea description. Captures
  // the very first thing the user typed about the invention — high-value
  // material for Pannu's conception and known_concepts factors.
  useHumanInputWriter({
    projectId,
    source: "module1/initial-idea",
    promptText: "What software, SaaS, or blockchain invention do you want to patent?",
    answerText: initialIdea,
    tags: ["problem_narrative", "conception_mechanism"],
  });

  if (projectLoading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loader-page" />
      </div>
    );
  }

  if (!project || !projectId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  const rounds = agent1Data?.data?.rounds || [];
  const hasStarted = rounds.length > 0;
  const brainstormRounds = rounds.filter((r: ConversationRound) => r.roundType !== "mechanic");
  const latestBrainstormRound = brainstormRounds[brainstormRounds.length - 1];
  const hasDebateResults = latestBrainstormRound?.agentsDebate && Array.isArray(latestBrainstormRound.agentsDebate);
  const originalIdea = brainstormRounds[0]?.userMessage || "";
  
  // Check if there's actual Round 2 audit data using shared helper
  const hasRound2 = brainstormRounds.length > 1 && 
    brainstormRounds[brainstormRounds.length - 1]?.agentsDebate &&
    hasAuditFormat(brainstormRounds[brainstormRounds.length - 1].agentsDebate);

  if (!hasStarted) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-2xl w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Describe Your Invention
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="idea">What software, SaaS, or blockchain invention do you want to patent?</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="button-paste"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) {
                          setInitialIdea(text);
                        }
                      } catch (err) {
                        toast({
                          title: "Unable to paste",
                          description: "Please paste manually using Ctrl+V or Cmd+V",
                          variant: "destructive",
                        });
                      }
                    }}
                    disabled={startBrainstormMutation.isPending}
                  >
                    <Clipboard className="h-4 w-4 mr-1" />
                    Paste
                  </Button>
                </div>
                <Textarea
                  id="idea"
                  data-testid="input-idea"
                  placeholder="Describe your invention in detail. Include the problem it solves, how it works, and what makes it unique..."
                  value={initialIdea}
                  onChange={(e) => setInitialIdea(e.target.value)}
                  className="min-h-32"
                  disabled={startBrainstormMutation.isPending}
                />
              </div>
              <Button
                onClick={() => startBrainstormMutation.mutate()}
                disabled={startBrainstormMutation.isPending || !initialIdea.trim()}
                className="w-full"
                size="lg"
                data-testid="button-start-brainstorm"
              >
                {startBrainstormMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Send to Advocate / Examiner
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Two AI agents will debate the strengths and weaknesses of your idea
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="border-b p-4 shrink-0">
        <div className="max-w-4xl mx-auto space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary shrink-0" />
                <span>Round 1: Advocate / Examiner Debate</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Initial brainstorming session
              </p>
            </div>
            {hasRound2 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/project/${projectId}/agent/1a-audit`)}
                data-testid="button-view-round2"
                className="shrink-0"
              >
                <span className="hidden sm:inline">View Round 2 Audit</span>
                <span className="sm:hidden">Round 2</span>
                <ArrowRight className="ml-1 sm:ml-2 h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {originalIdea && (
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base">Your Idea</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{originalIdea}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {hasDebateResults && latestBrainstormRound?.agentsDebate ? (
            Array.isArray(latestBrainstormRound.agentsDebate) && latestBrainstormRound.agentsDebate.map((agent: any, idx: number) => {
              const isAdvocate = agent.speaker === "Advocate" || idx === 0;
              const isExaminer = agent.speaker === "Examiner" || idx === 1;
              
              let borderColor = "border-l-4 border-l-muted";
              let bgColor = "";
              let labelColor = "";
              
              if (isAdvocate) {
                borderColor = "border-l-4 border-l-green-500";
                bgColor = "bg-green-50 dark:bg-green-950/20";
                labelColor = "text-green-700 dark:text-green-400";
              } else if (isExaminer) {
                borderColor = "border-l-4 border-l-red-500";
                bgColor = "bg-red-50 dark:bg-red-950/20";
                labelColor = "text-red-700 dark:text-red-400";
              }

              // Parse audit JSON using helper
              const auditData = parseAuditData(agent.message);
              const isAuditRound = auditData !== null;
              
              return (
                <Card key={idx} className={`${borderColor} ${bgColor}`}>
                  <CardHeader>
                    <CardTitle className={`text-lg font-bold ${labelColor}`}>
                      {isAdvocate ? "Advocate" : isExaminer ? "Examiner" : agent.speaker || `Agent ${idx + 1}`}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isAuditRound && auditData ? (
                      <div className="space-y-3">
                        <p className="text-sm font-medium mb-3">
                          {isAdvocate ? "Review of your improved idea - which strengths were maintained:" : "Review of your improved idea - which issues were addressed:"}
                        </p>
                        {auditData.audit_log.map((item: any, auditIdx: number) => {
                          const status = item.status;
                          const isPreserved = status === "PRESERVED";
                          const isFixed = status === "FIXED";
                          const needsWork = status === "YET TO FIX";
                          
                          let statusBadge = "";
                          let statusColor = "";
                          
                          if (isPreserved || isFixed) {
                            statusBadge = isPreserved ? "✓ Preserved" : "✓ Fixed";
                            statusColor = "text-green-600 dark:text-green-400";
                          } else if (needsWork) {
                            statusBadge = "⚠ Needs Work";
                            statusColor = "text-orange-600 dark:text-orange-400";
                          }
                          
                          const content = item.original_praise || item.original_objection || "";
                          
                          return (
                            <div key={auditIdx} className="border-l-2 pl-3 py-2 space-y-1" style={{
                              borderColor: isPreserved || isFixed ? '#22c55e' : needsWork ? '#f97316' : '#94a3b8'
                            }}>
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm flex-1">{content}</p>
                                <span className={`text-xs font-semibold whitespace-nowrap ${statusColor}`}>
                                  {statusBadge}
                                </span>
                              </div>
                              {item.reasoning && (
                                <p className="text-xs text-muted-foreground italic">{item.reasoning}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown>{agent.message || ""}</ReactMarkdown>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <p>Advocate/Examiner analysis will appear here after brainstorming starts.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="border-t p-4 bg-background shrink-0">
        <div className="max-w-4xl mx-auto">
          {/* Mobile: Stack buttons vertically */}
          <div className="flex flex-col gap-3 sm:hidden">
            {/* Mobile vertical stack — original spatial order (Continue top,
                Inspect bottom) preserved so returning users find each button
                where they remember it. Variants are inverted: Inspect & Refine
                is the blue/primary CTA because it's the step inventors should
                run, and the Continue label is prefixed with "Skip &" so users
                who do click it know they're choosing to bypass the important
                step. */}
            <Button
              type="button"
              variant="outline"
              onClick={() => continueToAgent2Mutation.mutate()}
              disabled={continueToAgent2Mutation.isPending || inspectAndRefineMutation.isPending || !hasDebateResults}
              data-testid="button-continue"
              className="w-full"
            >
              {continueToAgent2Mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Moving...
                </>
              ) : (
                <>
                  Skip & Continue to Stage 2
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <Button
              type="button"
              onClick={() => inspectAndRefineMutation.mutate()}
              disabled={inspectAndRefineMutation.isPending || continueToAgent2Mutation.isPending || !hasDebateResults}
              data-testid="button-inspect-refine"
              className="w-full"
            >
              {inspectAndRefineMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extracting Ideas...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Inspect & Refine Ideas
                </>
              )}
            </Button>
          </div>
          {/* Desktop: Horizontal layout */}
          <div className="hidden sm:flex items-center justify-end gap-3">
            {/* Desktop horizontal — original spatial order (Inspect on left,
                Continue on right) preserved so returning users find each
                button where they remember it. Variants are inverted: Inspect
                & Refine is the blue/primary CTA because it's the step
                inventors should run, and the Continue label is prefixed with
                "Skip &" so users who do click it know they're choosing to
                bypass the important step. */}
            <Button
              type="button"
              onClick={() => inspectAndRefineMutation.mutate()}
              disabled={inspectAndRefineMutation.isPending || continueToAgent2Mutation.isPending || !hasDebateResults}
              data-testid="button-inspect-refine-desktop"
            >
              {inspectAndRefineMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extracting Ideas...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Inspect & Refine Ideas
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => continueToAgent2Mutation.mutate()}
              disabled={continueToAgent2Mutation.isPending || inspectAndRefineMutation.isPending || !hasDebateResults}
              data-testid="button-continue-desktop"
            >
              {continueToAgent2Mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Moving...
                </>
              ) : (
                <>
                  Skip & Continue to Stage 2
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

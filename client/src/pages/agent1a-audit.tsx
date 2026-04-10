import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseAuditData, hasAuditFormat } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, ArrowRight, ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Project } from "@shared/schema";

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

export default function Agent1aAudit() {
  const [, params] = useRoute("/project/:id/agent/1a-audit");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;

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
  const brainstormRounds = rounds.filter((r: ConversationRound) => r.roundType !== "mechanic");
  const latestBrainstormRound = brainstormRounds[brainstormRounds.length - 1];
  const originalIdea = brainstormRounds[0]?.userMessage || "";
  
  // Check if the latest round contains audit format data using shared helper
  const hasAuditResults = latestBrainstormRound?.agentsDebate &&
    hasAuditFormat(latestBrainstormRound.agentsDebate);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Round 2: Re-Analysis Audit</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Advocate and Examiner reviewed your improved idea
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation(`/project/${projectId}/agent/1a`)}
              data-testid="button-view-round1"
            >
              <ArrowLeft className="mr-2 h-3 w-3" />
              View Round 1
            </Button>
          </div>

          {/* Original First Input - Always shown first */}
          {originalIdea && (
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base">Your Original Idea</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{originalIdea}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Show improved idea if different from original */}
          {currentIdeaData?.currentIdea && currentIdeaData.currentIdea !== originalIdea && (
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base">Your Improved Idea:</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{currentIdeaData.currentIdea}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {hasAuditResults && latestBrainstormRound.agentsDebate ? (
            latestBrainstormRound.agentsDebate.map((agent: any, idx: number) => {
              const isGoodCop = agent.speaker === "Advocate" || idx === 0;
              const isBadCop = agent.speaker === "Examiner" || idx === 1;
              
              let borderColor = "border-l-4 border-l-muted";
              let bgColor = "";
              let labelColor = "";
              
              if (isGoodCop) {
                borderColor = "border-l-4 border-l-green-500";
                bgColor = "bg-green-50 dark:bg-green-950/20";
                labelColor = "text-green-700 dark:text-green-400";
              } else if (isBadCop) {
                borderColor = "border-l-4 border-l-red-500";
                bgColor = "bg-red-50 dark:bg-red-950/20";
                labelColor = "text-red-700 dark:text-red-400";
              }

              // Parse audit JSON using helper
              const auditData = parseAuditData(agent.message);
              const isAuditRound = auditData !== null;
              
              return (
                <Card key={idx} className={`${borderColor} ${bgColor}`} data-testid={`card-audit-${isGoodCop ? 'goodcop' : 'badcop'}`}>
                  <CardHeader>
                    <CardTitle className={`text-lg font-bold ${labelColor}`}>
                      {isGoodCop ? "Advocate" : isBadCop ? "Examiner" : agent.speaker || `Agent ${idx + 1}`}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isAuditRound && auditData ? (
                      <div className="space-y-3">
                        <p className="text-sm font-medium mb-3">
                          {isGoodCop ? "Review of your improved idea - which strengths were maintained:" : "Review of your improved idea - which issues were addressed:"}
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
                            }} data-testid={`audit-item-${auditIdx}`}>
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
                <p>No audit results available. Please re-analyze your idea first.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="border-t p-4 bg-background flex-shrink-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-end gap-3 flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={() => inspectAndRefineMutation.mutate()}
              disabled={inspectAndRefineMutation.isPending || continueToAgent2Mutation.isPending || !hasAuditResults}
              data-testid="button-inspect-refine"
            >
              {inspectAndRefineMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extracting Ideas...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Inspect & Refine
                </>
              )}
            </Button>
            <Button
              type="button"
              onClick={() => continueToAgent2Mutation.mutate()}
              disabled={continueToAgent2Mutation.isPending || inspectAndRefineMutation.isPending || !hasAuditResults}
              data-testid="button-continue"
            >
              {continueToAgent2Mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Moving...
                </>
              ) : (
                <>
                  Continue to Stage 2
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

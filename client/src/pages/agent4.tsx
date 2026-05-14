import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { Loader2, AlertTriangle, Shield, FileText, PencilLine, ChevronDown, ChevronUp, CheckCircle, XCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Project } from "@shared/schema";

export default function Agent4() {
  const [, params] = useRoute("/project/:id/agent/4a");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;
  const [userNotes, setUserNotes] = useState<{ [conceptIndex: number]: string }>({});
  const [expandedConcepts, setExpandedConcepts] = useState<{ [key: number]: boolean }>({});

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent4Data, isLoading: agent4Loading } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "agent", 4],
    enabled: !!projectId,
  });

  useEffect(() => {
    const agent4DataObj = agent4Data?.data as any;
    if (agent4DataObj?.userNotes) {
      setUserNotes(agent4DataObj.userNotes);
    }
  }, [agent4Data]);

  useEffect(() => {
    if (!project) return;
    
    if (project.currentStage < 4) {
      const targetPage = project.currentStage === 2 && project.currentSubstage
        ? `/project/${projectId}/agent/${project.currentSubstage}`
        : project.currentStage
          ? `/project/${projectId}/agent/${project.currentStage}`
          : `/`;
      
      const destination = project.currentStage ? `Agent ${project.currentStage}` : 'Dashboard';
      toast({
        title: `Redirected to ${destination}`,
        description: `Please complete earlier stages first.`,
      });
      setLocation(targetPage);
    }
  }, [project, projectId, setLocation, toast]);

  const saveNoteMutation = useMutation({
    mutationFn: async ({ conceptIndex, note }: { conceptIndex: number; note: string }) => {
      const agent4DataObj = agent4Data?.data as any;
      const updatedUserNotes = { ...userNotes, [conceptIndex]: note };
      
      return await apiRequest("POST", `/api/projects/${projectId}/agent/4`, {
        ...agent4DataObj,
        userNotes: updatedUserNotes
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 4] });
    },
  });

  const proceedToClaimsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/agent/4b/generate-claims`);
      await apiRequest("POST", `/api/projects/${projectId}/substage/proceed`, { substage: '4b' });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 4] });
      
      toast({
        title: "Key concepts generated!",
        description: "Your patent key concepts are ready to review.",
      });
      setLocation(`/project/${projectId}/agent/4b`);
    },
    onError: (error: Error) => {
      toast({
        title: "Key concept generation failed",
        description: error.message,
      });
    },
  });

  if (projectLoading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const agent4DataObj = agent4Data?.data as any;
  const analysisResults = Array.isArray(agent4DataObj) 
    ? agent4DataObj[0] 
    : agent4DataObj || {};
  
  const strategicDirective = analysisResults.strategicDirective || "";
  const conceptAnalyses = analysisResults.conceptAnalyses || [];
  const nuggetAnalyses = analysisResults.nuggetAnalyses || [];
  const summary = analysisResults.summary || {};
  
  const isNewFormat = conceptAnalyses.length > 0;
  const totalAnalyzed = isNewFormat 
    ? summary.totalConceptsAnalyzed || conceptAnalyses.length
    : analysisResults.totalNuggetsAnalyzed || nuggetAnalyses.length;

  const getRiskBadgeVariant = (riskLevel: string) => {
    const level = riskLevel?.toLowerCase();
    if (level === 'red' || level === 'high') return 'destructive';
    if (level === 'yellow' || level === 'medium') return 'secondary';
    if (level === 'green' || level === 'low' || level === 'minimal') return 'default';
    return 'secondary';
  };

  const getRiskIcon = (riskLevel: string) => {
    const level = riskLevel?.toLowerCase();
    if (level === 'red' || level === 'high') return <AlertTriangle className="h-4 w-4" />;
    if (level === 'yellow' || level === 'medium') return <AlertTriangle className="h-4 w-4" />;
    if (level === 'green' || level === 'low' || level === 'minimal') return <Shield className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  const getThreatBadgeVariant = (threatLevel: string) => {
    const level = threatLevel?.toLowerCase();
    if (level === 'high') return 'destructive';
    if (level === 'medium') return 'secondary';
    return 'default';
  };

  const isAnalysisComplete = agent4DataObj?.status === 'analysis_complete' || conceptAnalyses.length > 0 || nuggetAnalyses.length > 0;

  const toggleConceptExpanded = (index: number) => {
    setExpandedConcepts(prev => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div className="min-h-screen bg-background">
      <AgentHeader
        project={project}
        agentNumber={4}
        agentName="White Space Strategy"
        agentDescription="White space analysis and key concepts drafting strategy"
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {agent4Loading ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">Analyzing white space...</p>
          </div>
        ) : !isAnalysisComplete ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <AlertTriangle className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No analysis results available yet.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Summary Card for New Format. The risk-distribution chips
                only render when the analyzer actually produced risk levels —
                the rewritten 4a prompt is fact-only and emits no risk data,
                so those chips would otherwise be a row of zeros. */}
            {isNewFormat && summary.riskDistribution && (
              <Card className="bg-muted/30">
                <CardHeader>
                  <CardTitle className="text-lg">Analysis Summary</CardTitle>
                  <CardDescription>
                    {summary.totalConceptsAnalyzed} concepts analyzed across {summary.totalPatentsAnalyzed} patents
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-4">
                    {((summary.riskDistribution.green || 0) +
                      (summary.riskDistribution.yellow || 0) +
                      (summary.riskDistribution.red || 0) > 0) && (
                      <>
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-green-500" />
                          <span className="text-sm">{summary.riskDistribution.green || 0} Green</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          <span className="text-sm">{summary.riskDistribution.yellow || 0} Yellow</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                          <span className="text-sm">{summary.riskDistribution.red || 0} Red</span>
                        </div>
                      </>
                    )}
                    {summary.totalHighThreats > 0 && (
                      <div className="flex items-center gap-2 ml-auto">
                        <Badge variant="destructive">{summary.totalHighThreats} High Threat{summary.totalHighThreats !== 1 ? 's' : ''}</Badge>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Detailed Analysis by Concept */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Detailed Analysis by Concept</h2>
                <p className="text-sm text-muted-foreground">
                  Analyzed {totalAnalyzed} concept{totalAnalyzed !== 1 ? 's' : ''}
                </p>
              </div>
              
              {/* New Format: conceptAnalyses with patentAnalyses */}
              {isNewFormat ? (
                conceptAnalyses.map((concept: any, index: number) => {
                  // Risk/threat fields are only meaningful when the analyzer
                  // actually returned them. The rewritten 4a prompt is
                  // fact-only and produces neither — so hide the badge and
                  // the threat-count line when there's nothing to show.
                  const riskKnown = ["red", "yellow", "green"].includes(
                    String(concept.overallRiskLevel || "").toLowerCase(),
                  );
                  const threats = concept.threatCounts || {};
                  const anyThreats =
                    (threats.high || 0) + (threats.medium || 0) + (threats.low || 0) > 0;
                  const borderColor = !riskKnown
                    ? "hsl(var(--border))"
                    : concept.overallRiskLevel?.toLowerCase() === "red"
                      ? "hsl(var(--destructive))"
                      : concept.overallRiskLevel?.toLowerCase() === "green"
                        ? "hsl(var(--primary))"
                        : "hsl(var(--warning))";
                  return (
                  <Card
                    key={index}
                    className="border-l-4"
                    style={{ borderLeftColor: borderColor }}
                    data-testid={`concept-analysis-${index}`}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <CardTitle className="text-lg">
                            Concept {concept.conceptNumber || index + 1}: {concept.conceptTitle || ''}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            {concept.totalPatentsAnalyzed} patents analyzed
                            {anyThreats && (
                              <span className="ml-2">
                                ({threats.high || 0} high, {threats.medium || 0} medium, {threats.low || 0} low threats)
                              </span>
                            )}
                          </CardDescription>
                        </div>
                        {riskKnown && (
                          <Badge
                            variant={getRiskBadgeVariant(concept.overallRiskLevel)}
                            className="flex items-center gap-1"
                            data-testid={`risk-badge-${index}`}
                          >
                            {getRiskIcon(concept.overallRiskLevel)}
                            {concept.overallRiskLevel} Risk
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Patent Analyses - Collapsible */}
                      <Collapsible open={expandedConcepts[index]} onOpenChange={() => toggleConceptExpanded(index)}>
                        <CollapsibleTrigger asChild>
                          <Button variant="outline" className="w-full justify-between" data-testid={`button-toggle-patents-${index}`}>
                            <span>Prior Art Patent Analysis ({concept.patentAnalyses?.length || 0} patents)</span>
                            {expandedConcepts[index] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-4 space-y-3">
                          {concept.patentAnalyses?.map((patent: any, pIdx: number) => {
                            const threatKnown = ["high", "medium", "low"].includes(
                              String(patent.threatLevel || "").toLowerCase(),
                            );
                            const mechs: string[] = patent.extractedMechanisms || [];
                            const questions: string[] = patent.inventorClarificationQuestions || [];
                            return (
                            <div
                              key={pIdx}
                              className="bg-muted/50 p-4 rounded-lg border"
                              data-testid={`patent-analysis-${index}-${pIdx}`}
                            >
                              <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-sm">{pIdx + 1}. {patent.patentNumber}</span>
                                    {threatKnown && (
                                      <Badge variant={getThreatBadgeVariant(patent.threatLevel)} className="text-xs">
                                        {patent.threatLevel}
                                      </Badge>
                                    )}
                                    {patent.patentStatus && (
                                      <Badge variant="outline" className="text-xs">
                                        {patent.patentStatus}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1">{patent.patentTitle || patent.title}</p>
                                </div>
                              </div>

                              {mechs.length > 0 ? (
                                <div className="space-y-1 text-sm mb-3">
                                  <div className="font-medium text-muted-foreground text-xs">Extracted Mechanisms</div>
                                  <ul className="list-disc list-inside space-y-0.5">
                                    {mechs.map((m, mIdx) => (
                                      <li key={mIdx}>{m}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : patent.specificConstraint ? (
                                <div className="text-sm mb-3">
                                  <span className="font-medium text-muted-foreground">Constraint: </span>
                                  <span>{patent.constraint || patent.specificConstraint}</span>
                                </div>
                              ) : null}

                              {questions.length > 0 ? (
                                <div className="space-y-1 text-sm">
                                  <div className="font-medium text-primary text-xs">Inventor Clarification Questions</div>
                                  <ul className="list-disc list-inside space-y-0.5">
                                    {questions.map((q, qIdx) => (
                                      <li key={qIdx}>{q}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : patent.differentiationStrategy ? (
                                <div className="text-sm">
                                  <span className="font-medium text-primary">Differentiation: </span>
                                  <span>{patent.differentiationStrategy}</span>
                                </div>
                              ) : null}
                            </div>
                          );
                          })}
                        </CollapsibleContent>
                      </Collapsible>

                      {/* Strategic Guidance */}
                      {concept.strategy && (
                        <div className="mt-4 space-y-3">
                          <h4 className="font-semibold text-sm text-primary">Strategic Guidance</h4>
                          
                          {concept.strategy.whiteSpaceStrategy && (
                            <div>
                              <h5 className="text-xs font-medium text-muted-foreground mb-1">White Space Strategy</h5>
                              <div className="bg-primary/5 border border-primary/20 p-3 rounded-md text-sm">
                                {concept.strategy.whiteSpaceStrategy}
                              </div>
                            </div>
                          )}

                          {concept.strategy.primaryDifferentiators && (
                            <div>
                              <h5 className="text-xs font-medium text-muted-foreground mb-1">Primary Differentiators</h5>
                              <ul className="list-disc list-inside text-sm space-y-1">
                                {Array.isArray(concept.strategy.primaryDifferentiators) 
                                  ? concept.strategy.primaryDifferentiators.map((diff: string, dIdx: number) => (
                                      <li key={dIdx}>{diff}</li>
                                    ))
                                  : <li>{concept.strategy.primaryDifferentiators}</li>
                                }
                              </ul>
                            </div>
                          )}

                          {concept.strategy.claimDraftingGuidance && (
                            <div>
                              <h5 className="text-xs font-medium text-muted-foreground mb-1">Key Concept Drafting Guidance</h5>
                              <p className="text-sm text-muted-foreground">{concept.strategy.claimDraftingGuidance}</p>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* User Notes */}
                      <div className="mt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <PencilLine className="h-4 w-4 text-muted-foreground" />
                          <label className="text-xs font-medium text-muted-foreground">
                            Your Additional Notes (Optional)
                          </label>
                        </div>
                        <Textarea
                          data-testid={`input-user-notes-${index}`}
                          placeholder="Add any additional strategic considerations, refinements, or implementation details..."
                          value={userNotes[index] || ""}
                          onChange={(e) => setUserNotes({ ...userNotes, [index]: e.target.value })}
                          className="min-h-20 text-sm"
                        />
                        <div className="flex items-center justify-between mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`button-save-notes-${index}`}
                            onClick={() => saveNoteMutation.mutate({ conceptIndex: index, note: userNotes[index] || "" })}
                            disabled={saveNoteMutation.isPending || userNotes[index] === (agent4Data?.data?.userNotes?.[index] || "")}
                          >
                            {saveNoteMutation.isPending ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              "Save Notes"
                            )}
                          </Button>
                          {userNotes[index] && userNotes[index] === (agent4Data?.data?.userNotes?.[index] || userNotes[index]) && (
                            <p className="text-xs text-green-600">Saved</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
                })
              ) : (
                /* Legacy Format: nuggetAnalyses */
                nuggetAnalyses.map((nugget: any, index: number) => (
                  <Card 
                    key={index} 
                    className="border-l-4"
                    style={{
                      borderLeftColor: nugget.riskLevel?.toLowerCase() === 'red' 
                        ? 'hsl(var(--destructive))' 
                        : nugget.riskLevel?.toLowerCase() === 'green'
                          ? 'hsl(var(--primary))'
                          : 'hsl(var(--warning))'
                    }}
                    data-testid={`nugget-analysis-${index}`}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <CardTitle className="text-lg">
                            Concept {index + 1}: {nugget.conceptTitle || nugget.nugget || nugget.concept || ''}
                          </CardTitle>
                        </div>
                        <Badge 
                          variant={getRiskBadgeVariant(nugget.riskLevel)}
                          className="flex items-center gap-1"
                          data-testid={`risk-badge-${index}`}
                        >
                          {getRiskIcon(nugget.riskLevel)}
                          {nugget.riskLevel || 'Unknown'} Risk
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h4 className="font-semibold text-sm mb-2 text-muted-foreground">Primary Prior Art</h4>
                        <p className="text-sm">{nugget.primaryPriorArt}</p>
                      </div>

                      <div>
                        <h4 className="font-semibold text-sm mb-2 text-muted-foreground">The Constraint</h4>
                        <div className="bg-muted p-3 rounded-md text-sm">
                          {nugget.constraint}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold text-sm mb-2 text-primary">White Space Strategy</h4>
                        <div className="bg-primary/5 border border-primary/20 p-3 rounded-md text-sm mb-3">
                          {nugget.whiteSpaceStrategy}
                        </div>
                        
                        <div className="mt-3">
                          <div className="flex items-center gap-2 mb-2">
                            <PencilLine className="h-4 w-4 text-muted-foreground" />
                            <label className="text-xs font-medium text-muted-foreground">
                              Your Additional Notes (Optional)
                            </label>
                          </div>
                          <Textarea
                            data-testid={`input-user-notes-${index}`}
                            placeholder="Add any additional strategic considerations, refinements, or implementation details..."
                            value={userNotes[index] || ""}
                            onChange={(e) => setUserNotes({ ...userNotes, [index]: e.target.value })}
                            className="min-h-20 text-sm"
                          />
                          <div className="flex items-center justify-between mt-2">
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid={`button-save-notes-${index}`}
                              onClick={() => saveNoteMutation.mutate({ conceptIndex: index, note: userNotes[index] || "" })}
                              disabled={saveNoteMutation.isPending || userNotes[index] === (agent4Data?.data?.userNotes?.[index] || "")}
                            >
                              {saveNoteMutation.isPending ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                "Save Notes"
                              )}
                            </Button>
                            {userNotes[index] && userNotes[index] === (agent4Data?.data?.userNotes?.[index] || userNotes[index]) && (
                              <p className="text-xs text-green-600">Saved</p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold text-sm mb-2 text-muted-foreground">Differentiation Logic</h4>
                        <p className="text-sm leading-relaxed">{nugget.differentiationLogic}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            {/* Generate Claims Button */}
            <div className="flex justify-center pt-8">
              <Button
                size="lg"
                data-testid="button-generate-claims"
                onClick={() => proceedToClaimsMutation.mutate()}
                disabled={proceedToClaimsMutation.isPending}
                className="px-12"
              >
                {proceedToClaimsMutation.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Generating Key Concept Ideas...
                  </>
                ) : (
                  "Generate Patent Key Concept Ideas"
                )}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { Loader2, Lightbulb, Sparkles, Edit, ChevronRight, RefreshCw } from "lucide-react";
import type { Project } from "@shared/schema";
import ReactMarkdown from "react-markdown";

interface Agent2Data {
  comprehensiveSummary?: {
    ideaSummary?: string;
    currentIdea?: string; // Refined idea from Mechanic
  };
  additionalNotes?: string;
  refinementFeedback?: string;
  provisionalDraft?: string;
  status?: string;
}

export default function Agent2a() {
  const [, params] = useRoute("/project/:id/agent/2a");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [refinementFeedback, setRefinementFeedback] = useState("");

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent2Data, isLoading: agent2Loading } = useQuery<{ data: Agent2Data }>({
    queryKey: ["/api/projects", projectId, "agent", 2],
    enabled: !!projectId,
  });

  // Redirect if user is not on the correct substage
  useEffect(() => {
    if (!project) return;
    
    // Block access if trying to skip ahead (stage < 2)
    // Allow backward navigation from later stages (stage > 2)
    if (project.currentStage < 2) {
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
      return;
    }
    
    // Only enforce substage validation if currently at stage 2
    // If beyond stage 2, allow viewing any substage (backward navigation)
    if (project.currentStage === 2) {
      // If currentSubstage is not set (shouldn't happen if Agent 1 was properly finalized)
      if (!project.currentSubstage) {
        toast({
          title: "Invalid state detected",
          description: "Please complete Agent 1 first.",
          // Softer UX - no red banner
        });
        setLocation(`/project/${projectId}/agent/1`);
        return;
      }
      
      // At stage 2: Allow viewing this substage if we're at or past it
      // Only redirect if trying to skip ahead
      const substageOrder = ['2a', '2b', '2c'];
      const currentIndex = substageOrder.indexOf(project.currentSubstage);
      const thisIndex = substageOrder.indexOf('2a');
      
      // Only redirect if trying to skip ahead (thisIndex > currentIndex)
      // Allow backward navigation (thisIndex <= currentIndex)
      if (thisIndex > currentIndex) {
        toast({
          title: `Complete earlier stages first`,
          description: `Please complete Module ${project.currentSubstage} first.`,
        });
        setLocation(`/project/${projectId}/agent/${project.currentSubstage}`);
      }
    }
  }, [project, projectId, setLocation, toast]);

  useEffect(() => {
    if (agent2Data?.data?.additionalNotes) {
      setAdditionalNotes(agent2Data.data.additionalNotes);
    }
    if (agent2Data?.data?.refinementFeedback) {
      setRefinementFeedback(agent2Data.data.refinementFeedback);
    }
  }, [agent2Data]);

  const saveMutation = useMutation({
    mutationFn: async (notes: string) => {
      await apiRequest("POST", `/api/projects/${projectId}/agent/2`, { additionalNotes: notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 2] });
    },
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      if (additionalNotes !== (agent2Data?.data?.additionalNotes || "")) {
        saveMutation.mutate(additionalNotes);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [additionalNotes]);

  const draftMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/projects/${projectId}/agent/2/draft`, { 
        additionalNotes,
        refinementFeedback: hasDraft ? refinementFeedback : ""
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 2] });
      toast({
        title: hasDraft ? "Concept refined with your feedback!" : "Concept expanded successfully!",
        description: "Review the detailed concept below.",
      });
      setRefinementFeedback("");
    },
    onError: (error: Error) => {
      toast({
        title: "Draft generation failed",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  const proceedTo2b = useMutation({
    mutationFn: async () => {
      // Trigger idea extraction which will automatically advance to 2b
      return await apiRequest("POST", `/api/projects/${projectId}/agent/2/extract-ideas`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 2] });
      await queryClient.refetchQueries({ queryKey: ["/api/projects", projectId] });
      
      toast({
        title: "Ideas extracted!",
        description: "Moving to idea selection.",
      });
      
      setLocation(`/project/${projectId}/agent/2b`);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to extract ideas",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  if (projectLoading || agent2Loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  // Use the refined current idea if available, otherwise fall back to original ideaSummary
  const currentIdea = agent2Data?.data?.comprehensiveSummary?.currentIdea 
    || agent2Data?.data?.comprehensiveSummary?.ideaSummary 
    || "No idea summary available";
  const originalIdea = agent2Data?.data?.comprehensiveSummary?.ideaSummary;
  const hasBeenRefined = !!agent2Data?.data?.comprehensiveSummary?.currentIdea && 
    agent2Data?.data?.comprehensiveSummary?.currentIdea !== originalIdea;
  const provisionalDraft = agent2Data?.data?.provisionalDraft || (agent2Data?.data as any)?.patentableIdeas;
  const hasDraft = !!provisionalDraft;

  return (
    <div className="h-full flex flex-col bg-background">
      <AgentHeader
        project={project}
        agentNumber={2}
        agentName="Concept Refinement - Expand Idea"
        agentDescription="Transform your brainstorming into a detailed technical concept"
      />

      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="space-y-8">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-primary" />
                  <CardTitle>Your Current Idea</CardTitle>
                </div>
                <CardDescription>
                  {hasBeenRefined 
                    ? "Refined through brainstorming and your modifications"
                    : "Refined through brainstorming with Advocate and Examiner agents"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-muted p-6 rounded-lg">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{currentIdea}</ReactMarkdown>
                  </div>
                </div>
              </CardContent>
            </Card>

            {!hasDraft && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Edit className="h-5 w-5 text-primary" />
                    <CardTitle>Add Missing Details (Optional)</CardTitle>
                  </div>
                  <CardDescription>
                    Include anything important that might have been missed in the brainstorming
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    data-testid="input-additional-notes"
                    placeholder="Example: The system also uses machine learning to adapt to individual user patterns over time..."
                    value={additionalNotes}
                    onChange={(e) => setAdditionalNotes(e.target.value)}
                    className="min-h-32"
                  />
                  <div className="flex items-center justify-between mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-save-details"
                      onClick={() => saveMutation.mutate(additionalNotes)}
                      disabled={saveMutation.isPending || !additionalNotes || additionalNotes === (agent2Data?.data?.additionalNotes || "")}
                    >
                      {saveMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save Details"
                      )}
                    </Button>
                    {saveMutation.isSuccess && !saveMutation.isPending && additionalNotes && (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        ✓ Saved
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {!hasDraft && (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center space-y-4">
                    <div className="flex justify-center">
                      <div className="rounded-full bg-primary/10 p-4">
                        <Sparkles className="h-8 w-8 text-primary" />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Ready to Expand Your Idea</h3>
                      <p className="text-sm text-muted-foreground mb-6">
                        AI will analyze your brainstorming and create a detailed technical concept description
                      </p>
                      <Button
                        size="lg"
                        data-testid="button-expand-idea"
                        onClick={() => draftMutation.mutate()}
                        disabled={draftMutation.isPending}
                      >
                        {draftMutation.isPending ? (
                          <>
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                            Expanding Concept...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-5 w-5 mr-2" />
                            Expand Idea
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {hasDraft && (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-primary" />
                          <CardTitle>Detailed Technical Concept</CardTitle>
                        </div>
                        <CardDescription className="mt-2">
                          AI-generated comprehensive description of your invention
                        </CardDescription>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => draftMutation.mutate()}
                        disabled={draftMutation.isPending}
                        data-testid="button-regenerate"
                      >
                        {draftMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Regenerating...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Re-generate
                          </>
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown>{provisionalDraft}</ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Edit className="h-5 w-5 text-primary" />
                      <CardTitle>Request Changes (Optional)</CardTitle>
                    </div>
                    <CardDescription>
                      Want to refine the concept? Describe what you'd like to change
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      data-testid="input-refinement-feedback"
                      placeholder=""
                      value={refinementFeedback}
                      onChange={(e) => setRefinementFeedback(e.target.value)}
                      className="min-h-24"
                    />
                    {refinementFeedback && (
                      <Button
                        className="mt-4"
                        onClick={() => draftMutation.mutate()}
                        disabled={draftMutation.isPending}
                        data-testid="button-refine"
                      >
                        {draftMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Refining...
                          </>
                        ) : (
                          "Regenerate with Feedback"
                        )}
                      </Button>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center space-y-4">
                      <div>
                        <h3 className="text-lg font-semibold mb-2">Ready to Extract Patentable Ideas?</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                          Continue to identify individual concepts that can be patented
                        </p>
                        <Button
                          size="lg"
                          data-testid="button-proceed-to-2b"
                          onClick={() => proceedTo2b.mutate()}
                          disabled={proceedTo2b.isPending}
                        >
                          {proceedTo2b.isPending ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <span>Continue to Extract Ideas</span>
                              <ChevronRight className="h-5 w-5 ml-2" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

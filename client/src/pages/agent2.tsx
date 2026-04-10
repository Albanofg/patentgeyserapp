import { useState, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { Loader2, Lightbulb, Sparkles, Edit, CheckCircle, XCircle, Plus, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Project } from "@shared/schema";
import ReactMarkdown from "react-markdown";

interface ExtractedIdea {
  id: string;
  title: string;
  description: string;
  selected?: boolean;
}

interface Agent2Data {
  comprehensiveSummary?: {
    ideaSummary?: string;
  };
  additionalNotes?: string;
  refinementFeedback?: string;
  provisionalDraft?: string; // Module 2a output
  extractedIdeas?: ExtractedIdea[]; // Module 2b output
  status?: 'pending_draft' | 'draft_complete' | 'ideas_pending' | 'ideas_extracted' | 'ideas_approved';
}

export default function Agent2() {
  const [, params] = useRoute("/project/:id/agent/2");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [refinementFeedback, setRefinementFeedback] = useState("");
  const [selectedIdeas, setSelectedIdeas] = useState<Set<string>>(new Set());

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent2Data, isLoading: agent2Loading } = useQuery<{ data: Agent2Data }>({
    queryKey: ["/api/projects", projectId, "agent", 2],
    enabled: !!projectId,
  });

  // Redirect to appropriate substage (this is a legacy page)
  useEffect(() => {
    if (!project || !projectId) return;
    
    // Only allow if currentStage is exactly 2
    if (project.currentStage !== 2) {
      const targetPage = project.currentStage === 2 && project.currentSubstage
        ? `/project/${projectId}/agent/${project.currentSubstage}`
        : project.currentStage
          ? `/project/${projectId}/agent/${project.currentStage}`
          : `/`;
      
      const destination = project.currentStage ? `Agent ${project.currentStage}` : 'Dashboard';
      toast({
        title: `Redirected to ${destination}`,
        description: `Please navigate through stages sequentially.`,
      });
      setLocation(targetPage);
      return;
    }
    
    // At stage 2: Silently redirect to current substage or default to 2a
    // (No toast needed - this is expected behavior when clicking "Agent 2" in sidebar)
    const targetSubstage = project.currentSubstage || '2a';
    setLocation(`/project/${projectId}/agent/${targetSubstage}`);
  }, [project, projectId, setLocation, toast]);

  // Load saved additional notes and refinement feedback
  useEffect(() => {
    if (agent2Data?.data?.additionalNotes) {
      setAdditionalNotes(agent2Data.data.additionalNotes);
    }
    if (agent2Data?.data?.refinementFeedback) {
      setRefinementFeedback(agent2Data.data.refinementFeedback);
    }
  }, [agent2Data]);

  // Auto-save additional notes
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

  // Module 2a: Generate/regenerate draft
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
        variant: "destructive",
      });
    },
  });

  // Module 2b: Extract patentable ideas
  const extractIdeasMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/projects/${projectId}/agent/2/extract-ideas`);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 2] });
      // Auto-select all ideas by default
      if (data.ideas && Array.isArray(data.ideas)) {
        setSelectedIdeas(new Set(data.ideas.map((idea: ExtractedIdea) => idea.id)));
      }
      toast({
        title: "Patentable ideas extracted!",
        description: "Review and select the ideas to move forward with.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Idea extraction failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Module 2c: Proceed to Prior Art Research
  // Memoize extractedIdeas to prevent infinite re-renders (MUST be before conditional returns)
  const extractedIdeas = useMemo(() => {
    return agent2Data?.data?.extractedIdeas || [];
  }, [agent2Data?.data?.extractedIdeas]);

  // Load selected ideas from saved data (MUST be before conditional returns)
  useEffect(() => {
    if (extractedIdeas.length > 0) {
      const savedSelections = extractedIdeas
        .filter((idea: ExtractedIdea) => idea.selected)
        .map((idea: ExtractedIdea) => idea.id);
      
      // Only default to "select all" if NO ideas have been marked as selected/unselected yet
      const hasAnySelectionData = extractedIdeas.some((idea: ExtractedIdea) => 
        idea.selected !== undefined
      );
      
      if (hasAnySelectionData) {
        // Restore saved selections
        setSelectedIdeas(new Set(savedSelections));
      } else {
        // First time: select all ideas by default
        setSelectedIdeas(new Set(extractedIdeas.map((idea: ExtractedIdea) => idea.id)));
      }
    } else {
      // No ideas extracted yet - clear selections
      setSelectedIdeas(new Set());
    }
  }, [extractedIdeas]);

  const proceedMutation = useMutation({
    mutationFn: async () => {
      const selectedIdeasArray = Array.from(selectedIdeas);
      if (selectedIdeasArray.length === 0) {
        throw new Error("Please select at least one idea to proceed.");
      }
      return await apiRequest("POST", `/api/projects/${projectId}/agent/2/proceed`, {
        selectedIdeaIds: selectedIdeasArray,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({
        title: "Moving to Prior Art Research!",
        description: "Your selected ideas will be analyzed for prior art.",
      });
      // Navigate to Agent 3
      window.location.href = `/project/${projectId}/agent/3`;
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to proceed",
        description: error.message,
        variant: "destructive",
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

  const ideaSummary = agent2Data?.data?.comprehensiveSummary?.ideaSummary || "No idea summary available";
  // Support both old (patentableIdeas) and new (provisionalDraft) field names for backward compatibility
  const provisionalDraft = agent2Data?.data?.provisionalDraft || (agent2Data?.data as any)?.patentableIdeas;
  const status = agent2Data?.data?.status || 'pending_draft';
  
  // Determine what to show based on data presence (backward compatible with old status values)
  const hasDraft = !!provisionalDraft;
  const hasExtractedIdeas = extractedIdeas.length > 0;
  
  // Show sections based on data state
  const showDraftButton = !hasDraft; // Show if no draft yet
  const showDraft = hasDraft; // Show if draft exists
  const showExtractIdeasButton = hasDraft && !hasExtractedIdeas; // Show if draft exists but no ideas extracted yet
  const showExtractedIdeas = hasExtractedIdeas; // Show if ideas have been extracted
  
  // Handlers for idea selection
  const toggleIdeaSelection = (ideaId: string) => {
    setSelectedIdeas(prev => {
      const newSet = new Set(prev);
      if (newSet.has(ideaId)) {
        newSet.delete(ideaId);
      } else {
        newSet.add(ideaId);
      }
      return newSet;
    });
  };
  
  const selectAllIdeas = () => {
    setSelectedIdeas(new Set(extractedIdeas.map((idea: ExtractedIdea) => idea.id)));
  };
  
  const deselectAllIdeas = () => {
    setSelectedIdeas(new Set());
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <AgentHeader
        project={project}
        agentNumber={2}
        agentName="Concept Refinement"
        agentDescription="Expand and refine your invention concept"
      />

      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="space-y-8">
            {/* Main Idea Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-primary" />
                  <CardTitle>Your Main Idea</CardTitle>
                </div>
                <CardDescription>
                  Refined through brainstorming with Advocate and Examiner agents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-muted p-6 rounded-lg">
                  <p className="text-base leading-relaxed">{ideaSummary}</p>
                </div>
              </CardContent>
            </Card>

            {/* Additional Notes Section - Only show before draft */}
            {showDraftButton && (
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
                  {saveMutation.isPending && (
                    <p className="text-xs text-muted-foreground flex items-center gap-2 mt-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Auto-saving...
                    </p>
                  )}
                  {saveMutation.isSuccess && !saveMutation.isPending && additionalNotes && (
                    <p className="text-xs text-green-600 mt-2">
                      ✓ Saved
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Module 2a: Expand Idea Button */}
            {showDraftButton && (
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
                        data-testid="button-draft"
                        onClick={() => draftMutation.mutate()}
                        disabled={draftMutation.isPending}
                      >
                        {draftMutation.isPending ? (
                          <>
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                            Expanding Idea...
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

            {/* Module 2a: Detailed Concept */}
            {showDraft && (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-primary" />
                          <CardTitle>Detailed Technical Concept</CardTitle>
                        </div>
                        <CardDescription>
                          Expanded description of your invention
                        </CardDescription>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRefinementFeedback("");
                          draftMutation.mutate();
                        }}
                        disabled={draftMutation.isPending}
                        data-testid="button-redraft"
                      >
                        {draftMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Regenerating...
                          </>
                        ) : (
                          "Re-generate"
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-muted p-6 rounded-lg prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{provisionalDraft}</ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>

                {/* Refinement Section */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Edit className="h-5 w-5 text-primary" />
                      <CardTitle>Refine Concept</CardTitle>
                    </div>
                    <CardDescription>
                      Request changes or additions to improve the concept description
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea
                      data-testid="input-refinement-feedback"
                      placeholder=""
                      value={refinementFeedback}
                      onChange={(e) => setRefinementFeedback(e.target.value)}
                      className="min-h-32"
                    />
                    <Button
                      size="lg"
                      data-testid="button-regenerate"
                      onClick={() => draftMutation.mutate()}
                      disabled={draftMutation.isPending || !refinementFeedback.trim()}
                    >
                      {draftMutation.isPending ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          Regenerating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-5 w-5 mr-2" />
                          Regenerate with Feedback
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {/* Module 2b: Extract Ideas Button */}
                {showExtractIdeasButton && (
                  <Card>
                  <CardContent className="pt-6">
                    <div className="text-center space-y-4">
                      <div className="flex justify-center">
                        <div className="rounded-full bg-primary/10 p-4">
                          <Lightbulb className="h-8 w-8 text-primary" />
                        </div>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold mb-2">Extract Patentable Ideas</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                          AI will identify the key patentable ideas from your provisional draft
                        </p>
                        <Button
                          size="lg"
                          data-testid="button-extract-ideas"
                          onClick={() => extractIdeasMutation.mutate()}
                          disabled={extractIdeasMutation.isPending}
                        >
                          {extractIdeasMutation.isPending ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Extracting Ideas...
                            </>
                          ) : (
                            <>
                              <Lightbulb className="h-5 w-5 mr-2" />
                              Extract Patentable Ideas
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                )}
              </>
            )}

            {/* Module 2b: Display Extracted Ideas */}
            {showExtractedIdeas && (
              <>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold">Patentable Ideas</h2>
                    <div className="flex items-center gap-4">
                      <p className="text-sm text-muted-foreground">
                        {selectedIdeas.size} of {extractedIdeas.length} selected
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => extractIdeasMutation.mutate()}
                          disabled={extractIdeasMutation.isPending}
                          data-testid="button-re-extract-ideas"
                        >
                          {extractIdeasMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Re-extracting...
                            </>
                          ) : (
                            "Re-extract Ideas"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={selectAllIdeas}
                          data-testid="button-select-all"
                        >
                          Select All
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={deselectAllIdeas}
                          data-testid="button-deselect-all"
                        >
                          Deselect All
                        </Button>
                      </div>
                    </div>
                  </div>

                  {extractedIdeas.map((idea) => (
                    <Card 
                      key={idea.id} 
                      className={selectedIdeas.has(idea.id) ? "border-primary" : ""}
                    >
                      <CardHeader>
                        <div className="flex items-start gap-4">
                          <Checkbox
                            checked={selectedIdeas.has(idea.id)}
                            onCheckedChange={() => toggleIdeaSelection(idea.id)}
                            data-testid={`checkbox-idea-${idea.id}`}
                            className="mt-1"
                          />
                          <div className="flex-1">
                            <CardTitle className="text-lg">{idea.title}</CardTitle>
                            {idea.description && (
                              <CardDescription className="mt-2 whitespace-pre-wrap">
                                {idea.description}
                              </CardDescription>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>

                {/* Proceed Button */}
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center space-y-4">
                      <div>
                        <h3 className="text-lg font-semibold mb-2">Ready for Prior Art Research?</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                          {selectedIdeas.size === 0 
                            ? "Select at least one idea to proceed" 
                            : `${selectedIdeas.size} idea${selectedIdeas.size > 1 ? 's' : ''} will be analyzed for prior art`
                          }
                        </p>
                        <Button 
                          size="lg" 
                          data-testid="button-proceed"
                          onClick={() => proceedMutation.mutate()}
                          disabled={selectedIdeas.size === 0 || proceedMutation.isPending}
                        >
                          {proceedMutation.isPending ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <span>Proceed to Prior Art Research</span>
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

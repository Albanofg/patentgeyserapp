import { useState, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { Loader2, Lightbulb, CheckCircle, XCircle, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Project } from "@shared/schema";
import { usePageSnapshot, type PageSnapshot } from "@/lib/page-snapshot";
import { SiblingsReferencePanel } from "@/components/siblings-reference-panel";

interface ExtractedIdea {
  id: string;
  title: string;
  description: string;
  selected?: boolean;
}

interface Agent2Data {
  extractedIdeas?: ExtractedIdea[];
  status?: string;
}

export default function Agent2c() {
  const [, params] = useRoute("/project/:id/agent/2c");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;
  const [selectedIdeas, setSelectedIdeas] = useState<Set<string>>(new Set());

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
      // If currentSubstage is not set, redirect to 2a
      if (!project.currentSubstage) {
        toast({
          title: "Invalid state detected",
          description: "Please complete Agent 1 first.",
          variant: "destructive",
        });
        setLocation(`/project/${projectId}/agent/1`);
        return;
      }
      
      // At stage 2: Allow viewing this substage if we're at or past it
      // Only redirect if trying to skip ahead
      const substageOrder = ['2a', '2b', '2c'];
      const currentIndex = substageOrder.indexOf(project.currentSubstage);
      const thisIndex = substageOrder.indexOf('2c');
      
      // Only redirect if trying to skip ahead (thisIndex > currentIndex)
      // Allow backward navigation (thisIndex <= currentIndex)
      if (thisIndex > currentIndex) {
        toast({
          title: `Complete earlier stages first`,
          description: `Please complete Module 2b (Extract Ideas) first.`,
        });
        const redirectSubstage = project.currentSubstage || '2a';
        setLocation(`/project/${projectId}/agent/${redirectSubstage}`);
      }
    }
  }, [project, projectId, setLocation, toast]);

  const extractedIdeas = useMemo(() => {
    return agent2Data?.data?.extractedIdeas || [];
  }, [agent2Data?.data?.extractedIdeas]);

  useEffect(() => {
    if (extractedIdeas.length > 0) {
      const savedSelections = extractedIdeas
        .filter((idea: ExtractedIdea) => idea.selected)
        .map((idea: ExtractedIdea) => idea.id);
      
      const hasAnySelectionData = extractedIdeas.some((idea: ExtractedIdea) => 
        idea.selected !== undefined
      );
      
      if (hasAnySelectionData) {
        setSelectedIdeas(new Set(savedSelections));
      } else {
        setSelectedIdeas(new Set(extractedIdeas.map((idea: ExtractedIdea) => idea.id)));
      }
    } else {
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
    onSuccess: async () => {
      // Wait for project data to refetch before navigating
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      await queryClient.refetchQueries({ queryKey: ["/api/projects", projectId] });
      
      toast({
        title: "Moving to Prior Art Research!",
        description: "Your selected ideas will be analyzed for prior art.",
      });
      setLocation(`/project/${projectId}/agent/3`);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to proceed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

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

  // ── Page snapshot for the AI Helper ─────────────────────────────────────
  // 2c is a select-extracted-ideas page (read-only items, checkbox state).
  const snapshot = useMemo<PageSnapshot>(() => ({
    // Prompt-phase mapping: PHASE_3_EXTRACT_AND_SELECT_IDEAS — same as 2b,
    // selecting which concepts to research for prior art.
    phase: 3,
    pageName: "Select Patentable Ideas (Stage 2c)",
    route: `/project/${projectId}/agent/2c`,
    description:
      "User reviews extracted patentable ideas and selects which to research for prior art. Items are read-only; only selection state changes.",
    items: extractedIdeas.map((idea: ExtractedIdea, i: number) => ({
      id: `extracted_idea_${i + 1}`,
      type: "extracted_idea",
      status: selectedIdeas.has(idea.id) ? "selected" : "deselected",
      editable: false,
      content: { ideaId: idea.id, title: idea.title, description: idea.description },
    })),
    drafts: {},
    actions: extractedIdeas.length === 0
      ? []
      : [
          {
            id: "select-all",
            label: "Select All",
            kind: "secondary",
            enabled: selectedIdeas.size < extractedIdeas.length,
          },
          {
            id: "deselect-all",
            label: "Deselect All",
            kind: "secondary",
            enabled: selectedIdeas.size > 0,
          },
          {
            id: "proceed-to-prior-art",
            label: "Proceed to Prior Art Research",
            kind: "primary",
            enabled: !proceedMutation.isPending && selectedIdeas.size > 0,
            reason: selectedIdeas.size === 0 ? "No ideas selected" : undefined,
            navigatesTo: `/project/${projectId}/agent/3`,
          },
        ],
    source: "structured",
  }), [extractedIdeas, selectedIdeas, proceedMutation.isPending, projectId]);
  usePageSnapshot(snapshot);

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

  return (
    <div className="h-full flex flex-col bg-background">
      <AgentHeader
        project={project}
        agentNumber={2}
        agentName="Concept Refinement - Select Ideas"
        agentDescription="Choose which ideas to research for prior art"
      />

      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="space-y-8">
            {projectId && <SiblingsReferencePanel projectId={projectId} />}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Select Concepts for Prior Art Research</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedIdeas.size} of {extractedIdeas.length} selected
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={selectAllIdeas}
                  data-testid="button-select-all"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Select All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={deselectAllIdeas}
                  data-testid="button-deselect-all"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Deselect All
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {extractedIdeas.map((idea) => {
                const isSelected = selectedIdeas.has(idea.id);
                return (
                  <Card
                    key={idea.id}
                    className={`cursor-pointer transition-all ${
                      isSelected ? 'ring-2 ring-primary' : ''
                    }`}
                    onClick={() => toggleIdeaSelection(idea.id)}
                    data-testid={`idea-card-${idea.id}`}
                  >
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleIdeaSelection(idea.id)}
                          className="mt-1"
                          data-testid={`checkbox-${idea.id}`}
                        />
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <Lightbulb className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1">
                          <CardTitle className="text-lg">{idea.title}</CardTitle>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground leading-relaxed ml-11">
                        {idea.description}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card>
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Ready for Prior Art Research?</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      Selected ideas will be searched against patent databases and publications
                    </p>
                    <Button
                      size="lg"
                      data-testid="button-proceed-to-agent3"
                      onClick={() => proceedMutation.mutate()}
                      disabled={proceedMutation.isPending || selectedIdeas.size === 0}
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
                    {selectedIdeas.size === 0 && (
                      <p className="text-xs text-destructive mt-2">
                        Please select at least one idea to continue
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

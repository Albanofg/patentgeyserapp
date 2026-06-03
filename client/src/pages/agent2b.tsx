import { useState, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { Loader2, Lightbulb, Plus, ChevronRight, ChevronDown, ChevronUp, RefreshCw, CheckCircle, XCircle, Undo2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePageSnapshot, type PageSnapshot } from "@/lib/page-snapshot";
import { SiblingsReferencePanel } from "@/components/siblings-reference-panel";
import { Label } from "@/components/ui/label";
import type { Project } from "@shared/schema";
import { recordHumanInput } from "@/lib/human-inputs";

interface ExtractedIdea {
  id: string;
  text: string;
  selected?: boolean;
  // Legacy support for old data format
  title?: string;
  description?: string;
  // True when this idea was originally rejected by the refiner and the
  // inventor restored it via the filtered-out tray. Reserved for future
  // styling — not currently used to change the card's appearance.
  restoredFromFilter?: boolean;
}

interface FilteredIdea {
  id: string;
  text: string;
}

interface Agent2Data {
  provisionalDraft?: string;
  extractedIdeas?: ExtractedIdea[];
  // Concepts produced by the extractor but rejected by the refiner. Surfaced
  // in a collapsible "removed during refinement" tray below the surviving
  // list so the inventor can restore any item they disagree with.
  filteredIdeas?: FilteredIdea[];
  status?: string;
}

export default function Agent2b() {
  const [, params] = useRoute("/project/:id/agent/2b");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;
  const [selectedIdeas, setSelectedIdeas] = useState<Set<string>>(new Set());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [customIdeaText, setCustomIdeaText] = useState("");
  // Whether the "removed during refinement" tray is expanded. Collapsed by
  // default so it doesn't compete with the primary surviving-concepts list.
  const [showFilteredTray, setShowFilteredTray] = useState(false);

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
          // Softer UX - no red banner
        });
        setLocation(`/project/${projectId}/agent/1`);
        return;
      }
      
      // At stage 2: Allow viewing this substage if we're at or past it
      // Only redirect if trying to skip ahead
      const substageOrder = ['2a', '2b'];
      const currentIndex = substageOrder.indexOf(project.currentSubstage);
      const thisIndex = substageOrder.indexOf('2b');
      
      // Only redirect if trying to skip ahead (thisIndex > currentIndex)
      // Allow backward navigation (thisIndex <= currentIndex)
      if (thisIndex > currentIndex) {
        toast({
          title: `Complete earlier stages first`,
          description: `Please complete Module 2a (Expand Concept) first.`,
        });
        setLocation(`/project/${projectId}/agent/2a`);
      }
    }
  }, [project, projectId, setLocation, toast]);

  const extractedIdeas = useMemo(() => {
    return agent2Data?.data?.extractedIdeas || [];
  }, [agent2Data?.data?.extractedIdeas]);

  const filteredIdeas = useMemo<FilteredIdea[]>(() => {
    return agent2Data?.data?.filteredIdeas || [];
  }, [agent2Data?.data?.filteredIdeas]);

  // Initialize selections from saved data
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
        // Only auto-select all if we don't have existing selections in state
        // This prevents wiping selections when adding custom ideas
        setSelectedIdeas(prev => {
          // If we already have selections, preserve them
          if (prev.size > 0) {
            return prev;
          }
          // Otherwise, select all ideas on first load
          return new Set(extractedIdeas.map((idea: ExtractedIdea) => idea.id));
        });
      }
    } else {
      setSelectedIdeas(new Set());
    }
  }, [extractedIdeas]);

  const extractIdeasMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/projects/${projectId}/agent/2/extract-ideas`);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 2] });
      
      const ideasCount = data?.ideas?.length || 0;
      if (ideasCount === 0) {
        toast({
          title: "No ideas extracted",
          description: "The AI couldn't identify patentable ideas. Try re-extracting or contact support.",
          // Softer UX - no red banner
        });
      } else {
        toast({
          title: "Patentable ideas extracted!",
          description: `${ideasCount} ${ideasCount === 1 ? 'idea' : 'ideas'} identified. Review and select ideas to research for prior art.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Idea extraction failed",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

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
        // Softer UX - no red banner
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

  const addCustomIdeaMutation = useMutation({
    mutationFn: async () => {
      if (!customIdeaText.trim()) {
        throw new Error("Please enter the idea text.");
      }
      return await apiRequest("POST", `/api/projects/${projectId}/agent/2/add-custom-idea`, {
        text: customIdeaText.trim(),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 2] });
      toast({
        title: "Idea added!",
        description: "Your idea has been added to the list.",
      });
      // Ledger: capture the user-typed custom idea so it's traceable as
      // proof-of-conception material.
      void recordHumanInput({
        projectId,
        source: "module2/custom-idea",
        sourceRefId: data?.idea?.id ?? null,
        promptText: "User-added custom idea (post-extraction)",
        answerText: customIdeaText.trim(),
        tags: ["conception_mechanism", "implementation_detail"],
      });
      setCustomIdeaText("");
      setIsDialogOpen(false);

      // Auto-select the newly added idea
      if (data?.idea?.id) {
        setSelectedIdeas(prev => new Set(prev).add(data.idea.id));
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add idea",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  // Restore an idea that was originally rejected by the refiner. Moves the
  // item from `filteredIdeas` back to `extractedIdeas` on the server, then
  // refetches so the surviving list re-renders with the restored item. Also
  // writes to the human-input ledger — the inventor explicitly disagreeing
  // with the refiner is strong proof-of-conception material.
  const restoreFilteredMutation = useMutation({
    mutationFn: async (filteredId: string) => {
      return await apiRequest("POST", `/api/projects/${projectId}/agent/2/restore-filtered-idea`, {
        id: filteredId,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 2] });
      toast({
        title: "Idea restored",
        description: "Added back to your patentable concepts.",
      });
      if (data?.idea?.id && data?.idea?.text) {
        // Ledger: the inventor explicitly chose to override the refiner's
        // rejection. Tag as conception-relevant so it shows up correctly in
        // downstream proof-of-conception flows.
        void recordHumanInput({
          projectId,
          source: "module2/restored-filtered-idea",
          sourceRefId: data.idea.id,
          promptText: "Inventor restored a concept that was filtered out during refinement",
          answerText: data.idea.text,
          tags: ["conception_mechanism", "implementation_detail"],
        });
        // Auto-select the restored idea so it's included by default when
        // proceeding to prior art.
        setSelectedIdeas((prev) => new Set(prev).add(data.idea.id));
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to restore idea",
        description: error.message,
      });
    },
  });

  // ── Page snapshot for the AI Helper ─────────────────────────────────────
  // Stage 2b shows extracted patentable ideas with selection checkboxes.
  // Items are read-only (ideas can't be edited inline here — only added
  // anew via the Custom Idea dialog or re-extracted). The custom-idea
  // textarea inside the dialog is the only editable surface.
  const snapshotItems: NonNullable<PageSnapshot["items"]> = extractedIdeas.map((idea: ExtractedIdea, i: number) => ({
    id: `extracted_idea_${i + 1}`,
    type: "extracted_idea",
    status: selectedIdeas.has(idea.id) ? "selected" : "deselected",
    editable: false,
    // Mirror the same fallback chain the page renders so the helper sees
    // the actual idea text — current data shape uses `text`, legacy rows
    // used `title` + `description`.
    content: {
      ideaId: idea.id,
      text: (idea as any).text || idea.title || idea.description || "",
      title: idea.title,
      description: idea.description,
    },
  }));
  if (isDialogOpen) {
    snapshotItems.push({
      id: "custom_idea_field",
      type: "custom_idea_field",
      status: customIdeaText.trim() ? "drafted" : "empty",
      editable: true,
      editTarget: "custom-idea-text",
      content: { currentValue: customIdeaText },
    });
  }
  const snapshotDrafts: Record<string, string> = isDialogOpen && customIdeaText
    ? { "custom-idea-text": customIdeaText }
    : {};

  const snapshotActions: NonNullable<PageSnapshot["actions"]> = [];
  if (extractedIdeas.length === 0) {
    snapshotActions.push({
      id: "extract-ideas",
      label: "Extract Patentable Ideas",
      kind: "primary",
      enabled: !extractIdeasMutation.isPending,
    });
  } else {
    snapshotActions.push({
      id: "select-all",
      label: "Select All",
      kind: "secondary",
      enabled: selectedIdeas.size < extractedIdeas.length,
    });
    snapshotActions.push({
      id: "deselect-all",
      label: "Deselect All",
      kind: "secondary",
      enabled: selectedIdeas.size > 0,
    });
    snapshotActions.push({
      id: "re-extract",
      label: "Re-extract Ideas",
      kind: "secondary",
      enabled: !extractIdeasMutation.isPending,
    });
    snapshotActions.push({
      id: "open-add-custom-idea",
      label: "Add Custom Idea",
      kind: "secondary",
      enabled: true,
    });
    if (isDialogOpen) {
      snapshotActions.push({
        id: "save-custom-idea",
        label: "Save Custom Idea",
        kind: "primary",
        enabled: !addCustomIdeaMutation.isPending && customIdeaText.trim().length > 0,
        reason: !customIdeaText.trim() ? "Custom-idea field is empty" : undefined,
      });
      snapshotActions.push({
        id: "cancel-custom-idea",
        label: "Cancel",
        kind: "secondary",
        enabled: true,
      });
    }
    snapshotActions.push({
      id: "proceed-to-prior-art",
      label: "Proceed to Prior Art Research",
      kind: "primary",
      enabled: !proceedMutation.isPending && selectedIdeas.size > 0,
      reason: selectedIdeas.size === 0 ? "No ideas selected" : undefined,
      navigatesTo: `/project/${projectId}/agent/3`,
    });
  }

  usePageSnapshot({
    // Prompt-phase mapping: PHASE_3_EXTRACT_AND_SELECT_IDEAS — selecting
    // which concepts to research for prior art is the canonical phase-3
    // activity in the prompt.
    phase: 3,
    pageName: "Select Patentable Ideas (Stage 2b)",
    route: `/project/${projectId}/agent/2b`,
    description:
      "User reviews extracted patentable ideas and selects which ones to research for prior art in stage 3. Ideas are not inline-editable; the only editable surface is the custom-idea textarea inside the add-idea dialog.",
    items: snapshotItems,
    drafts: snapshotDrafts,
    actions: snapshotActions,
    source: "structured",
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

  const hasExtractedIdeas = extractedIdeas.length > 0;

  return (
    <div className="h-full flex flex-col bg-background">
      <AgentHeader
        project={project}
        agentNumber={2}
        agentName="Concept Refinement - Extract & Select Ideas"
        agentDescription="Identify and select individual patentable concepts from your invention"
      />

      <main className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="space-y-8">
            {projectId && <SiblingsReferencePanel projectId={projectId} />}
            {!hasExtractedIdeas && (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center space-y-4">
                    <div className="flex justify-center">
                      <div className="rounded-full bg-primary/10 p-4">
                        <Plus className="h-8 w-8 text-primary" />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Extract Patentable Ideas</h3>
                      <p className="text-sm text-muted-foreground mb-6">
                        AI will analyze your detailed concept and identify individual patentable ideas
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
                            <Plus className="h-5 w-5 mr-2" />
                            Extract Ideas
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {hasExtractedIdeas && (
              <>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h2 className="text-2xl font-bold">Select Concepts for Prior Art Research</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedIdeas.size} of {extractedIdeas.length} selected
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => setIsDialogOpen(true)}
                      data-testid="button-add-custom-idea"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add an Idea
                    </Button>
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => extractIdeasMutation.mutate()}
                      disabled={extractIdeasMutation.isPending}
                      data-testid="button-re-extract"
                    >
                      {extractIdeasMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Re-extracting...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Re-extract Ideas
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  {extractedIdeas.map((idea) => {
                    const isSelected = selectedIdeas.has(idea.id);
                    return (
                      <Card
                        key={idea.id}
                        className={`cursor-pointer transition-all hover-elevate ${
                          isSelected ? 'ring-2 ring-primary' : ''
                        }`}
                        onClick={() => toggleIdeaSelection(idea.id)}
                        data-testid={`idea-card-${idea.id}`}
                      >
                        <CardHeader>
                          <div className="flex items-start gap-3">
                            <div onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleIdeaSelection(idea.id)}
                                className="mt-1"
                                data-testid={`checkbox-${idea.id}`}
                              />
                            </div>
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                              <Lightbulb className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm leading-relaxed">
                                {idea.text || idea.title || idea.description}
                              </p>
                            </div>
                          </div>
                        </CardHeader>
                      </Card>
                    );
                  })}
                </div>

                {/*
                  Removed-during-refinement tray. The refiner culls 85–95% of
                  extractor candidates by design — historically those dropped
                  items disappeared silently and the inventor had no way to
                  recover one if they disagreed with the rejection. The tray
                  surfaces the dropped list and lets the inventor restore any
                  item with a single click. Collapsed by default to keep the
                  primary surviving-concepts list visually dominant; the
                  header line shows the count so the inventor knows the
                  option is there.
                */}
                {filteredIdeas.length > 0 && (
                  <Card data-testid="filtered-ideas-tray">
                    <CardHeader
                      className="cursor-pointer hover-elevate py-3"
                      onClick={() => setShowFilteredTray((v) => !v)}
                      data-testid="filtered-ideas-toggle"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                            <XCircle className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-tight">
                              {filteredIdeas.length} candidate{filteredIdeas.length === 1 ? "" : "s"} filtered out during refinement
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Reviewed as too generic, redundant, or derivative. Restore any you want to keep.
                            </p>
                          </div>
                        </div>
                        {showFilteredTray
                          ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        }
                      </div>
                    </CardHeader>
                    {showFilteredTray && (
                      <CardContent className="pt-0 pb-4">
                        <div className="space-y-2">
                          {filteredIdeas.map((idea) => (
                            <div
                              key={idea.id}
                              className="flex items-start gap-3 rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                              data-testid={`filtered-idea-${idea.id}`}
                            >
                              <p className="flex-1 text-sm text-muted-foreground leading-relaxed">
                                {idea.text}
                              </p>
                              <Button
                                size="sm"
                                variant="outline"
                                className="shrink-0 h-7"
                                onClick={() => restoreFilteredMutation.mutate(idea.id)}
                                disabled={restoreFilteredMutation.isPending}
                                data-testid={`button-restore-${idea.id}`}
                              >
                                {restoreFilteredMutation.isPending && restoreFilteredMutation.variables === idea.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                                    Restore
                                  </>
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                )}

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
              </>
            )}
          </div>
        </div>
      </main>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an Idea</DialogTitle>
            <DialogDescription>
              Add a patentable idea that the AI might have missed
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="custom-idea-text">Idea</Label>
              <Textarea
                id="custom-idea-text"
                data-testid="input-custom-idea-text"
                placeholder=""
                value={customIdeaText}
                onChange={(e) => setCustomIdeaText(e.target.value)}
                className="min-h-32"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              data-testid="button-cancel-custom-idea"
            >
              Cancel
            </Button>
            <Button
              onClick={() => addCustomIdeaMutation.mutate()}
              disabled={addCustomIdeaMutation.isPending || !customIdeaText.trim()}
              data-testid="button-save-custom-idea"
            >
              {addCustomIdeaMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Idea"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

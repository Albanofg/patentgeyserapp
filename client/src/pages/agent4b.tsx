import { useState, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { Loader2, FileText, Check, CheckCircle2, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import type { Project } from "@shared/schema";
import { usePageSnapshot, type PageSnapshot } from "@/lib/page-snapshot";
import { SiblingsReferencePanel } from "@/components/siblings-reference-panel";
import { SiblingOverlapWarning, type OverlapCandidate } from "@/components/sibling-overlap-warning";

type KeyConceptItem = {
  id: string;
  variationId: string;
  text: string;
  number: number;
  // 'independent' | 'dependent' — used to badge each key concept in the list.
  type?: string;
};

export default function Agent4b() {
  const [, params] = useRoute("/project/:id/agent/4b");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;

  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(new Set());
  const [expandedVariations, setExpandedVariations] = useState<Set<string>>(new Set());

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent4Data, isLoading: agent4Loading } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "agent", 4],
    enabled: !!projectId,
  });

  // Navigation guard: Block skipping ahead, allow backward navigation
  useEffect(() => {
    if (!project) return;
    
    const currentStage = project.currentStage;
    const currentSubstage = project.currentSubstage;
    
    // Block if trying to skip ahead
    if (currentStage < 4 || (currentStage === 4 && currentSubstage === '4a')) {
      const targetPage = currentStage === 4 && currentSubstage === '4a'
        ? `/project/${projectId}/agent/4a`
        : currentStage === 2 && currentSubstage
          ? `/project/${projectId}/agent/${currentSubstage}`
          : currentStage
            ? `/project/${projectId}/agent/${currentStage}`
            : `/`;
      
      toast({
        title: "Complete previous stages first",
        description: "Please generate key concepts from the white space analysis first.",
      });
      setLocation(targetPage);
    }
  }, [project, projectId, setLocation, toast]);

  // Load existing selections
  useEffect(() => {
    const agent4DataObj = agent4Data?.data as any;
    if (agent4DataObj?.selectedKeyConcepts && Array.isArray(agent4DataObj.selectedKeyConcepts)) {
      const selectedIds = new Set<string>(agent4DataObj.selectedKeyConcepts.map((c: KeyConceptItem) => c.id));
      setSelectedClaimIds(selectedIds);
    }
    
    // Auto-expand first variation
    if (agent4DataObj?.claimVariations?.length > 0) {
      setExpandedVariations(new Set<string>([agent4DataObj.claimVariations[0].id]));
    }
  }, [agent4Data]);

  // Build flat list of all key concepts from all variations
  const buildConceptsList = (): KeyConceptItem[] => {
    const agent4DataObj = agent4Data?.data as any;
    const variations = agent4DataObj?.claimVariations || [];

    const conceptItems: KeyConceptItem[] = [];

    variations.forEach((variation: any) => {
      if (variation.claims && Array.isArray(variation.claims) && variation.claims.length > 0) {
        const sortedClaims = [...variation.claims].sort((a: any, b: any) =>
          (a.number || 0) - (b.number || 0)
        );

        sortedClaims.forEach((claim: any) => {
          conceptItems.push({
            id: `${variation.id}-concept-${claim.number}`,
            variationId: variation.id,
            text: claim.text,
            number: claim.number,
          });
        });
      } else {
        // Fallback: combine independent + dependent claims as a flat list
        let conceptNumber = 1;

        if (variation.independentClaim) {
          conceptItems.push({
            id: `${variation.id}-concept-${conceptNumber}`,
            variationId: variation.id,
            text: variation.independentClaim,
            number: conceptNumber++,
          });
        }

        if (variation.dependentClaims && Array.isArray(variation.dependentClaims)) {
          variation.dependentClaims.forEach((text: string) => {
            conceptItems.push({
              id: `${variation.id}-concept-${conceptNumber}`,
              variationId: variation.id,
              text,
              number: conceptNumber++,
            });
          });
        }
      }
    });

    return conceptItems;
  };

  const allConcepts = buildConceptsList();

  const toggleClaim = (claimId: string) => {
    const newSelection = new Set(selectedClaimIds);
    if (newSelection.has(claimId)) {
      newSelection.delete(claimId);
    } else {
      newSelection.add(claimId);
    }
    setSelectedClaimIds(newSelection);
  };

  const toggleVariation = (variationId: string) => {
    const newExpanded = new Set(expandedVariations);
    if (newExpanded.has(variationId)) {
      newExpanded.delete(variationId);
    } else {
      newExpanded.add(variationId);
    }
    setExpandedVariations(newExpanded);
  };

  const selectAllFromVariation = (variationId: string) => {
    const variationClaims = allConcepts.filter(c => c.variationId === variationId);
    const newSelection = new Set(selectedClaimIds);
    variationClaims.forEach(c => newSelection.add(c.id));
    setSelectedClaimIds(newSelection);
  };

  const deselectAllFromVariation = (variationId: string) => {
    const variationClaims = allConcepts.filter(c => c.variationId === variationId);
    const newSelection = new Set(selectedClaimIds);
    variationClaims.forEach(c => newSelection.delete(c.id));
    setSelectedClaimIds(newSelection);
  };

  const saveSelectionMutation = useMutation({
    mutationFn: async () => {
      const selectedKeyConcepts = allConcepts.filter(c => selectedClaimIds.has(c.id));
      await apiRequest("POST", `/api/projects/${projectId}/agent/4b/select-concepts`, {
        selectedKeyConcepts,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 4] });
      toast({
        title: "Key concept ideas saved!",
        description: `${selectedClaimIds.size} key concept ideas selected.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Save failed",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  const proceedMutation = useMutation({
    mutationFn: async () => {
      // Save selections only - Pannu validation happens next
      const selectedKeyConcepts = allConcepts.filter(c => selectedClaimIds.has(c.id));
      await apiRequest("POST", `/api/projects/${projectId}/agent/4b/select-concepts`, {
        selectedKeyConcepts,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({
        title: "Key concept ideas saved!",
        description: "Next: Learn about Proof of Human Conception for inventorship validation.",
      });
      setLocation(`/project/${projectId}/agent/4-conception-intro`);
    },
    onError: (error: Error) => {
      toast({
        title: "Save failed",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  // ── Page snapshot for the AI Helper ─────────────────────────────────────
  // Declares exactly what's on this page (groups + their concepts), which
  // items are selected, and which buttons the user can actually click.
  // editable=false everywhere — this page is select-only; the helper must
  // not suggest "paste this into the box" because no edit box exists.
  const snapshot = useMemo<PageSnapshot>(() => {
    const agent4DataObj = (agent4Data?.data ?? {}) as any;
    const variations = (agent4DataObj?.claimVariations ?? []) as any[];

    const items = variations.map((variation: any, gIdx: number) => {
      const concepts = allConcepts
        .filter((c) => c.variationId === variation.id)
        .map((c) => ({
          conceptId: c.id,
          number: c.number,
          selected: selectedClaimIds.has(c.id),
          text: c.text,
        }));
      const selectedInGroup = concepts.filter((c) => c.selected).length;
      return {
        id: `key_concept_group_${gIdx + 1}`,
        type: "key_concept_group",
        status:
          concepts.length === 0
            ? "empty"
            : selectedInGroup === 0
              ? "none_selected"
              : selectedInGroup === concepts.length
                ? "all_selected"
                : "partially_selected",
        editable: false,
        content: {
          variationId: variation.id,
          strategySummary: variation.strategySummary ?? "",
          totalConcepts: concepts.length,
          selectedConcepts: selectedInGroup,
          concepts,
        },
      };
    });

    const hasAnyVariations = variations.length > 0;
    const hasSelection = selectedClaimIds.size > 0;

    const actions: PageSnapshot["actions"] = hasAnyVariations
      ? [
          {
            id: "toggle-concept",
            label: "Toggle concept checkbox",
            kind: "secondary",
            enabled: true,
          },
          {
            id: "toggle-all-in-group",
            label: "Select All / Deselect All within a group",
            kind: "secondary",
            enabled: true,
          },
          {
            id: "save-selection",
            label: "Save Selection",
            kind: "secondary",
            enabled: hasSelection && !saveSelectionMutation.isPending,
            reason: !hasSelection ? "No concepts selected yet" : undefined,
          },
          {
            id: "validate-inventorship",
            label: "Validate Inventorship",
            kind: "primary",
            enabled: hasSelection && !proceedMutation.isPending,
            reason: !hasSelection ? "No concepts selected yet" : undefined,
            navigatesTo: `/project/${projectId}/agent/4-conception-intro`,
          },
          {
            id: "back-to-strategy",
            label: "Back to Strategy",
            kind: "secondary",
            enabled: true,
            navigatesTo: `/project/${projectId}/agent/4a`,
          },
        ]
      : [
          {
            id: "back-to-strategy",
            label: "Back to Strategy",
            kind: "primary",
            enabled: true,
            navigatesTo: `/project/${projectId}/agent/4a`,
          },
        ];

    return {
      // Key Concepts Selection is prompt-phase 5 (the app packs it under
      // URL stage 4b). Declared so the helper opens PHASE_5, not PHASE_4.
      phase: 5,
      pageName: "Key Concepts Selection (Stage 4b)",
      route: `/project/${projectId}/agent/4b`,
      description: hasAnyVariations
        ? "User reviews AI-generated key-concept groups and selects which concepts to carry into the Pannu inventorship validation step. No text on this page is editable — selection only."
        : "Key-concept generation has not produced any groups yet. The only action available is returning to Strategy.",
      items,
      drafts: {},
      actions,
      source: "structured",
    };
  }, [
    agent4Data,
    allConcepts,
    selectedClaimIds,
    saveSelectionMutation.isPending,
    proceedMutation.isPending,
    projectId,
  ]);
  usePageSnapshot(snapshot);

  if (projectLoading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const agent4DataObj = agent4Data?.data as any;
  const claimVariations = agent4DataObj?.claimVariations || [];
  const hasVariations = claimVariations.length > 0;

  // Group claims by variation for display
  type ClaimsByVariation = {
    variation: any;
    claims: KeyConceptItem[];
  };
  
  const claimsByVariation: ClaimsByVariation[] = claimVariations.map((variation: any) => ({
    variation,
    claims: allConcepts.filter(c => c.variationId === variation.id),
  }));

  return (
    <div className="min-h-screen bg-background">
      <AgentHeader
        project={project}
        agentNumber={4}
        agentName="Provisional Draft - Key Concept Ideas Selection"
        agentDescription="Review and select the key concept ideas you want to include in your provisional patent application"
      />

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {!hasVariations ? (
          <Card className="border-muted">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center mb-6">
                Key concept ideas have not been generated yet. Please go back to Strategy and generate key concept ideas.
              </p>
              <Button
                variant="default"
                onClick={() => setLocation(`/project/${projectId}/agent/4a`)}
                data-testid="button-back-to-strategy"
              >
                ← Back to Strategy
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {projectId && <SiblingsReferencePanel projectId={projectId} />}
            {projectId && (
              <SiblingOverlapWarning
                projectId={projectId}
                candidates={allConcepts
                  .filter((c) => selectedClaimIds.has(c.id))
                  .map<OverlapCandidate>((c) => ({ kind: "key_concept", text: c.text }))}
              />
            )}
            {/* Selection Summary */}
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Selection Summary</CardTitle>
                <CardDescription>
                  Review and select key concept proposals for your application summary.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default" className="text-sm sm:text-base px-3 py-1" data-testid="badge-selected-count">
                      {selectedClaimIds.size} {selectedClaimIds.size === 1 ? 'key concept idea' : 'key concept ideas'} selected
                    </Badge>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      from {claimVariations.length} {claimVariations.length === 1 ? 'group' : 'groups'}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveSelectionMutation.mutate()}
                    disabled={selectedClaimIds.size === 0 || saveSelectionMutation.isPending}
                    data-testid="button-save-selection"
                    className="w-full sm:w-auto"
                  >
                    {saveSelectionMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Save Selection
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Claim Variations */}
            <div className="space-y-4">
              {claimsByVariation.map(({ variation, claims }, index: number) => {
                const isExpanded = expandedVariations.has(variation.id);
                const variationClaimIds = claims.map((c: KeyConceptItem) => c.id);
                const selectedCount = variationClaimIds.filter((id: string) => selectedClaimIds.has(id)).length;
                const allSelected = selectedCount === variationClaimIds.length;

                return (
                  <Card key={variation.id} className="border-muted" data-testid={`card-variation-${index}`}>
                    <CardHeader className="pb-3">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-base whitespace-nowrap">
                              Key Concept Group {index + 1}
                            </CardTitle>
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-variation-${index}-count`}>
                              {selectedCount}/{claims.length}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => allSelected ? deselectAllFromVariation(variation.id) : selectAllFromVariation(variation.id)}
                              data-testid={`button-toggle-all-${index}`}
                              className="text-xs sm:text-sm px-2 sm:px-3"
                            >
                              {allSelected ? 'Deselect All' : 'Select All'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleVariation(variation.id)}
                              data-testid={`button-toggle-variation-${index}`}
                            >
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                        {variation.strategySummary && (
                          <CardDescription className="text-xs sm:text-sm">
                            {variation.strategySummary}
                          </CardDescription>
                        )}
                      </div>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent className="space-y-2 sm:space-y-3 pt-0 px-3 sm:px-6">
                        {claims.map((claim: KeyConceptItem, claimIndex: number) => {
                          const isSelected = selectedClaimIds.has(claim.id);
                          return (
                            <div
                              key={claim.id}
                              className={`flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-md border-2 cursor-pointer transition-all duration-200 ${
                                isSelected
                                  ? "border-primary bg-primary/10"
                                  : "border-border hover-elevate"
                              }`}
                              data-testid={`claim-item-${index}-${claimIndex}`}
                              onClick={() => toggleClaim(claim.id)}
                            >
                              <Checkbox
                                id={claim.id}
                                checked={isSelected}
                                onCheckedChange={() => toggleClaim(claim.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-0.5"
                                data-testid={`checkbox-claim-${index}-${claimIndex}`}
                              />
                              <div className="flex-1 space-y-1">
                                <Badge
                                  variant={claim.type === 'independent' ? 'default' : 'secondary'}
                                  className="text-[10px] sm:text-xs"
                                >
                                  Key Concept {claim.number}
                                </Badge>
                                <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap">
                                  {claim.text}
                                </p>
                              </div>
                              <CheckCircle2
                                className={`h-5 w-5 shrink-0 mt-0.5 transition-all duration-200 ${
                                  isSelected
                                    ? "text-primary opacity-100"
                                    : "text-muted-foreground/20 opacity-0"
                                }`}
                              />
                            </div>
                          );
                        })}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Action Buttons */}
            {/* Mobile: Stack vertically */}
            <div className="flex flex-col gap-3 pt-4 sm:hidden">
              <Button
                variant="default"
                size="lg"
                onClick={() => proceedMutation.mutate()}
                disabled={selectedClaimIds.size === 0 || proceedMutation.isPending}
                data-testid="button-continue"
                className="w-full"
              >
                {proceedMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Validate Inventorship
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setLocation(`/project/${projectId}/agent/4a`)}
                data-testid="button-back"
                className="w-full"
              >
                ← Back to Strategy
              </Button>
            </div>
            {/* Desktop: Horizontal */}
            <div className="hidden sm:flex items-center justify-between gap-4 pt-4">
              <Button
                variant="outline"
                onClick={() => setLocation(`/project/${projectId}/agent/4a`)}
                data-testid="button-back-desktop"
              >
                ← Back to Strategy
              </Button>

              <Button
                variant="default"
                size="lg"
                onClick={() => proceedMutation.mutate()}
                disabled={selectedClaimIds.size === 0 || proceedMutation.isPending}
                data-testid="button-continue-desktop"
              >
                {proceedMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Validate Inventorship
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

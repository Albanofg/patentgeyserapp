import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, 
  ListChecks, 
  Check, 
  Pencil, 
  Trash2, 
  Sparkles, 
  ArrowRight,
  ArrowLeft,
  Save,
  X,
  RefreshCw,
  Plus,
  AlertCircle
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Project } from "@shared/schema";
import { usePageSnapshot, type PageSnapshot } from "@/lib/page-snapshot";
import { SiblingsReferencePanel } from "@/components/siblings-reference-panel";
import { recordHumanInput } from "@/lib/human-inputs";

interface UnifiedIdea {
  id: string;
  item: string;
  fromOriginal: string;
  fromAdvocate: string;
  fromExaminer: string;
  status: "pending" | "approved" | "edited" | "discarded";
  editedContent?: string;
  improvedIdea?: string;
  improvementsMade?: string;
  isLoadingAi?: boolean;
  autoApproved?: boolean;
  autoApprovalReason?: string;
  needsWork?: boolean;
  aiFix?: string;
  aiFixReason?: string;
}

interface Agent1Data {
  ideaSummary: string;
  rounds: any[];
  unifiedIdeas?: UnifiedIdea[];
  status?: "active" | "finalized";
}

export default function Agent1Inspect() {
  const [, params] = useRoute("/project/:id/agent/1b");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;

  const [ideas, setIdeas] = useState<UnifiedIdea[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newIdeaContent, setNewIdeaContent] = useState("");

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent1Data, isLoading: dataLoading } = useQuery<{ data: Agent1Data }>({
    queryKey: ["/api/projects", projectId, "agent", 1],
    enabled: !!projectId,
  });

  const { data: extractedIdeas, isLoading: ideasLoading } = useQuery<{ ideas: UnifiedIdea[] }>({
    queryKey: ["/api/projects", projectId, "agent", 1, "extracted-ideas"],
    enabled: !!projectId,
  });

  const askAiMutation = useMutation({
    mutationFn: async (ideaId: string) => {
      const idea = ideas.find(i => i.id === ideaId);
      if (!idea) throw new Error("Idea not found");
      
      return await apiRequest("POST", `/api/projects/${projectId}/agent/1/ask-ai-modifier`, {
        ideaId,
        item: idea.item,
        fromOriginal: idea.fromOriginal,
        fromAdvocate: idea.fromAdvocate,
        fromExaminer: idea.fromExaminer,
        originalUserPrompt: agent1Data?.data?.ideaSummary || "",
      });
    },
    onSuccess: (response: any, ideaId: string) => {
      setIdeas(prev => prev.map(idea => 
        idea.id === ideaId 
          ? { 
              ...idea, 
              improvedIdea: response.improvedIdea, 
              improvementsMade: response.improvementsMade,
              isLoadingAi: false 
            }
          : idea
      ));
    },
    onError: (error: Error, ideaId: string) => {
      setIdeas(prev => prev.map(idea => 
        idea.id === ideaId ? { ...idea, isLoadingAi: false } : idea
      ));
      toast({
        title: "Failed to get AI suggestion",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveAndContinueMutation = useMutation({
    mutationFn: async () => {
      const approvedIdeas = ideas.filter(i => i.status === "approved" || i.status === "edited");
      return await apiRequest("POST", `/api/projects/${projectId}/agent/1/save-refined-ideas`, {
        ideas: approvedIdeas,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      setLocation(`/project/${projectId}/agent/2a`);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save ideas",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async (ideaText: string) => {
      return await apiRequest("POST", `/api/projects/${projectId}/agent/1/reanalyze`, {
        idea: ideaText,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 1] });
      toast({
        title: "Re-analysis complete",
        description: "Advocate and Examiner have analyzed your improved idea.",
      });
      setLocation(`/project/${projectId}/agent/1a-audit`);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to re-analyze",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Auto-save mutation for persisting idea changes
  const saveIdeaMutation = useMutation({
    mutationFn: async ({ ideaId, updates }: { ideaId: string; updates: Partial<UnifiedIdea> }) => {
      return await apiRequest("PATCH", `/api/projects/${projectId}/agent/1/ideas/${ideaId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 1, "extracted-ideas"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save changes",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleReanalyzeAll = () => {
    // Gather all approved/edited ideas into one consolidated text
    const approvedIdeas = ideas.filter(i => i.status === "approved" || i.status === "edited");
    if (approvedIdeas.length === 0) {
      toast({
        title: "No ideas approved",
        description: "Please approve at least one idea before re-analyzing.",
        variant: "destructive",
      });
      return;
    }
    
    // Build consolidated idea text
    const consolidatedIdea = approvedIdeas
      .map((idea, idx) => `${idx + 1}. ${idea.editedContent || idea.item}`)
      .join("\n\n");
    
    reanalyzeMutation.mutate(consolidatedIdea);
  };

  // Initialize ideas from extracted data using useEffect
  useEffect(() => {
    if (extractedIdeas?.ideas && extractedIdeas.ideas.length > 0) {
      // Always sync from server data to preserve saved state (approvals, edits, AI suggestions)
      setIdeas(extractedIdeas.ideas.map(idea => ({
        ...idea,
        status: idea.status || "pending" as const,
      })));
    }
  }, [extractedIdeas?.ideas]);

  // Auto-generate the AI suggestion for every pending, non-auto-approved idea
  // that doesn't already have one. The per-idea endpoint persists each result,
  // so reloads/relogs see the saved suggestion and the sweep does not re-fire
  // (the no-re-fire-on-reload rule).
  const aiSweepAttempted = useRef<Set<string>>(new Set());
  const aiSweepRunningRef = useRef(false);
  useEffect(() => {
    if (!ideas.length || aiSweepRunningRef.current) return;

    const candidates = ideas.filter(
      (i) =>
        i.status === "pending" &&
        !i.autoApproved &&
        !i.improvedIdea &&
        !i.isLoadingAi &&
        !aiSweepAttempted.current.has(i.id),
    );
    if (candidates.length === 0) return;

    aiSweepRunningRef.current = true;
    // Reserve all candidates up-front so re-renders during the sweep don't
    // re-enqueue them, and so the UI immediately shows the per-card spinner.
    for (const c of candidates) aiSweepAttempted.current.add(c.id);
    setIdeas((prev) =>
      prev.map((i) =>
        candidates.find((c) => c.id === i.id) ? { ...i, isLoadingAi: true } : i,
      ),
    );

    (async () => {
      try {
        for (const c of candidates) {
          try {
            await askAiMutation.mutateAsync(c.id);
          } catch {
            // mutation's onError already clears the spinner + toasts the user.
          }
        }
      } finally {
        aiSweepRunningRef.current = false;
      }
    })();
  }, [ideas, askAiMutation]);

  const handleApprove = (id: string, approvedContent: string) => {
    setIdeas(prev => prev.map(idea => 
      idea.id === id ? { ...idea, editedContent: approvedContent, status: "approved" as const } : idea
    ));
    // Auto-save to database with the specific approved content
    saveIdeaMutation.mutate({ ideaId: id, updates: { editedContent: approvedContent, status: "approved" } });
  };

  const handleStartEdit = (id: string) => {
    const idea = ideas.find(i => i.id === id);
    if (idea) {
      setEditingId(id);
      setEditContent(idea.editedContent || idea.item);
    }
  };

  const handleSaveEdit = (id: string) => {
    setIdeas(prev => prev.map(idea =>
      idea.id === id
        ? { ...idea, editedContent: editContent, status: "edited" as const }
        : idea
    ));
    setEditingId(null);
    // Auto-save to database
    saveIdeaMutation.mutate({ ideaId: id, updates: { editedContent: editContent, status: "edited" } });
    // Ledger: capture the user's edited idea text for Proof of Human Conception.
    void recordHumanInput({
      projectId,
      source: "module1/inspect-edit",
      sourceRefId: id,
      promptText: "Edited extracted idea",
      answerText: editContent,
      tags: ["conception_mechanism", "implementation_detail"],
    });
    setEditContent("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const handleDiscard = (id: string) => {
    setIdeas(prev => prev.map(idea => 
      idea.id === id ? { ...idea, status: "discarded" as const } : idea
    ));
    // Auto-save to database
    saveIdeaMutation.mutate({ ideaId: id, updates: { status: "discarded" } });
  };

const handleApplyAiSuggestion = (id: string) => {
    const idea = ideas.find(i => i.id === id);
    if (idea?.improvedIdea) {
      setIdeas(prev => prev.map(i => 
        i.id === id 
          ? { ...i, editedContent: idea.improvedIdea, status: "edited" as const }
          : i
      ));
      // Auto-save to database
      saveIdeaMutation.mutate({ 
        ideaId: id, 
        updates: { editedContent: idea.improvedIdea, status: "edited" } 
      });
    }
  };

  // Mutation for adding new ideas
  const addIdeaMutation = useMutation({
    mutationFn: async (ideaContent: string) => {
      return await apiRequest("POST", `/api/projects/${projectId}/agent/1/ideas`, {
        item: ideaContent,
      });
    },
    onSuccess: (response: any) => {
      // Add the new idea to local state
      const newIdea: UnifiedIdea = {
        id: response.idea.id,
        item: response.idea.item,
        fromOriginal: response.idea.fromOriginal || "User added this idea manually",
        fromAdvocate: response.idea.fromAdvocate || "",
        fromExaminer: response.idea.fromExaminer || "",
        status: "pending",
      };
      setIdeas(prev => [...prev, newIdea]);
      setNewIdeaContent("");
      setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 1, "extracted-ideas"] });
      toast({
        title: "Idea added",
        description: "Your new idea has been added to the list.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add idea",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddIdea = () => {
    if (!newIdeaContent.trim()) {
      toast({
        title: "Empty idea",
        description: "Please enter an idea before adding.",
        variant: "destructive",
      });
      return;
    }
    const trimmed = newIdeaContent.trim();
    addIdeaMutation.mutate(trimmed);
    // Ledger: capture the user-added idea for Proof of Human Conception.
    void recordHumanInput({
      projectId,
      source: "module1/inspect-add",
      sourceRefId: null,
      promptText: "User-added idea (post-extraction)",
      answerText: trimmed,
      tags: ["conception_mechanism", "implementation_detail"],
    });
  };

  // Per-idea actions (approve / edit / discard / ask-AI / save edit) are
  // surfaced inline below the page-level actions. The helper can address them
  // by id "<action>-<conceptN>". Items themselves are editable because the
  // user can rewrite each idea via Edit mode or via the AI-modifier rewrite.
  const perIdeaActions = ideas.flatMap((idea, i) => {
    const conceptId = `Concept ${i + 1}`;
    const isEditingThis = editingId === idea.id;
    const isPending = idea.status === "pending";
    const isApproved = idea.status === "approved" || idea.status === "edited";
    const isDiscarded = idea.status === "discarded";
    const out: NonNullable<PageSnapshot["actions"]> = [];
    if (isPending && !isEditingThis) {
      out.push({ id: `approve-${conceptId}`, label: `Approve ${conceptId}`, kind: "primary", enabled: true });
      out.push({ id: `edit-${conceptId}`, label: `Edit ${conceptId}`, kind: "secondary", enabled: true });
      out.push({ id: `ask-ai-${conceptId}`, label: `Ask AI to improve ${conceptId}`, kind: "secondary", enabled: !idea.isLoadingAi });
      out.push({ id: `discard-${conceptId}`, label: `Discard ${conceptId}`, kind: "destructive", enabled: true });
    }
    if (isEditingThis) {
      out.push({ id: `save-edit-${conceptId}`, label: `Save edit for ${conceptId}`, kind: "primary", enabled: editContent.trim().length > 0, reason: editContent.trim().length === 0 ? "Edit field is empty" : undefined });
      out.push({ id: `cancel-edit-${conceptId}`, label: `Cancel edit for ${conceptId}`, kind: "secondary", enabled: true });
    }
    if (isApproved && !isEditingThis) {
      out.push({ id: `edit-${conceptId}`, label: `Edit ${conceptId}`, kind: "secondary", enabled: true });
      out.push({ id: `discard-${conceptId}`, label: `Discard ${conceptId}`, kind: "destructive", enabled: true });
    }
    if (isDiscarded) {
      out.push({ id: `restore-${conceptId}`, label: `Restore ${conceptId}`, kind: "secondary", enabled: true });
    }
    return out;
  });

  usePageSnapshot({
    // Prompt-phase mapping: PHASE_1_INSPECT_AND_REFINE_IDEAS — the inventor is
    // reviewing per-concept verdicts on extracted ideas. Declared explicitly
    // so the AI Helper runs the right rulebook even when the user has
    // navigated back from a later stage (in which case dbStage would
    // otherwise lag and confuse the helper).
    phase: 1,
    pageName: "Inspect & Refine Ideas (Stage 1b)",
    route: typeof window !== "undefined" ? window.location.pathname : "",
    description:
      "User is reviewing extracted ideas from their original disclosure. Each idea has a status (pending/approved/edited/discarded). " +
      "Pending ideas can be approved as-is, edited inline, discarded, or sent to the AI modifier for an improved rewrite. " +
      "Once all ideas are resolved, the user advances to Stage 2.",
    items: [
      ...(agent1Data?.data?.ideaSummary
        ? [{
            id: "idea_summary",
            type: "idea_summary",
            editable: false,
            content: agent1Data.data.ideaSummary.slice(0, 1200),
          }]
        : []),
      ...ideas.map((idea, i) => {
        const conceptId = `Concept ${i + 1}`;
        const isFocused = editingId === idea.id;
        const content: Record<string, any> = {
          item: idea.editedContent || idea.item,
        };
        if (idea.autoApproved) content.autoApproved = true;
        if (idea.needsWork) content.needsWork = true;
        if (idea.improvedIdea) content.improvedIdea = idea.improvedIdea;
        if (idea.isLoadingAi) content.isLoadingAi = true;
        // Heavy fields only for the item the user is actively working on.
        if (isFocused) {
          if (idea.fromOriginal) content.fromOriginal = idea.fromOriginal;
          if (idea.fromAdvocate) content.fromAdvocate = idea.fromAdvocate;
          if (idea.fromExaminer) content.fromExaminer = idea.fromExaminer;
          if (idea.aiFix) content.aiFix = idea.aiFix;
          if (idea.improvementsMade) content.improvementsMade = idea.improvementsMade;
        }
        return {
          id: conceptId,
          type: "extracted_idea",
          status: idea.status,
          // editable=true only while Edit mode is active for this concept,
          // since the textarea only exists in that mode.
          editable: isFocused,
          editTarget: isFocused ? `edit_${idea.id}` : undefined,
          content,
        };
      }),
    ],
    drafts: {
      ...(editingId ? { [`edit_${editingId}`]: editContent } : {}),
      ...(showAddForm && newIdeaContent ? { new_idea: newIdeaContent } : {}),
    },
    focused: editingId
      ? `Concept ${ideas.findIndex((i) => i.id === editingId) + 1}`
      : undefined,
    actions: [
      {
        id: "back-to-debate",
        label: "Back to Advocate/Examiner Debate",
        kind: "secondary",
        enabled: true,
        navigatesTo: `/project/${projectId}/agent/1a`,
      },
      {
        id: "reanalyze",
        label: "Re-analyze (Round 2 audit)",
        kind: "secondary",
        enabled: !reanalyzeMutation.isPending,
        reason: reanalyzeMutation.isPending ? "Re-analysis in progress" : undefined,
        navigatesTo: `/project/${projectId}/agent/1a-audit`,
      },
      {
        id: "add-new-idea",
        label: showAddForm ? "Save new idea" : "Add a new idea",
        kind: "secondary",
        enabled: showAddForm
          ? !addIdeaMutation.isPending && newIdeaContent.trim().length > 0
          : true,
        reason:
          showAddForm && newIdeaContent.trim().length === 0
            ? "New-idea field is empty"
            : undefined,
      },
      ...perIdeaActions,
      {
        id: "continue-to-stage-2",
        label: "Continue to Stage 2",
        kind: "primary",
        enabled:
          !saveAndContinueMutation.isPending &&
          ideas.length > 0 &&
          ideas.every((i) => i.status !== "pending"),
        reason:
          ideas.length === 0
            ? "No extracted ideas yet"
            : ideas.some((i) => i.status === "pending")
              ? "Some ideas are still pending — approve, edit, discard, or improve them first"
              : undefined,
        navigatesTo: `/project/${projectId}/agent/2a`,
      },
    ],
    source: "structured",
  });

  if (projectLoading || dataLoading || ideasLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" data-testid="loader-page" />
          <p className="text-muted-foreground">Extracting and organizing ideas...</p>
        </div>
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

  const autoApprovedCount = ideas.filter(i => i.autoApproved && (i.status === "approved")).length;
  const manualApprovedCount = ideas.filter(i => !i.autoApproved && (i.status === "approved" || i.status === "edited")).length;
  const approvedCount = autoApprovedCount + manualApprovedCount;
  const pendingCount = ideas.filter(i => i.status === "pending").length;
  const discardedCount = ideas.filter(i => i.status === "discarded").length;
  const allResolved = pendingCount === 0 && ideas.length > 0;

  return (
    <div className="h-full flex flex-col bg-background">
      {projectId && (
        <div className="px-4 pt-3 shrink-0">
          <div className="max-w-4xl mx-auto">
            <SiblingsReferencePanel projectId={projectId} />
          </div>
        </div>
      )}
      <div className="border-b p-4 shrink-0">
        <div className="max-w-4xl mx-auto space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-primary shrink-0" />
                <span className="truncate sm:whitespace-normal">Inspect & Refine Ideas</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Review each idea extracted from Advocate, Examiner, and your original input
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(true)}
              disabled={showAddForm}
              data-testid="button-add-idea"
              className="shrink-0"
            >
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Add Idea</span>
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm flex-wrap">
            {autoApprovedCount > 0 && (
              <>
                <span className="text-blue-600 dark:text-blue-400 font-medium">{autoApprovedCount} auto</span>
                <span className="text-muted-foreground">·</span>
              </>
            )}
            <span className="text-green-600 dark:text-green-400 font-medium">{manualApprovedCount} approved</span>
            <span className="text-muted-foreground">·</span>
            <span className={pendingCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
              {pendingCount} pending
            </span>
            {discardedCount > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{discardedCount} discarded</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Original First Input - Always shown first */}
          {agent1Data?.data?.ideaSummary && (
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base">Your Original Idea</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{agent1Data.data.ideaSummary}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Add New Idea Form */}
          {showAddForm && (
            <Card className="border-primary/50 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Plus className="h-4 w-4 text-primary" />
                  Add New Idea
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Add any concept or feature the brainstorming session may have missed.
                </p>
                <Textarea
                  value={newIdeaContent}
                  onChange={(e) => setNewIdeaContent(e.target.value)}
                  placeholder="Describe your idea..."
                  className="min-h-25"
                  data-testid="input-new-idea"
                />
                <div className="flex items-center gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewIdeaContent("");
                    }}
                    data-testid="button-cancel-add"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleAddIdea}
                    disabled={addIdeaMutation.isPending || !newIdeaContent.trim()}
                    data-testid="button-submit-add"
                  >
                    {addIdeaMutation.isPending ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <Plus className="h-3 w-3 mr-1" />
                        Add Idea
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {ideas.length === 0 && !showAddForm ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <p>No ideas extracted yet. Go back to get the Advocate/Examiner analysis first, or add your own ideas.</p>
              </CardContent>
            </Card>
          ) : ideas.length === 0 ? null : (
            ideas.map((idea, idx) => (
              <Card 
                key={idea.id} 
                className={`transition-all ${
                  idea.status === "discarded" 
                    ? "opacity-50 bg-muted/50" 
                    : idea.autoApproved && idea.status === "approved"
                    ? "border-blue-500/50 bg-blue-50/30 dark:bg-blue-950/20"
                    : idea.status === "approved" || idea.status === "edited"
                    ? "border-green-500/50 bg-green-50/50 dark:bg-green-950/20"
                    : ""
                }`}
                data-testid={`card-idea-${idx}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-md bg-primary/10 text-primary font-bold text-sm">
                        {idx + 1}
                      </span>
                      {idea.autoApproved && idea.status === "approved" ? (
                        <Check className="h-4 w-4 text-blue-600" />
                      ) : idea.status === "approved" || idea.status === "edited" ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : idea.status === "discarded" ? (
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      ) : null}
                      {editingId === idea.id ? "Editing..." : (idea.editedContent || idea.item)}
                    </CardTitle>
                    {!idea.autoApproved && (idea.status === "approved" || idea.status === "edited") && editingId !== idea.id ? (
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium px-2 py-1 bg-green-100 dark:bg-green-900/30 rounded">
                        Approved
                      </span>
                    ) : idea.status === "discarded" ? (
                      <span className="text-xs text-muted-foreground font-medium px-2 py-1 bg-muted rounded">
                        Discarded
                      </span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {editingId === idea.id && (
                    <div className="space-y-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700">
                      <p className="font-medium text-amber-700 dark:text-amber-400 text-sm flex items-center gap-1">
                        <Pencil className="h-3 w-3" />
                        Edit Idea:
                      </p>
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="min-h-20"
                        data-testid={`input-edit-${idx}`}
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => handleSaveEdit(idea.id)} data-testid={`button-save-edit-${idx}`}>
                          <Save className="h-3 w-3 mr-1" />
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleCancelEdit} data-testid={`button-cancel-edit-${idx}`}>
                          <X className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 text-sm">
                    <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 border-l-4 border-blue-500">
                      <p className="font-medium text-blue-700 dark:text-blue-400 mb-1">From Original:</p>
                      <p className="text-foreground">{idea.fromOriginal}</p>
                    </div>
                    <div className="p-3 rounded-md bg-green-50 dark:bg-green-950/30 border-l-4 border-green-500">
                      <p className="font-medium text-green-700 dark:text-green-400 mb-1">From Advocate:</p>
                      <p className="text-foreground">{idea.fromAdvocate}</p>
                    </div>
                    <div className="p-3 rounded-md bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500">
                      <p className="font-medium text-red-700 dark:text-red-400 mb-1">From Examiner:</p>
                      <p className="text-muted-foreground italic">{idea.fromExaminer}</p>
                    </div>
                  </div>

                  {/* AI Fix Suggestion - shown for items that need work from Round 2+ */}
                  {idea.aiFix && idea.status === "pending" && (
                    <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border-l-4 border-amber-500 mt-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                            <p className="font-medium text-amber-700 dark:text-amber-400">
                              AI Suggested Fix:
                            </p>
                          </div>
                          <p className="text-foreground">{idea.aiFix}</p>
                          {idea.aiFixReason && (
                            <p className="text-muted-foreground text-sm italic">{idea.aiFixReason}</p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleApprove(idea.id, idea.aiFix!)}
                          className="shrink-0"
                          data-testid={`button-apply-fix-${idx}`}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Apply Fix
                        </Button>
                      </div>
                    </div>
                  )}

                  {idea.improvedIdea && idea.status !== "approved" && idea.status !== "edited" && (
                    <div className="p-3 rounded-md bg-purple-50 dark:bg-purple-950/30 border-l-4 border-purple-500 mt-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 space-y-3">
                          <div>
                            <p className="font-medium text-purple-700 dark:text-purple-400 mb-1 flex items-center gap-1">
                              <Sparkles className="h-3 w-3" />
                              Improved Idea:
                            </p>
                            <p className="text-foreground">{idea.improvedIdea}</p>
                          </div>
                          {idea.improvementsMade && (
                            <div>
                              <p className="font-medium text-purple-600 dark:text-purple-300 mb-1 text-sm">
                                What was improved:
                              </p>
                              <p className="text-muted-foreground text-sm">{idea.improvementsMade}</p>
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleApplyAiSuggestion(idea.id)}
                          className="shrink-0"
                          data-testid={`button-apply-ai-${idx}`}
                        >
                          Apply
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Bottom Action Bar */}
                  {idea.status !== "discarded" && editingId !== idea.id && (
                    <div className="flex items-center justify-end gap-2 pt-3 border-t mt-3 flex-wrap">
                      {idea.status === "pending" && idea.fromOriginal && !idea.fromOriginal.toLowerCase().includes("not mentioned") && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleApprove(idea.id, idea.fromOriginal)}
                          data-testid={`button-approve-original-${idx}`}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Approve Original
                        </Button>
                      )}
                      {idea.status === "pending" && idea.fromAdvocate && !idea.fromAdvocate.toLowerCase().includes("not mentioned") && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleApprove(idea.id, idea.fromAdvocate)}
                          data-testid={`button-approve-advocate-${idx}`}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Approve Advocate
                        </Button>
                      )}
                      {idea.autoApproved && idea.status === "approved" && (
                        <span className="text-xs text-blue-600 dark:text-blue-400 font-medium px-2 py-1 bg-blue-100 dark:bg-blue-900/30 rounded">
                          Auto-Approved
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStartEdit(idea.id)}
                        data-testid={`button-edit-${idx}`}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      {idea.isLoadingAi && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground px-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Generating AI suggestion…
                        </span>
                      )}
<Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDiscard(idea.id)}
                        data-testid={`button-discard-${idx}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <div className="border-t p-4 bg-background shrink-0">
        <div className="max-w-4xl mx-auto space-y-3">
          {/* Warning when there are still pending ideas */}
          {!allResolved && ideas.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Please resolve all pending ideas (approve, edit, or discard each one) before continuing.</span>
            </div>
          )}
          {/* Mobile: Stack buttons vertically */}
          <div className="flex flex-col gap-3 sm:hidden">
            <Button
              onClick={() => saveAndContinueMutation.mutate()}
              disabled={saveAndContinueMutation.isPending || !allResolved || approvedCount === 0}
              data-testid="button-save-continue"
              className="w-full"
            >
              {saveAndContinueMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Save & Continue to Stage 2
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleReanalyzeAll}
              disabled={reanalyzeMutation.isPending || !allResolved || approvedCount === 0}
              data-testid="button-reanalyze"
              className="w-full"
            >
              {reanalyzeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Re-analyzing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Re-analyze
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setLocation(`/project/${projectId}/agent/1a`)}
              data-testid="button-back"
              className="w-full"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Analysis
            </Button>
          </div>
          {/* Desktop: Horizontal layout */}
          <div className="hidden sm:flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation(`/project/${projectId}/agent/1a`)}
              data-testid="button-back-desktop"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Analysis
            </Button>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleReanalyzeAll}
                disabled={reanalyzeMutation.isPending || !allResolved || approvedCount === 0}
                data-testid="button-reanalyze-desktop"
              >
                {reanalyzeMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Re-analyzing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Re-analyze with Advocate/Examiner
                  </>
                )}
              </Button>
              <Button
                onClick={() => saveAndContinueMutation.mutate()}
                disabled={saveAndContinueMutation.isPending || !allResolved || approvedCount === 0}
                data-testid="button-save-continue-desktop"
              >
                {saveAndContinueMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Save & Continue to Stage 2
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { usePageSnapshot, type PageSnapshot } from "@/lib/page-snapshot";
import { Loader2, Shield, CheckCircle, CheckCircle2, Circle, AlertCircle, HelpCircle, ArrowRight, ChevronDown, ChevronUp, Sparkles, SkipForward, FileText } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Project, PannuRecord } from "@shared/schema";

type GenerationStep = 'idle' | 'provisional' | 'diagrams';

type PannuQuestion = {
  factor: string;
  question: string;
  hint?: string;
};

// The three POHC factors are universal — same for every key concept. We
// surface them as static headers rather than asking an AI to invent
// per-concept questions, which (a) wastes a model call, and (b) introduced
// the "Generate Questions" friction step that blocked the page from
// showing pre-filled evidence on land.
const STATIC_POHC_FACTORS: PannuQuestion[] = [
  {
    factor: "conception",
    question:
      "What you wrote about how this specific technical mechanism came together — the path of thought that produced it.",
    hint: "Pulled from your earlier notes about how you got here.",
  },
  {
    factor: "quality",
    question:
      "What you wrote about why this is a real technical advance — not just stacking known parts in an obvious way.",
    hint: "Pulled from your additional notes and refinement feedback.",
  },
  {
    factor: "known_concepts",
    question:
      "What you wrote about how this differs from what already exists in the field.",
    hint: "Pulled from your strategy notes per concept and your awareness of prior art.",
  },
];

type ClaimForValidation = {
  id: string;
  conceptId: string;
  claimText: string;
  strategyContext?: string;
  type: 'independent' | 'dependent';
  number: number; // Original claim number from webhook
};

type ValidationState = {
  status: 'pending' | 'generating' | 'answering' | 'validating' | 'certified' | 'needs_clarification' | 'rejected';
  questions?: PannuQuestion[];
  answers?: { factor: string; answer: string }[];
  pannuRecordId?: string;
  certificationStatus?: string;
  confidenceScore?: string;
  pannuRecordText?: string;
};

const PROCESSING_STEPS = [
  "Understanding invention description",
  "Identifying core components",
  "Generating example embodiments",
  "Expanding technical descriptions",
  "Organizing specification sections",
  "Formatting draft document",
];

export default function Agent4Pannu() {
  const [, params] = useRoute("/project/:id/agent/4-conception");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;

  const [validationStates, setValidationStates] = useState<Record<string, ValidationState>>({});
  const [expandedClaims, setExpandedClaims] = useState<Set<string>>(new Set());
  const [currentAnswers, setCurrentAnswers] = useState<Record<string, Record<string, string>>>({});
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, Record<string, string>>>({});
  // Pre-fill metadata per concept → per factor. Holds source chip info and
  // a coverage score so the UI can show "drafted from Module 2 / Module 4a"
  // and indicate strong/weak/empty material without re-fetching.
  const [prefillMeta, setPrefillMeta] = useState<Record<string, Record<string, {
    sources: Array<{ source: string; sourceLabel: string; text: string }>;
    coverage: number;
    draft: string;
  }>>>({});
  const [loadingAiSuggestion, setLoadingAiSuggestion] = useState<string | null>(null);
  const [generationStep, setGenerationStep] = useState<GenerationStep>('idle');
  const [visibleSteps, setVisibleSteps] = useState(0);

  useEffect(() => {
    if (generationStep === 'idle') {
      setVisibleSteps(0);
      return;
    }
    if (visibleSteps >= PROCESSING_STEPS.length) return;
    const timer = setTimeout(() => {
      setVisibleSteps((prev) => prev + 1);
    }, 20000);
    return () => clearTimeout(timer);
  }, [generationStep, visibleSteps]);

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent4Data, isLoading: agent4Loading } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "agent", 4],
    enabled: !!projectId,
  });

  const { data: pannuRecords } = useQuery<PannuRecord[]>({
    queryKey: ["/api/projects", projectId, "conception"],
    enabled: !!projectId,
  });

  // Navigation guard
  useEffect(() => {
    if (!project) return;
    
    const currentStage = project.currentStage;
    const currentSubstage = project.currentSubstage;
    
    if (currentStage < 4 || (currentStage === 4 && currentSubstage === '4a')) {
      toast({
        title: "Complete previous stages first",
        description: "Please select key concepts first.",
      });
      setLocation(`/project/${projectId}/agent/4b`);
    }
  }, [project, projectId, setLocation, toast]);

  // Build claims list from selected claims
  const getClaimsForValidation = (): ClaimForValidation[] => {
    const agent4DataObj = agent4Data?.data as any;
    const selectedKeyConcepts = agent4DataObj?.selectedKeyConcepts || [];
    
    return selectedKeyConcepts.map((claim: any, index: number) => ({
      id: claim.id,
      conceptId: claim.id,
      claimText: claim.text,
      strategyContext: claim.strategySummary || '',
      type: claim.type,
      number: claim.number || (index + 1),
    }));
  };

  const keyConceptsForValidation = getClaimsForValidation();

  // Initialize validation states from existing records (only on first load)
  const [initializedFromDb, setInitializedFromDb] = useState(false);
  
  useEffect(() => {
    if (pannuRecords && pannuRecords.length > 0 && !initializedFromDb) {
      const states: Record<string, ValidationState> = {};
      pannuRecords.forEach((record) => {
        const status = record.certificationStatus === 'Certified' ? 'certified'
          : record.certificationStatus === 'Needs Clarification' ? 'needs_clarification'
          : record.certificationStatus === 'Rejected' ? 'rejected'
          : 'answering';

        states[record.conceptId] = {
          status,
          // Always use the static factors — we don't ask an AI to invent
          // per-concept questions anymore. If the persisted record happened
          // to carry old AI-generated questions, we ignore them.
          questions: STATIC_POHC_FACTORS,
          answers: record.answers as { factor: string; answer: string }[] | undefined,
          pannuRecordId: record.id,
          certificationStatus: record.certificationStatus || undefined,
          confidenceScore: record.confidenceScore || undefined,
          pannuRecordText: record.pannuRecordText || undefined,
        };
      });
      setValidationStates(prev => ({ ...prev, ...states }));
      setInitializedFromDb(true);
    }
  }, [pannuRecords, initializedFromDb]);

  // For every selected concept that doesn't yet have a validation state,
  // seed it with the three static factors so the page renders the three
  // pre-fillable fields without requiring any "Generate Questions" click.
  // Concepts with a persisted record (above) keep that record's answers.
  useEffect(() => {
    if (keyConceptsForValidation.length === 0) return;
    setValidationStates(prev => {
      let mutated = false;
      const next = { ...prev };
      for (const claim of keyConceptsForValidation) {
        if (!next[claim.conceptId]) {
          next[claim.conceptId] = {
            status: 'answering',
            questions: STATIC_POHC_FACTORS,
          };
          mutated = true;
        } else if (!next[claim.conceptId].questions) {
          next[claim.conceptId] = {
            ...next[claim.conceptId],
            questions: STATIC_POHC_FACTORS,
          };
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [keyConceptsForValidation]);

  // Hydrate currentAnswers from persisted records so the textareas show
  // whatever the user last submitted (or last drafted, if we extended the
  // record shape later).
  useEffect(() => {
    if (!pannuRecords) return;
    setCurrentAnswers(prev => {
      let mutated = false;
      const next = { ...prev };
      for (const record of pannuRecords) {
        if (next[record.conceptId]) continue;
        const ans = record.answers as { factor: string; answer: string }[] | undefined;
        if (!Array.isArray(ans) || ans.length === 0) continue;
        const map: Record<string, string> = {};
        for (const a of ans) {
          if (a && typeof a.factor === "string" && typeof a.answer === "string") {
            map[a.factor] = a.answer;
          }
        }
        if (Object.keys(map).length > 0) {
          next[record.conceptId] = map;
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [pannuRecords]);

  // Whenever a concept enters the "answering"-or-later state without prefill
  // metadata yet, fetch it. Covers both the fresh-generate path (which sets
  // status='answering' via the mutation) and the persisted-record path
  // (which loads validationStates from pannu_records without firing the
  // generate-questions mutation, so the mutation's onSuccess never ran).
  useEffect(() => {
    if (!projectId) return;
    for (const claim of keyConceptsForValidation) {
      const cid = claim.conceptId;
      const state = validationStates[cid];
      if (!state) continue;
      if (state.status === 'pending' || state.status === 'generating') continue;
      if (prefillMeta[cid]) continue;
      (async () => {
        try {
          const res = await fetch(
            `/api/projects/${projectId}/pannu/prefill?conceptId=${encodeURIComponent(cid)}`,
            { credentials: "include" },
          );
          if (!res.ok) return;
          const prefill = await res.json();
          const meta: Record<string, { sources: any[]; coverage: number; draft: string }> = {};
          for (const factor of ["conception", "quality", "known_concepts"] as const) {
            const f = prefill?.factors?.[factor];
            meta[factor] = {
              sources: Array.isArray(f?.sources) ? f.sources : [],
              coverage: typeof f?.coverage === "number" ? f.coverage : 0,
              draft: typeof f?.draft === "string" ? f.draft : "",
            };
          }
          setPrefillMeta(prev => (prev[cid] ? prev : { ...prev, [cid]: meta }));
        } catch (e) {
          console.warn("[pannu] on-mount prefill fetch failed:", e);
        }
      })();
    }
    // We don't include prefillMeta in deps — only the keys we already
    // fetched matter, and we read those via the early-return check above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, keyConceptsForValidation, validationStates]);

  // Auto-expand every concept on land. The page is meant to land fully
  // populated — pre-filled factor fields visible per concept — so the user
  // can scan and edit, not click-to-reveal one by one.
  useEffect(() => {
    if (keyConceptsForValidation.length > 0 && expandedClaims.size === 0) {
      setExpandedClaims(new Set(keyConceptsForValidation.map((c) => c.id)));
    }
  }, [keyConceptsForValidation]);

  const generateQuestionsMutation = useMutation({
    mutationFn: async (claim: ClaimForValidation) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/conception/generate-questions`, {
        conceptId: claim.conceptId,
        keyConceptText: claim.claimText,
        strategyContext: claim.strategyContext,
      });
      return response;
    },
    onSuccess: async (data, claim) => {
      setValidationStates(prev => ({
        ...prev,
        [claim.conceptId]: {
          ...prev[claim.conceptId],
          status: 'answering',
          questions: data.questions,
          pannuRecordId: data.pannuRecordId,
        },
      }));

      // Fetch the pre-fill envelope but DON'T auto-populate the textareas.
      // The user opts in per factor via the "Use what I already wrote" button
      // below each field — they retain agency, and we never confirm AI-
      // generated material as their own work.
      try {
        const prefillRes = await fetch(
          `/api/projects/${projectId}/pannu/prefill?conceptId=${encodeURIComponent(claim.conceptId)}`,
          { credentials: "include" },
        );
        if (prefillRes.ok) {
          const prefill = await prefillRes.json();
          const meta: Record<string, { sources: any[]; coverage: number; draft: string }> = {};
          for (const factor of ["conception", "quality", "known_concepts"] as const) {
            const f = prefill?.factors?.[factor];
            meta[factor] = {
              sources: Array.isArray(f?.sources) ? f.sources : [],
              coverage: typeof f?.coverage === "number" ? f.coverage : 0,
              draft: typeof f?.draft === "string" ? f.draft : "",
            };
          }
          setPrefillMeta(prev => ({ ...prev, [claim.conceptId]: meta }));
        }
      } catch (e) {
        console.warn("[pannu] prefill fetch failed:", e);
      }
    },
    onError: (error: Error, claim) => {
      toast({
        title: "Failed to generate questions",
        description: error.message,
        // Softer UX - no red banner
      });
      setValidationStates(prev => ({
        ...prev,
        [claim.conceptId]: { ...prev[claim.conceptId], status: 'pending' },
      }));
    },
  });

  const validateAnswersMutation = useMutation({
    mutationFn: async ({ claim, answers }: { claim: ClaimForValidation; answers: { factor: string; answer: string }[] }) => {
      const state = validationStates[claim.conceptId];
      const response = await apiRequest("POST", `/api/projects/${projectId}/conception/validate-answers`, {
        pannuRecordId: state?.pannuRecordId,
        conceptId: claim.conceptId,
        keyConceptText: claim.claimText,
        answers,
      });
      return response;
    },
    onSuccess: (data, { claim }) => {
      const status = data.certificationStatus === 'Certified' ? 'certified' 
        : data.certificationStatus === 'Needs Clarification' ? 'needs_clarification'
        : 'rejected';
      
      setValidationStates(prev => ({
        ...prev,
        [claim.conceptId]: {
          ...prev[claim.conceptId],
          status,
          certificationStatus: data.certificationStatus,
          confidenceScore: data.confidenceScore,
          pannuRecordText: data.pannuRecordText,
        },
      }));
      // Don't invalidate immediately - local state is already updated
      
      toast({
        title: status === 'certified' ? "Inventorship Certified!" : "Validation Complete",
        description: status === 'certified' 
          ? "Your contribution has been validated." 
          : "Please review the feedback below.",
      });
    },
    onError: (error: Error, { claim }) => {
      toast({
        title: "Validation failed",
        description: error.message,
        // Softer UX - no red banner
      });
      setValidationStates(prev => ({
        ...prev,
        [claim.conceptId]: { ...prev[claim.conceptId], status: 'answering' },
      }));
    },
  });

  const proceedMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/finalize-provisional`, {});
      return response;
    },
    onMutate: () => {
      setGenerationStep('provisional');
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({
        title: "Provisional ready!",
        description: "Your provisional patent is ready. You can generate diagrams from The Showcase.",
      });
      setLocation(`/project/${projectId}/agent/5`);
    },
    onError: (error: Error) => {
      setGenerationStep('idle');
      toast({
        title: "Generation failed",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  const skipPannuMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/finalize-provisional`, {});
      return response;
    },
    onMutate: () => {
      setGenerationStep('provisional');
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({
        title: "Provisional ready!",
        description: "Your provisional patent is ready. You can generate diagrams from The Showcase.",
      });
      setLocation(`/project/${projectId}/agent/5`);
    },
    onError: (error: Error) => {
      setGenerationStep('idle');
      toast({
        title: "Failed to generate showcase",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  const handleGenerateQuestions = (claim: ClaimForValidation) => {
    setValidationStates(prev => ({
      ...prev,
      [claim.conceptId]: { ...prev[claim.conceptId], status: 'generating' },
    }));
    generateQuestionsMutation.mutate(claim);
  };

  const handleSubmitAnswers = (claim: ClaimForValidation) => {
    const state = validationStates[claim.conceptId];
    const claimAnswers = currentAnswers[claim.conceptId] || {};
    
    if (!state?.questions) return;
    
    const answers = state.questions.map(q => ({
      factor: q.factor,
      answer: claimAnswers[q.factor] || '',
    }));

    const hasAnyAnswer = answers.some(a => a.answer.trim());
    if (!hasAnyAnswer) {
      toast({
        title: "Please answer at least one question",
        description: "Provide an answer to at least one factor before submitting.",
      });
      return;
    }

    setValidationStates(prev => ({
      ...prev,
      [claim.conceptId]: { ...prev[claim.conceptId], status: 'validating', answers },
    }));
    validateAnswersMutation.mutate({ claim, answers });
  };

  const toggleClaim = (claimId: string) => {
    const newExpanded = new Set(expandedClaims);
    if (newExpanded.has(claimId)) {
      newExpanded.delete(claimId);
    } else {
      newExpanded.add(claimId);
    }
    setExpandedClaims(newExpanded);
  };

  const updateAnswer = (conceptId: string, factor: string, value: string) => {
    setCurrentAnswers(prev => ({
      ...prev,
      [conceptId]: {
        ...prev[conceptId],
        [factor]: value,
      },
    }));
  };

  const getAiSuggestionMutation = useMutation({
    mutationFn: async ({ claim, question, factor, userDraft }: { claim: ClaimForValidation; question: string; factor: string; userDraft: string }) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/conception/ai-suggestion`, {
        keyConceptText: claim.claimText,
        question,
        factor,
        userDraft,
      });
      return response;
    },
    onSuccess: (data, { claim, factor }) => {
      setAiSuggestions(prev => ({
        ...prev,
        [claim.conceptId]: {
          ...prev[claim.conceptId],
          [factor]: data.suggestion,
        },
      }));
      setLoadingAiSuggestion(null);
      toast({
        title: "Rephrased",
        description: "Polished version below — edit and submit.",
      });
    },
    onError: (error: Error) => {
      setLoadingAiSuggestion(null);
      toast({
        title: "Rephrase failed",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  const handleAskAi = (claim: ClaimForValidation, question: string, factor: string) => {
    const key = `${claim.conceptId}-${factor}`;
    setLoadingAiSuggestion(key);
    const userDraft = currentAnswers[claim.conceptId]?.[factor] || "";
    getAiSuggestionMutation.mutate({ claim, question, factor, userDraft });
  };

  // ── Page snapshot for the AI Helper ─────────────────────────────────────
  // Pannu validation page. Per concept: status (pending/answering/certified/
  // needs_clarification/rejected/skipped), generated questions, and three
  // answer textareas (the editable surfaces — one per Pannu factor). The
  // helper can suggest which concept to tackle next and which textarea to
  // write into, but only when those textareas actually exist (i.e. after the
  // questions for that concept have been generated).
  const snapshot = useMemo<PageSnapshot>(() => {
    const items: NonNullable<PageSnapshot["items"]> = [];
    const drafts: Record<string, string> = {};
    const actions: NonNullable<PageSnapshot["actions"]> = [];

    // canProceed mirrors the same condition declared further down the
    // component file; we compute it inline here to avoid a temporal-dead-zone
    // reference (the original `canProceed` is declared after the early
    // return, which runs after this hook).
    const canProceedLocal =
      keyConceptsForValidation.length === 0 ||
      keyConceptsForValidation.some((c) => {
        const s = validationStates[c.conceptId]?.status;
        return s === "certified" || s === "needs_clarification" || s === "rejected";
      });

    keyConceptsForValidation.forEach((claim) => {
      const state = validationStates[claim.conceptId];
      const status = state?.status ?? "pending";
      const questions = state?.questions ?? [];
      const claimAnswers = currentAnswers[claim.conceptId] || {};

      items.push({
        id: `key_concept_${claim.number}`,
        type: "pannu_claim",
        status,
        editable: false,
        content: {
          conceptId: claim.conceptId,
          claimNumber: claim.number,
          claimText: claim.claimText,
          claimType: claim.type,
          certificationStatus: state?.certificationStatus ?? null,
          confidenceScore: state?.confidenceScore ?? null,
          factorsCovered: questions.map((q) => q.factor),
        },
      });

      questions.forEach((q) => {
        const fieldId = `pannu-${claim.conceptId}-${q.factor}`;
        const draftValue = claimAnswers[q.factor] || "";
        if (draftValue) drafts[fieldId] = draftValue;
        items.push({
          id: fieldId,
          type: "pannu_answer_field",
          status: draftValue ? "drafted" : "empty",
          editable: true,
          editTarget: fieldId,
          content: {
            forConceptId: claim.conceptId,
            forKeyConcept: `Key Concept ${claim.number}`,
            factor: q.factor,
            question: q.question,
            hint: q.hint ?? null,
            currentValue: draftValue,
          },
        });
      });

      // Per-claim actions reflect the actual stage of the per-claim card.
      if (status === "pending") {
        actions.push({
          id: `generate-questions-${claim.number}`,
          label: `Generate Questions for Key Concept ${claim.number}`,
          kind: "secondary",
          enabled: !generateQuestionsMutation.isPending,
        });
      } else if (status === "answering" && questions.length > 0) {
        actions.push({
          id: `ask-ai-${claim.number}`,
          label: `Ask AI for a draft on Key Concept ${claim.number}`,
          kind: "secondary",
          enabled: loadingAiSuggestion === null,
          reason: loadingAiSuggestion !== null ? "An AI suggestion is already in flight" : undefined,
        });
        const allAnswered = questions.every((q) => (claimAnswers[q.factor] || "").trim().length > 0);
        actions.push({
          id: `submit-answers-${claim.number}`,
          label: `Submit Answers for Key Concept ${claim.number}`,
          kind: "primary",
          enabled: allAnswered && !validateAnswersMutation.isPending,
          reason: !allAnswered ? "Not every factor has an answer yet" : undefined,
        });
        actions.push({
          id: `skip-${claim.number}`,
          label: `Skip Key Concept ${claim.number}`,
          kind: "secondary",
          enabled: true,
        });
      } else if (status === "needs_clarification" || status === "rejected") {
        actions.push({
          id: `retry-${claim.number}`,
          label: `Retry validation for Key Concept ${claim.number}`,
          kind: "secondary",
          enabled: true,
        });
      }
    });

    actions.push({
      id: "back-to-pannu-intro",
      label: "Back",
      kind: "secondary",
      enabled: true,
      navigatesTo: `/project/${projectId}/agent/4-conception-intro`,
    });
    actions.push({
      id: "skip-pannu",
      label: "Skip Inventorship Validation",
      kind: "secondary",
      enabled: !skipPannuMutation.isPending,
      navigatesTo: `/project/${projectId}/agent/5`,
      reason: skipPannuMutation.isPending ? "Skip in progress" : undefined,
    });
    actions.push({
      id: "finalize-provisional",
      label: "Finalize Provisional",
      kind: "primary",
      enabled: canProceedLocal && !proceedMutation.isPending,
      reason: !canProceedLocal
        ? "At least one key concept must reach a terminal status (certified, needs clarification, rejected, or skipped) before finalizing"
        : undefined,
      navigatesTo: `/project/${projectId}/agent/5`,
    });

    return {
      pageName: "Proof of Human Conception (Stage 4 — Pannu)",
      route: `/project/${projectId}/agent/4-conception`,
      description:
        "Per-key-concept inventorship validation. For each concept the user generates three factor questions, fills in the answer textareas (the only editable surfaces), then submits to receive a certification status.",
      items,
      drafts,
      actions,
      source: "structured",
    };
  }, [
    keyConceptsForValidation,
    validationStates,
    currentAnswers,
    generateQuestionsMutation.isPending,
    validateAnswersMutation.isPending,
    proceedMutation.isPending,
    skipPannuMutation.isPending,
    loadingAiSuggestion,
    projectId,
  ]);
  usePageSnapshot(snapshot);

  if (projectLoading || agent4Loading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (generationStep !== 'idle') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-md w-full mx-4 space-y-4">
          <Card>
            <CardContent className="pt-8 pb-8">
              <div className="flex flex-col items-center text-center space-y-6">
                <div className="relative">
                  <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                    <FileText className="h-10 w-10 text-primary" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-background border-2 border-primary flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                </div>

                <h2 className="text-xl font-semibold" data-testid="text-processing-title">Processing your invention details</h2>

                <p className="text-muted-foreground text-sm">
                  Our AI is organizing the invention details you provided into a structured draft document for your review and editing.
                </p>

                <div className="w-full text-left space-y-2">
                  {PROCESSING_STEPS.map((step, i) => (
                    <div
                      key={step}
                      className="flex items-center gap-2 transition-all duration-500 ease-out"
                      data-testid={`step-item-${i}`}
                      style={{
                        opacity: i < visibleSteps ? 1 : 0.55,
                        transform: i < visibleSteps ? "translateY(0) scale(1)" : "translateY(4px) scale(0.95)",
                      }}
                    >
                      {i < visibleSteps ? (
                        <CheckCircle2
                          className="h-4 w-4 shrink-0 transition-colors duration-500 text-green-600 dark:text-green-400"
                        />
                      ) : (
                        <Circle
                          className="h-4 w-4 shrink-0 transition-colors duration-500 text-muted-foreground"
                        />
                      )}
                      <span className={`text-sm transition-colors duration-500 ${
                        i < visibleSteps ? "text-foreground" : "text-muted-foreground"
                      }`}>
                        {step}
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-sm text-muted-foreground pt-2">
                  Your downloadable .docx draft will be ready shortly.
                </p>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground text-center px-4" data-testid="text-disclaimer">
            Geyser™ provisional drafting software helps inventors prepare their own patent application drafts. It does not provide legal advice.
          </p>
        </div>
      </div>
    );
  }

  const allCertified = keyConceptsForValidation.length > 0 &&
    keyConceptsForValidation.every(c => validationStates[c.conceptId]?.status === 'certified');

  // At least one concept validated (any terminal status) is enough to proceed.
  // Users can also Skip the whole step entirely.
  const canProceed = keyConceptsForValidation.length === 0 ||
    keyConceptsForValidation.some(c => {
      const s = validationStates[c.conceptId]?.status;
      return s === 'certified' || s === 'needs_clarification' || s === 'rejected';
    });

  const getStatusBadge = (status: ValidationState['status'], certificationStatus?: string) => {
    if (status === 'certified' && certificationStatus === 'Skipped') {
      return <Badge variant="secondary"><CheckCircle className="h-3 w-3 mr-1" />Skipped</Badge>;
    }
    switch (status) {
      case 'certified':
        return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Certified</Badge>;
      case 'needs_clarification':
        return <Badge variant="secondary" className="bg-yellow-600 text-white"><AlertCircle className="h-3 w-3 mr-1" />Needs Clarification</Badge>;
      case 'rejected':
        return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      case 'generating':
      case 'validating':
        return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Processing...</Badge>;
      case 'answering':
        return <Badge variant="outline"><HelpCircle className="h-3 w-3 mr-1" />Answer Questions</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const getFactorLabel = (factor: string) => {
    switch (factor.toLowerCase()) {
      case 'conception':
        return 'Conception';
      case 'quality':
        return 'Contribution Quality';
      case 'known_concepts':
        return 'Exceeding Known Concepts';
      default:
        return factor;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AgentHeader
        project={project}
        agentNumber={4}
        agentName="Proof of Human Conception - Inventorship Validation"
        agentDescription="Validate your contribution to each key concept under USPTO's inventorship criteria"
      />

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {keyConceptsForValidation.length === 0 ? (
          <Card className="border-muted">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Shield className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center mb-6">
                No key concepts selected for validation. Please go back and select key concepts.
              </p>
              <Button
                variant="default"
                onClick={() => setLocation(`/project/${projectId}/agent/4b`)}
                data-testid="button-back-to-claims"
              >
                Back to Key Concepts Selection
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Info Card */}
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">Proof of Human Conception</CardTitle>
                </div>
                <CardDescription>
                  Answer questions for each primary key concept to certify your inventorship under USPTO guidelines.
                  You must demonstrate significant contribution to conception, quality, and novel concepts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <Badge variant="secondary" data-testid="badge-progress">
                    {Object.values(validationStates).filter(s => s.status === 'certified').length} / {keyConceptsForValidation.length} Certified
                  </Badge>
                  {allCertified && (
                    <Badge variant="default" className="bg-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      All Key Concepts Certified
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Claims List */}
            <div className="space-y-4">
              {keyConceptsForValidation.map((claim, index) => {
                const state = validationStates[claim.conceptId] || { status: 'pending' };
                const isExpanded = expandedClaims.has(claim.id);
                const claimAnswers = currentAnswers[claim.conceptId] || {};

                return (
                  <Card key={claim.id} className="border-muted" data-testid={`card-claim-${index}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <CardTitle className="text-base">
                              Key Concept {claim.number}
                            </CardTitle>
                            {getStatusBadge(state.status, state.certificationStatus)}
                          </div>
                          <CardDescription className="text-sm line-clamp-2">
                            {claim.claimText.substring(0, 150)}...
                          </CardDescription>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleClaim(claim.id)}
                          data-testid={`button-toggle-claim-${index}`}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>
                    </CardHeader>

                    {isExpanded && (
                      <CardContent className="space-y-4 pt-0">
                        {/* Full Claim Text */}
                        <div className="p-3 bg-muted/50 rounded-md">
                          <p className="text-sm whitespace-pre-wrap">{claim.claimText}</p>
                        </div>

                        {/* No "Pending" or "Generating" states anymore —
                            the three POHC factors are static, so each
                            concept opens directly into the answering
                            state below with pre-fillable fields. */}

                        {/* Answering State - No Questions (Failed to load) - Show Retry */}
                        {(state.status === 'answering' || state.status === 'needs_clarification') && (!Array.isArray(state.questions) || state.questions.length === 0) && (
                          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-md border border-yellow-200 dark:border-yellow-800">
                            <div className="flex items-center gap-2 mb-3">
                              <AlertCircle className="h-5 w-5 text-yellow-600" />
                              <span className="font-medium text-yellow-700 dark:text-yellow-400">Questions failed to load</span>
                            </div>
                            <p className="text-sm text-yellow-700 dark:text-yellow-400 mb-3">
                              The validation questions could not be generated. You can retry or skip this key concept.
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => {
                                  setValidationStates(prev => ({
                                    ...prev,
                                    [claim.conceptId]: { status: 'pending' },
                                  }));
                                  handleGenerateQuestions(claim);
                                }}
                                disabled={generateQuestionsMutation.isPending}
                                data-testid={`button-retry-questions-${index}`}
                              >
                                {generateQuestionsMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                  <Shield className="h-4 w-4 mr-2" />
                                )}
                                Retry
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setValidationStates(prev => ({
                                    ...prev,
                                    [claim.conceptId]: { 
                                      ...prev[claim.conceptId], 
                                      status: 'certified',
                                      certificationStatus: 'Skipped',
                                      pannuRecordText: 'Validation skipped by user',
                                    },
                                  }));
                                }}
                                data-testid={`button-skip-${index}`}
                              >
                                Skip This Key Concept
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Answering State - Show Questions */}
                        {(state.status === 'answering' || state.status === 'needs_clarification') && Array.isArray(state.questions) && state.questions.length > 0 && (
                          <div className="space-y-4">
                            <h4 className="font-medium text-sm">Answer the following questions about your contribution:</h4>
                            {state.questions.map((q, qIndex) => {
                              const suggestionKey = `${claim.conceptId}-${q.factor}`;
                              const isLoadingSuggestion = loadingAiSuggestion === suggestionKey;
                              const suggestion = aiSuggestions[claim.conceptId]?.[q.factor];
                              const factorMeta = prefillMeta[claim.conceptId]?.[q.factor];
                              const sources = factorMeta?.sources || [];
                              const prefillDraft = factorMeta?.draft || "";
                              const hasPrefill = prefillDraft.trim().length > 0;
                              const currentText = claimAnswers[q.factor] || '';
                              const insertPrefill = () => {
                                if (!hasPrefill) return;
                                // Replace whatever is currently in the textarea
                                // with the pre-fill draft. We don't merge —
                                // if the user wants the old text back, the
                                // browser's undo (Ctrl+Z) works on textareas.
                                updateAnswer(claim.conceptId, q.factor, prefillDraft);
                              };

                              return (
                                <div key={q.factor} className="space-y-2 border-l-2 border-muted pl-3">
                                  <label className="text-sm font-medium">
                                    {qIndex + 1}. {getFactorLabel(q.factor)}
                                  </label>
                                  <p className="text-sm text-muted-foreground">{q.question}</p>
                                  {q.hint && (
                                    <p className="text-xs text-muted-foreground italic">{q.hint}</p>
                                  )}

                                  <Textarea
                                    value={currentText}
                                    onChange={(e) => updateAnswer(claim.conceptId, q.factor, e.target.value)}
                                    placeholder="Write your answer in your own words, or use what you already wrote earlier in the app."
                                    className="min-h-[100px]"
                                    data-testid={`textarea-answer-${index}-${qIndex}`}
                                  />

                                  {/* Source preview line — appears above the
                                      "Use what I already wrote" button so the
                                      user knows what's about to drop in.
                                      Repeated source labels collapse into
                                      "N <label>" so the line stays scannable
                                      when there are many ledger rows. */}
                                  {hasPrefill && (() => {
                                    const counts = new Map<string, number>();
                                    for (const s of sources) {
                                      counts.set(s.sourceLabel, (counts.get(s.sourceLabel) ?? 0) + 1);
                                    }
                                    const parts: string[] = [];
                                    for (const [label, count] of counts.entries()) {
                                      // Naive pluralization: append "s" when count > 1
                                      // and the label doesn't already end in "s".
                                      const plural =
                                        count > 1 && !/s$/i.test(label) ? `${label}s` : label;
                                      parts.push(count > 1 ? `${count} ${plural}` : label);
                                    }
                                    return (
                                      <p className="text-xs text-muted-foreground">
                                        From: {parts.join(" · ")}
                                      </p>
                                    );
                                  })()}

                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={insertPrefill}
                                      disabled={!hasPrefill}
                                      data-testid={`button-insert-prefill-${index}-${qIndex}`}
                                      title={
                                        hasPrefill
                                          ? "Insert what you typed about this earlier — you can still edit after"
                                          : "Nothing on file yet from earlier modules for this factor"
                                      }
                                    >
                                      {hasPrefill ? "Use what I already wrote" : "No earlier notes for this factor"}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleAskAi(claim, q.question, q.factor)}
                                      disabled={isLoadingSuggestion || !currentText.trim()}
                                      data-testid={`button-rephrase-${index}-${qIndex}`}
                                      title={
                                        !currentText.trim()
                                          ? "Write or insert something first — rephrase polishes what you've written"
                                          : "Rephrase the current text"
                                      }
                                    >
                                      {isLoadingSuggestion ? (
                                        <>
                                          <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                          Rephrasing...
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="h-3 w-3 mr-2" />
                                          Rephrase
                                        </>
                                      )}
                                    </Button>
                                  </div>

                                  {/* Rephraser output (polished version or
                                      "insufficient material" bullet list
                                      from the new prompt). */}
                                  {suggestion && (
                                    <div className="bg-primary/5 border border-primary/20 p-3 rounded-md">
                                      <div className="flex items-start gap-2 mb-2">
                                        <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                                        <span className="text-xs font-semibold text-primary">Rephrased version</span>
                                      </div>
                                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{suggestion}</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            <Button
                              onClick={() => handleSubmitAnswers(claim)}
                              className="w-full"
                              disabled={validateAnswersMutation.isPending}
                              data-testid={`button-submit-answers-${index}`}
                            >
                              {validateAnswersMutation.isPending ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Validating...
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="h-4 w-4 mr-2" />
                                  Submit for Validation
                                </>
                              )}
                            </Button>
                          </div>
                        )}

                        {/* Validating State */}
                        {state.status === 'validating' && (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                            <span className="text-muted-foreground">Validating your inventorship...</span>
                          </div>
                        )}

                        {/* Certified State */}
                        {state.status === 'certified' && (
                          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800">
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle className="h-5 w-5 text-green-600" />
                              <span className="font-medium text-green-700 dark:text-green-400">Inventorship Certified</span>
                              {state.confidenceScore && (
                                <Badge variant="outline" className="ml-auto">
                                  Score: {(parseFloat(state.confidenceScore) * 100).toFixed(0)}%
                                </Badge>
                              )}
                            </div>
                            {state.pannuRecordText && (
                              <p className="text-sm text-green-700 dark:text-green-400">{state.pannuRecordText}</p>
                            )}
                          </div>
                        )}

                        {/* Rejected State */}
                        {state.status === 'rejected' && (
                          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800">
                            <div className="flex items-center gap-2 mb-2">
                              <AlertCircle className="h-5 w-5 text-red-600" />
                              <span className="font-medium text-red-700 dark:text-red-400">Validation Failed</span>
                              {state.confidenceScore && (
                                <Badge variant="outline" className="ml-auto">
                                  Score: {(parseFloat(state.confidenceScore) * 100).toFixed(0)}%
                                </Badge>
                              )}
                            </div>
                            {state.pannuRecordText && (
                              <p className="text-sm text-red-700 dark:text-red-400 mb-3">{state.pannuRecordText}</p>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setValidationStates(prev => ({
                                  ...prev,
                                  [claim.conceptId]: { ...prev[claim.conceptId], status: 'answering' },
                                }));
                              }}
                              data-testid={`button-retry-${index}`}
                            >
                              Revise Answers
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between gap-4 pt-4">
              <Button
                variant="outline"
                onClick={() => setLocation(`/project/${projectId}/agent/4-conception-intro`)}
                data-testid="button-back"
              >
                Back to Introduction
              </Button>

              <div className="flex items-center gap-3">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={skipPannuMutation.isPending}
                      data-testid="button-skip-pannu"
                    >
                      {skipPannuMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Skipping...
                        </>
                      ) : (
                        <>
                          <SkipForward className="h-4 w-4 mr-2" />
                          Skip Proof of Human Conception
                        </>
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Skip Inventorship Validation?</AlertDialogTitle>
                      <AlertDialogDescription className="space-y-2">
                        <p>
                          Proof of Human Conception validates your inventorship contribution under USPTO requirements.
                          Skipping this step means you won't have documentation of your inventorship.
                        </p>
                        <p className="font-medium text-foreground">
                          You can continue without completing this validation, but completing it produces more accurate inventorship documentation in your draft.
                        </p>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-skip">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => skipPannuMutation.mutate()}
                        data-testid="button-confirm-skip"
                      >
                        Skip and Continue
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Button
                  variant="default"
                  size="lg"
                  onClick={() => proceedMutation.mutate()}
                  disabled={!canProceed || proceedMutation.isPending}
                  data-testid="button-continue"
                >
                  {proceedMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating Draft...
                    </>
                  ) : (
                    <>
                      Generate Provisional Draft
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

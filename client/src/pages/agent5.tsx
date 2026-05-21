import { useEffect, useRef, useState, useMemo, lazy, Suspense } from "react";
import { usePageSnapshot, type PageSnapshot } from "@/lib/page-snapshot";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ReactMarkdown from "react-markdown";
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
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
const MDEditor = lazy(() => import('@uiw/react-md-editor'));
import { Loader2, Download, FileText, Image as ImageIcon, CheckCircle2, Save, RefreshCw, ExternalLink, Pencil, Users, ArrowRight, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Project } from "@shared/schema";
import { recordHumanInput } from "@/lib/human-inputs";

export default function Agent5() {
  const [, params] = useRoute("/project/:id/agent/5");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [showDownloadWarning, setShowDownloadWarning] = useState(false);
  const [activeSpecSection, setActiveSpecSection] = useState('title');
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Genus & Species workflow inline state
  const [gsGate1Decisions, setGsGate1Decisions] = useState<Record<string, { decision: "approved" | "rejected"; editedText?: string }>>({});
  const [gsGate2Decisions, setGsGate2Decisions] = useState<Record<string, { decision: "approved" | "edited" | "rejected"; editedText?: string }>>({});
  const [gsExpandedArtifact, setGsExpandedArtifact] = useState<string | null>(null);

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent5Data } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "agent", 5],
    enabled: !!projectId,
  });

  const { data: agent4Data } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "agent", 4],
    enabled: !!projectId,
  });

  const { data: specSections, isLoading: specSectionsLoading } = useQuery<{ key: string; label: string; content: string }[]>({
    queryKey: ["/api/projects", projectId, "specification-sections"],
    enabled: !!projectId,
  });

  // Genus & Species workflow status.
  // Primary source: agent5Data (already fetched). When a stage is actively
  // running we also poll the dedicated status endpoint every 4s so the UI
  // updates without the user having to refresh.
  const gsStatusFromAgent5 = (agent5Data as any)?.data?.genusSpecies ?? (agent5Data as any)?.genusSpecies;
  const gsIsRunning = ["running_stage1","running_stage2","running_stage3","running_stage4"].includes(gsStatusFromAgent5?.status);

  // Local "I just kicked off a run" flag. The server now runs stages
  // synchronously inside /start and /approve-species, so those mutations can
  // take 30s–3min to resolve. Without this flag, polling wouldn't start until
  // agent5Data refetched and showed running_*, leaving the detailed status
  // card hidden behind the bare mutation spinner for the entire wait.
  // Mutations toggle this on onMutate and off on onSettled.
  const [gsRunInFlight, setGsRunInFlight] = useState(false);
  const gsShouldPoll = gsIsRunning || gsRunInFlight;

  const { data: gsStatusPolled } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "genus-species-status"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/genus-species/status`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectId && gsShouldPoll,
    refetchInterval: 4000,
  });

  // When polling detects a transition to a stable state, invalidate agent5Data
  // so the primary source picks up the completed state.
  useEffect(() => {
    if (!gsStatusPolled) return;
    const stillRunning = ["running_stage1","running_stage2","running_stage3","running_stage4"].includes(gsStatusPolled.status);
    if (!stillRunning) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
    }
  }, [gsStatusPolled?.status]);

  // Use polled data while running or while a mutation is in flight, fall back
  // to agent5 data otherwise.
  const gsStatus = (gsShouldPoll && gsStatusPolled) ? gsStatusPolled : gsStatusFromAgent5;

  // Cycling status messages — rotate every 4s so the UI feels alive while a stage runs.
  // The backend reports stage-level state only; this gives users per-agent visibility.
  const gsStageMessages: Record<string, string[]> = {
    running_stage1: [
      "Reading your invention's core mechanism…",
      "Identifying the underlying paradigm-neutral pattern…",
      "Extracting input, transformation, and output flow…",
      "Validating the genus across multiple architectures…",
    ],
    running_stage2: [
      "Designing an AI-assisted implementation…",
      "Designing an AI-native implementation…",
      "Designing an agentic implementation…",
      "Synthesising architectural data flows…",
      "Identifying key components for each species…",
    ],
    running_stage3: [
      "Broadening your existing key concepts…",
      "Adding a genus-mechanism concept…",
      "Adding a species-spectrum concept…",
      "Adding a hardware-optimization concept…",
      "Extending the Background section with prior-art context…",
      "Extending the Summary section to cover broadened scope…",
      "Extending the Detailed Description with new subsections…",
      "Cross-checking that no original meaning was lost…",
    ],
    running_stage4: [
      "Drafting the new abstract…",
      "Checking the word budget…",
      "Ensuring all approved species are covered…",
    ],
  };
  const [gsMessageIndex, setGsMessageIndex] = useState(0);
  const [gsStageStartedAt, setGsStageStartedAt] = useState<number | null>(null);
  const [gsElapsedSec, setGsElapsedSec] = useState(0);

  // Reset message index + start timer whenever the stage changes
  useEffect(() => {
    if (gsStatus?.status && gsStageMessages[gsStatus.status]) {
      setGsMessageIndex(0);
      setGsStageStartedAt(Date.now());
    } else {
      setGsStageStartedAt(null);
      setGsElapsedSec(0);
    }
  }, [gsStatus?.status]);

  // Rotate the message every 4s and tick the elapsed counter every second
  useEffect(() => {
    if (!gsStageStartedAt) return;
    const msgTimer = setInterval(() => {
      const msgs = gsStageMessages[gsStatus?.status] || [];
      if (msgs.length > 0) setGsMessageIndex((i) => (i + 1) % msgs.length);
    }, 4000);
    const tickTimer = setInterval(() => {
      setGsElapsedSec(Math.floor((Date.now() - gsStageStartedAt) / 1000));
    }, 1000);
    return () => { clearInterval(msgTimer); clearInterval(tickTimer); };
  }, [gsStageStartedAt, gsStatus?.status]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const gsStartMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/projects/${projectId}/genus-species/start`, {}),
    onMutate: () => { setGsRunInFlight(true); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
    },
    onSettled: () => { setGsRunInFlight(false); },
    onError: (e: Error) => toast({ title: "Couldn't start expansion", description: e.message }),
  });

  const gsApproveSpeciesMutation = useMutation({
    mutationFn: async () => {
      const approvals = Object.entries(gsGate1Decisions).map(([species_type, d]) => ({
        species_type,
        decision: d.decision,
        editedText: d.editedText,
      }));
      return apiRequest("POST", `/api/projects/${projectId}/genus-species/approve-species`, { approvals });
    },
    onMutate: () => { setGsRunInFlight(true); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
    },
    onSettled: () => { setGsRunInFlight(false); },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message }),
  });

  const gsFinalizeMutation = useMutation({
    mutationFn: async () => {
      const approvals: Record<string, string> = {};
      const edits: Record<string, string> = {};
      for (const [id, d] of Object.entries(gsGate2Decisions)) {
        approvals[id] = d.decision;
        if (d.editedText) edits[id] = d.editedText;
      }
      // Ledger: every edited artifact represents user-authored text that
      // refines the AI-broadened material. Capture each edit as a separate
      // proof-of-conception row, keyed by artifact id.
      for (const [id, editedText] of Object.entries(edits)) {
        if (typeof editedText !== "string" || !editedText.trim()) continue;
        void recordHumanInput({
          projectId,
          source: "module5/genus-species-edit",
          sourceRefId: id,
          promptText: "User-edited Genus & Species artifact",
          answerText: editedText,
          tags: ["implementation_detail", "differentiation"],
        });
      }
      return apiRequest("POST", `/api/projects/${projectId}/genus-species/finalize`, { approvals, edits });
    },
    onSuccess: () => {
      toast({ title: "Expansion finalized", description: "Your provisional draft has been broadened." });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "specification-sections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "genus-species-status"] });
    },
    onError: (e: Error) => toast({ title: "Finalization failed", description: e.message }),
  });

  // Per-artifact regeneration — surfaced as a "Regenerate" button on every
  // Gate 2 card. Used when an individual broadening/appending/extension came
  // back empty (rare after the JSON parse retry, but still possible) or when
  // the user just wants a different take.
  const [gsRegenInFlight, setGsRegenInFlight] = useState<Record<string, boolean>>({});
  const regenerateArtifactMutation = useMutation({
    mutationFn: async (artifactId: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/genus-species/regenerate-artifact`, { artifactId });
      return { artifactId, res };
    },
    onMutate: (artifactId: string) => {
      setGsRegenInFlight((p) => ({ ...p, [artifactId]: true }));
    },
    onSuccess: (_data, artifactId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "genus-species-status"] });
      toast({ title: "Regenerated", description: "Refreshing card…" });
    },
    onError: (e: Error, artifactId) => {
      toast({ title: "Regeneration failed", description: e.message });
    },
    onSettled: (_data, _err, artifactId) => {
      setGsRegenInFlight((p) => { const n = { ...p }; delete n[artifactId]; return n; });
    },
  });

  const applyToDraftMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/genus-species/apply-to-draft`, {}),
    onSuccess: () => {
      toast({ title: "Draft updated", description: "Your provisional draft has been updated with the expanded content." });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "specification-sections"] });
    },
    onError: (e: Error) => toast({ title: "Failed to apply to draft", description: e.message }),
  });

  const saveSpecSectionMutation = useMutation({
    mutationFn: async ({ section, content }: { section: string; content: string }) => {
      await apiRequest("POST", `/api/projects/${projectId}/update-specification-section`, { section, content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "specification-sections"] });
      setEditingSection(null);
      toast({
        title: "Section saved",
        description: "Your changes have been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Couldn't save section",
        description: "Please try again in a moment.",
      });
    },
  });

  // Navigation guard: Block skipping ahead, allow backward navigation
  useEffect(() => {
    if (!project) return;
    
    // Only redirect if trying to skip ahead (stage < 5)
    if (project.currentStage < 5) {
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

  const saveMutation = useMutation({
    mutationFn: async (reviewed: boolean) => {
      await apiRequest("POST", `/api/projects/${projectId}/agent/5`, { reviewed });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
    },
  });

  const hasMarkedReviewed = useRef(false);
  useEffect(() => {
    if (agent5Data && !hasMarkedReviewed.current) {
      hasMarkedReviewed.current = true;
      const timer = setTimeout(() => {
        saveMutation.mutate(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [agent5Data]);

  // Per-diagram regeneration — surfaced on every diagram card so users can
  // recover a single failed render without rerunning the planner and
  // re-rendering the other diagrams. Mirrors the per-artifact Regenerate
  // flow on the G&S Gate 2 panel.
  const [gsDiagramRegenInFlight, setGsDiagramRegenInFlight] = useState<Record<number, boolean>>({});
  const regenerateDiagramMutation = useMutation({
    mutationFn: async (chartNumber: number) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/regenerate-diagram`, { chartNumber });
      return { chartNumber, res };
    },
    onMutate: (chartNumber: number) => {
      setGsDiagramRegenInFlight((p) => ({ ...p, [chartNumber]: true }));
    },
    onSuccess: (_d, chartNumber) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
      toast({ title: "Diagram regenerated", description: `Diagram ${chartNumber} refreshed.` });
    },
    onError: (e: Error, chartNumber) => {
      toast({ title: `Diagram ${chartNumber} regeneration failed`, description: e.message });
    },
    onSettled: (_d, _e, chartNumber) => {
      setGsDiagramRegenInFlight((p) => { const n = { ...p }; delete n[chartNumber]; return n; });
    },
  });

  const generateDiagramsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/generate-showcase`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
      toast({
        title: "Diagrams generated!",
        description: "Your technical diagrams are ready.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't generate diagrams",
        description: "Please try again in a moment.",
      });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/complete`, {});
    },
    onSuccess: async () => {
      // Wait for project data to refetch before navigating
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      await queryClient.refetchQueries({ queryKey: ["/api/projects", projectId] });
      
      toast({
        title: "Project completed!",
        description: "Your draft is ready.",
      });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't complete",
        description: "Please try again in a moment.",
      });
    },
  });

  const exportPDFMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/export-pdf`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to export PDF");
      }
      return await response.blob();
    },
    onSuccess: (blob: Blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `patent-${project?.title || projectId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast({
        title: "PDF exported!",
        description: "Your patent draft has been downloaded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't export PDF",
        description: "Please try again in a moment.",
      });
    },
  });

  // PoHC export — the private inventorship-record DOCX. Carries a red
  // "do not upload this file with your patent" warning inside.
  const exportPohcMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/export-pohc-docx`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to export PoHC");
      return await response.blob();
    },
    onSuccess: (blob: Blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `pohc-${project?.title || projectId}.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast({
        title: "PoHC record downloaded",
        description: "Keep this file private — do not upload it with your patent.",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Couldn't export PoHC", description: e.message });
    },
  });

  const exportDOCXMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/export-docx`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to export DOCX");
      }
      return await response.blob();
    },
    onSuccess: (blob: Blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `patent-${project?.title || projectId}.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast({
        title: "DOCX exported!",
        description: "Your patent draft has been downloaded as a Word document.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't export DOCX",
        description: "Please try again in a moment.",
      });
    },
  });

  const regenerateDraftMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/regenerate-draft`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 4] });
      toast({
        title: "Draft regenerated!",
        description: "Your provisional draft has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't regenerate draft",
        description: "Please try again in a moment.",
      });
    },
  });

  // ── Page snapshot for the AI Helper ─────────────────────────────────────
  // Stage 5 is the Showcase. Spec sections are individually editable (one
  // at a time via Pencil button → MDEditor → Save). Diagrams are read-only
  // image cards. Top-level actions: generate/regenerate diagrams, download
  // (PDF/DOCX), regenerate the whole draft, go to practitioner page,
  // complete project.
  const snapshot = useMemo<PageSnapshot>(() => {
    const a5 = agent5Data as any;
    const sections = (specSections || []) as Array<{ key: string; label: string; content: string }>;
    const diagrams = (a5?.diagrams || a5?.data?.diagrams || []) as any[];
    const gs = gsStatus as any;
    const gsStatusStr: string = gs?.status || "idle";

    const items: NonNullable<PageSnapshot["items"]> = [];
    const drafts: Record<string, string> = {};

    // ── Genus & Species items ─────────────────────────────────────────
    // Surface enough state that the AI Helper can answer questions like
    // "what's G&S doing right now?", "should I keep this broadened concept?",
    // "why is this artifact empty?", "what's the difference between species?"
    items.push({
      id: "genus_species_workflow",
      type: "workflow",
      status: gsStatusStr as any,
      editable: false,
      content: {
        label: "Genus & Species Expansion",
        statusDescription: ({
          idle: "Not started — user can run G&S to broaden their key concepts.",
          running_stage1: "Stage 1 of 4: Extracting the core paradigm-neutral genus from the invention.",
          running_stage2: "Stage 2 of 4: Synthesising AI-assisted, AI-native, and agentic species implementations.",
          awaiting_gate1: "Awaiting user approval of species at Gate 1.",
          running_stage3: "Stage 3 of 4: Broadening each existing key concept and extending the Background/Summary/Detailed Description sections.",
          running_stage4: "Stage 4 of 4: Rewriting the abstract to cover the broadened scope.",
          awaiting_gate2: "Awaiting user approval of broadened artifacts at Gate 2 (Keep / Edit / Remove / Regenerate per item).",
          complete: "Complete — final expanded spec has been written into the provisional draft.",
          error: "Failed — see error message and re-run.",
        } as Record<string, string>)[gsStatusStr] || gsStatusStr,
        genusName: gs?.genus?.genus_name ?? null,
        speciesCount: Array.isArray(gs?.species) ? gs.species.length : 0,
        approvedSpeciesCount: Array.isArray(gs?.approvedSpecies) ? gs.approvedSpecies.length : 0,
        broadeningsCount: Array.isArray(gs?.broadenings) ? gs.broadenings.length : 0,
        broadeningsEmpty: Array.isArray(gs?.broadenings)
          ? gs.broadenings.filter((b: any) => !b?.broadened_concept_text).length
          : 0,
        appendingsCount: Array.isArray(gs?.appendings) ? gs.appendings.length : 0,
        appendingsEmpty: Array.isArray(gs?.appendings)
          ? gs.appendings.filter((a: any) => !a?.key_concept_text).length
          : 0,
        hasBackgroundExtension: !!(gs?.backgroundExtension?.additional_paragraphs || (typeof gs?.backgroundExtension === "string" && gs.backgroundExtension)),
        hasSummaryExtension: !!(gs?.summaryExtension?.additional_paragraphs || (typeof gs?.summaryExtension === "string" && gs.summaryExtension)),
        hasAbstractRewrite: !!gs?.abstractRewrite?.abstract_text,
        abstractWordCount: gs?.abstractRewrite?.word_count ?? null,
        error: gs?.error ?? null,
      },
    });

    // At Gate 1, list the species cards being reviewed
    if (gsStatusStr === "awaiting_gate1" && Array.isArray(gs?.species)) {
      gs.species.forEach((s: any, i: number) => {
        items.push({
          id: `gs_species_${s?.species_type || i}`,
          type: "gs_species",
          editable: false,
          content: {
            species_type: s?.species_type,
            failed: !!s?.failed,
            architectural_description_length: typeof s?.architectural_description === "string" ? s.architectural_description.length : 0,
          },
        });
      });
    }

    // At Gate 2, list every artifact being reviewed (with which are empty)
    if (gsStatusStr === "awaiting_gate2") {
      (gs?.broadenings || []).forEach((b: any, i: number) => {
        items.push({
          id: `gs_broadening_${i}`,
          type: "gs_artifact",
          editable: false,
          content: {
            kind: "broadening",
            original_key_concept: b?.original_key_concept ?? null,
            empty: !b?.broadened_concept_text,
            length: typeof b?.broadened_concept_text === "string" ? b.broadened_concept_text.length : 0,
          },
        });
      });
      (gs?.appendings || []).forEach((a: any, i: number) => {
        items.push({
          id: `gs_appending_${i}`,
          type: "gs_artifact",
          editable: false,
          content: {
            kind: "appending",
            concept_aspect: a?.concept_aspect,
            empty: !a?.key_concept_text,
            length: typeof a?.key_concept_text === "string" ? a.key_concept_text.length : 0,
          },
        });
      });
      if (gs?.backgroundExtension) {
        items.push({ id: "gs_background_extension", type: "gs_artifact", editable: false, content: { kind: "background_extension", empty: !(gs.backgroundExtension.additional_paragraphs || (typeof gs.backgroundExtension === "string" && gs.backgroundExtension)) } });
      }
      if (gs?.summaryExtension) {
        items.push({ id: "gs_summary_extension", type: "gs_artifact", editable: false, content: { kind: "summary_extension", empty: !(gs.summaryExtension.additional_paragraphs || (typeof gs.summaryExtension === "string" && gs.summaryExtension)) } });
      }
      if (gs?.abstractRewrite) {
        items.push({ id: "gs_abstract", type: "gs_artifact", editable: false, content: { kind: "abstract_rewrite", word_count: gs.abstractRewrite.word_count ?? null, empty: !gs.abstractRewrite.abstract_text } });
      }
    }

    sections.forEach((sec) => {
      const isEditing = editingSection === sec.key;
      if (isEditing) drafts[`spec-${sec.key}`] = editContent;
      items.push({
        id: `spec_section_${sec.key}`,
        type: "spec_section",
        status: isEditing ? "editing" : "saved",
        editable: true,
        editTarget: `spec-${sec.key}`,
        content: {
          label: sec.label,
          length: typeof sec.content === "string" ? sec.content.length : 0,
        },
      });
    });

    diagrams.forEach((d: any, i: number) => {
      items.push({
        id: `diagram_${i + 1}`,
        type: "diagram",
        editable: false,
        content: { caption: d.caption ?? d.title ?? null, url: d.url ?? d.imageUrl ?? null },
      });
    });

    const actions: NonNullable<PageSnapshot["actions"]> = [];

    // ── Genus & Species actions ───────────────────────────────────────
    if (gsStatusStr === "idle" || gsStatusStr === "error") {
      actions.push({
        id: "run-genus-species",
        label: "Run Genus & Species Expansion",
        kind: "primary",
        enabled: !gsStartMutation.isPending,
        reason: gsStatusStr === "error" ? `Previous run failed: ${gs?.error || "unknown"}` : undefined,
      });
    }
    if (gsStatusStr === "awaiting_gate1") {
      actions.push({
        id: "approve-species",
        label: "Approve species and continue to Stage 3",
        kind: "primary",
        enabled: !gsApproveSpeciesMutation.isPending,
        reason: "User must Keep / Edit / Remove each species card before clicking",
      });
    }
    if (gsStatusStr === "awaiting_gate2") {
      actions.push({
        id: "finalize-expansion",
        label: "Finalize Expansion (writes approved content into provisional draft)",
        kind: "primary",
        enabled: !gsFinalizeMutation.isPending,
      });
      actions.push({
        id: "regenerate-artifact",
        label: "Regenerate a single artifact (per-card button)",
        kind: "secondary",
        enabled: true,
        reason: "Use when an artifact came back empty or the user wants a different take",
      });
    }
    if (gsStatusStr === "complete") {
      actions.push({
        id: "apply-to-draft",
        label: "Apply expansion to Provisional Draft",
        kind: "secondary",
        enabled: !applyToDraftMutation.isPending,
      });
    }
    if (gsStatusStr !== "idle") {
      actions.push({
        id: "reset-genus-species",
        label: "Reset Genus & Species workflow",
        kind: "destructive",
        enabled: true,
        reason: "Clears all G&S state and returns to idle so the user can start over",
      });
    }

    if (editingSection) {
      actions.push({
        id: `save-spec-section`,
        label: `Save changes to "${editingSection}"`,
        kind: "primary",
        enabled: !saveSpecSectionMutation.isPending,
      });
      actions.push({
        id: `cancel-spec-edit`,
        label: `Cancel edit`,
        kind: "secondary",
        enabled: true,
      });
    } else {
      sections.forEach((sec) => {
        actions.push({
          id: `edit-spec-${sec.key}`,
          label: `Edit section: ${sec.label}`,
          kind: "secondary",
          enabled: true,
        });
      });
    }
    actions.push({
      id: "generate-diagrams",
      label: diagrams.length > 0 ? "Regenerate Diagrams" : "Generate Diagrams",
      kind: "secondary",
      enabled: !generateDiagramsMutation.isPending,
    });
    actions.push({
      id: "download-pdf",
      label: "Download PDF",
      kind: "secondary",
      enabled: !exportPDFMutation.isPending,
    });
    actions.push({
      id: "download-docx",
      label: "Download DOCX",
      kind: "secondary",
      enabled: !exportDOCXMutation.isPending,
    });
    actions.push({
      id: "regenerate-draft",
      label: "Regenerate Full Draft",
      kind: "destructive",
      enabled: !regenerateDraftMutation.isPending,
      reason: "Regenerating overwrites edits — confirm via the dialog",
    });
    actions.push({
      id: "find-practitioner",
      label: "Find a Patent Practitioner",
      kind: "secondary",
      enabled: true,
      navigatesTo: `/project/${projectId}/agent/5-practitioner`,
    });
    actions.push({
      id: "complete-project",
      label: "Complete & Return to Dashboard",
      kind: "primary",
      enabled: !completeMutation.isPending,
      navigatesTo: `/`,
    });

    return {
      pageName: "The Showcase (Stage 5)",
      route: `/project/${projectId}/agent/5`,
      description:
        "User reviews and finalizes the provisional draft. The page hosts the Genus & Species Expansion workflow (Stage 1 genus extraction → Stage 2 species synthesis → Gate 1 approve species → Stage 3 broaden key concepts + extend sections → Stage 4 rewrite abstract → Gate 2 approve artifacts → Apply to draft), per-section editing of the provisional draft, technical diagram generation, and downloads. The G&S workflow item carries the current status and counts; at Gate 1 the species cards are listed; at Gate 2 every broadening/appending/extension/abstract is listed with whether it came back empty.",
      items,
      drafts,
      actions,
      source: "structured",
    };
  }, [
    agent5Data,
    specSections,
    editingSection,
    editContent,
    gsStatus,
    gsStartMutation.isPending,
    gsApproveSpeciesMutation.isPending,
    gsFinalizeMutation.isPending,
    applyToDraftMutation.isPending,
    saveSpecSectionMutation.isPending,
    generateDiagramsMutation.isPending,
    exportPDFMutation.isPending,
    exportDOCXMutation.isPending,
    regenerateDraftMutation.isPending,
    completeMutation.isPending,
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

  const agent5Obj = agent5Data?.data || {};
  const agent4Obj = agent4Data?.data || {};
  
  // Handle both array and object formats for diagrams
  let diagrams: any[] = [];
  if (agent5Obj?.diagrams) {
    diagrams = Array.isArray(agent5Obj.diagrams) ? agent5Obj.diagrams : [agent5Obj.diagrams];
  }

  // Helper to parse and format claims for display
  const parseClaimsForDisplay = (claims: any): string[] => {
    if (!claims) return [];
    
    // If it's already an array of claim objects with .text (new structured format)
    if (Array.isArray(claims)) {
      if (claims.length > 0 && claims[0]?.text && claims[0]?.number !== undefined) {
        return claims
          .sort((a: any, b: any) => (a.number || 0) - (b.number || 0))
          .map((c: any) => c.text);
      }
      return claims.map((c: any) => typeof c === 'string' ? c : c.text || c.claim || JSON.stringify(c));
    }
    
    // If it's a string (could be JSON or plain text)
    if (typeof claims === 'string') {
      try {
        const parsed = JSON.parse(claims);
        return parseClaimsForDisplay(parsed);
      } catch {
        return extractClaimsFromText(claims);
      }
    }
    
    // If it's an object with structured claims array (new webhook format: { summary, claims: [...] })
    if (claims.claims && Array.isArray(claims.claims) && claims.claims.length > 0 && claims.claims[0]?.text) {
      return claims.claims
        .sort((a: any, b: any) => (a.number || 0) - (b.number || 0))
        .map((c: any) => c.text);
    }
    
    // If it's an object with output property (current webhook format: { output: "1. A system..." })
    if (claims.output && typeof claims.output === 'string') {
      return extractClaimsFromText(claims.output);
    }
    
    // If it's an object with claims_only property (legacy webhook format)
    if (claims.claims_only && typeof claims.claims_only === 'string') {
      return extractClaimsFromText(claims.claims_only);
    }
    
    // If it's an object with claims property (generic)
    if (claims.claims) {
      return parseClaimsForDisplay(claims.claims);
    }
    
    // If it's an object with text property
    if (claims.text) {
      return extractClaimsFromText(claims.text);
    }
    
    // Fallback: stringify
    return [JSON.stringify(claims, null, 2)];
  };
  
  // Helper to extract individual claims from a text block
  const extractClaimsFromText = (text: string): string[] => {
    if (!text) return [];
    
    let cleanText = text;
    
    // Truncate at known non-claim sections that follow the claims
    const sectionCutoffs = [
      /\n#{1,4}\s*\d*\.?\s*Support\s*Map/i,
      /\n#{1,4}\s*\d*\.?\s*Risk\s*Analysis/i,
      /\n#{1,4}\s*\d*\.?\s*Broadening\s*Rationale/i,
      /\n#{1,4}\s*\d*\.?\s*Execution\s*Notes/i,
      /\n#{1,4}\s*\d*\.?\s*Processing\s*Status/i,
      /\n---+\s*\n/,
    ];
    
    for (const pattern of sectionCutoffs) {
      const match = cleanText.search(pattern);
      if (match > 0) {
        cleanText = cleanText.substring(0, match);
      }
    }
    
    // Remove intro text before first claim
    const introPatterns = [
      /^[\s\S]*?(?=\*\*Claim\s*1)/i,
      /^[\s\S]*?(?=Claim\s*1[:.]\s)/i,
      /^[\s\S]*?(?=1\.\s+A\s+)/i,
    ];
    
    for (const pattern of introPatterns) {
      const match = cleanText.match(pattern);
      if (match && match[0].length < cleanText.length * 0.5) {
        cleanText = cleanText.substring(match[0].length);
        break;
      }
    }
    
    // Try to split by claim markers
    // Pattern 1: **Claim N:** or **Claim N:**
    const claimPattern1 = /\*\*Claim\s*\d+[:.]\*?\*?/gi;
    // Pattern 2: Claim N: 
    const claimPattern2 = /(?:^|\n)Claim\s*\d+\s*:/gi;
    // Pattern 3: Numbered list like "1. A system..." or "1." at start
    const claimPattern3 = /(?:^|\n)\d+\.\s+/g;
    
    let claims: string[] = [];
    
    // Try splitting by **Claim N** pattern first
    if (claimPattern1.test(cleanText)) {
      claims = cleanText.split(/\*\*Claim\s*\d+[:.]\*?\*?\s*/i)
        .map(c => c.trim())
        .filter(c => c.length > 20);
    } 
    // Try splitting by "Claim N:" pattern
    else if (claimPattern2.test(cleanText)) {
      claims = cleanText.split(/(?:^|\n)Claim\s*\d+\s*:\s*/i)
        .map(c => c.trim())
        .filter(c => c.length > 20);
    }
    // Try splitting by numbered list
    else if (claimPattern3.test(cleanText)) {
      claims = cleanText.split(/(?:^|\n)\d+\.\s+/)
        .map(c => c.trim())
        .filter(c => c.length > 20);
    }
    // Fall back to splitting by double newlines
    else {
      claims = cleanText.split(/\n\n+/)
        .map(c => c.trim())
        .filter(c => c.length > 20);
    }
    
    // Clean up each claim - remove markdown formatting and bullet asterisks
    return claims.map(claim => {
      return claim
        .replace(/\*\*/g, '')
        .replace(/\\n/g, '\n')
        // Remove ALL asterisks that appear to be bullets (asterisk + any whitespace)
        // This catches: "comprising:* a", ";* a", "and* a", "  * a" etc.
        .replace(/\*\s+/g, ' ')
        // Also remove asterisks at start of lines 
        .replace(/^\s*[-*]\s*/gm, '')
        // Clean up any leftover standalone asterisks followed by text
        .replace(/\s\*\s/g, ' ')
        // Normalize multiple spaces to single space
        .replace(/\s{2,}/g, ' ')
        .trim();
    }).filter(c => c.length > 0);
  };

  const specificKeyConceptsFormatted = parseClaimsForDisplay(agent5Obj?.specificKeyConcepts || agent4Obj?.selectedKeyConcepts);
  const hasKeyConcepts = specificKeyConceptsFormatted.length > 0 || (Array.isArray(agent4Obj?.selectedKeyConcepts) && agent4Obj.selectedKeyConcepts.length > 0);

  // Function to download diagram image
  const downloadDiagram = async (imageUrl: string, title: string, chartNumber: number) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diagram-${chartNumber}-${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Diagram saved",
        description: `Downloaded "${title}"`,
      });
    } catch (error) {
      toast({
        title: "Download didn't work",
        description: "Try opening the diagram in a new tab instead.",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AgentHeader
        project={project}
        agentNumber={5}
        agentName="The Showcase"
        agentDescription="Your provisional patent application draft"
      />

      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-12">
        <div className="space-y-8 sm:space-y-12">
          <div className="text-center space-y-3 sm:space-y-4 py-4 sm:py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/10 mb-2 sm:mb-4">
              <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10 text-primary" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold">Provisional Draft Ready for Review!</h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl mx-auto px-2">
              Download your draft to review it and export for practitioner review.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 justify-center pt-4 px-2">
              <Button
                size="lg"
                className="w-full sm:w-auto text-base"
                data-testid="button-broaden-coverage"
                onClick={() => gsStartMutation.mutate()}
                disabled={gsStartMutation.isPending || gsIsRunning}
              >
                {(gsStartMutation.isPending || gsIsRunning) ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Running Genus & Species Expansion…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-5 w-5 mr-2" />
                    Genus & Species Expansion
                  </>
                )}
              </Button>
              {/* Generate Diagrams — only active after Genus & Species is complete */}
              {(() => {
                const gsComplete = gsStatus?.status === "complete";
                const diagramsDisabled = generateDiagramsMutation.isPending || !gsComplete;
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="w-full sm:w-auto">
                        <Button
                          size="lg"
                          className="w-full text-base"
                          data-testid="button-generate-diagrams-header"
                          onClick={() => generateDiagramsMutation.mutate()}
                          disabled={diagramsDisabled}
                        >
                          {generateDiagramsMutation.isPending ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Generating Diagrams...
                            </>
                          ) : (
                            <>
                              <ImageIcon className="h-5 w-5 mr-2" />
                              {diagrams.length > 0 ? 'Re-Generate Diagrams' : 'Generate Diagrams'}
                            </>
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!gsComplete && (
                      <TooltipContent>
                        Run Genus & Species Expansion first — drawings are generated from the expanded specification.
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })()}

              {/* Download — only active after diagrams are generated */}
              {(() => {
                const hasDiagramsReady = diagrams.length > 0;
                const downloadDisabled = exportDOCXMutation.isPending || !hasDiagramsReady;
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="w-full sm:w-auto">
                        <Button
                          size="lg"
                          className="w-full text-base"
                          data-testid="button-download-draft"
                          onClick={() => exportDOCXMutation.mutate()}
                          disabled={downloadDisabled}
                        >
                          {exportDOCXMutation.isPending ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Exporting...
                            </>
                          ) : (
                            <>
                              <Download className="h-5 w-5 mr-2" />
                              Download Provisional Draft
                            </>
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!hasDiagramsReady && (
                      <TooltipContent>
                        Generate diagrams first — the provisional draft includes your drawings.
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })()}

              {/* Proof of Human Conception — same prominence as Download
                  Provisional Draft. Both gate on the same condition (diagrams
                  ready) so they enable together. */}
              {(() => {
                const hasDiagramsReady = diagrams.length > 0;
                const pohcDisabled = exportPohcMutation.isPending || !hasDiagramsReady;
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="w-full sm:w-auto">
                        <Button
                          size="lg"
                          variant="outline"
                          className="w-full text-base"
                          data-testid="button-download-pohc"
                          onClick={() => exportPohcMutation.mutate()}
                          disabled={pohcDisabled}
                        >
                          {exportPohcMutation.isPending ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Exporting...
                            </>
                          ) : (
                            <>
                              <Download className="h-5 w-5 mr-2" />
                              Download Proof of Human Conception
                            </>
                          )}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!hasDiagramsReady && (
                      <TooltipContent>
                        Generate diagrams first — Proof of Human Conception unlocks alongside the provisional draft download.
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })()}
            </div>
          </div>

          <Card>
            <CardHeader className="px-4 sm:px-6">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
                <CardTitle className="text-lg sm:text-2xl">Provisional Draft</CardTitle>
              </div>
              <CardDescription className="text-sm">
                Review your patent application summary and key concept ideas
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              <div className="space-y-4">
                  <div className="flex justify-end">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={regenerateDraftMutation.isPending}
                          data-testid="button-regenerate-draft"
                        >
                          {regenerateDraftMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Regenerating...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Re-Generate Draft
                            </>
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Re-generate the whole draft?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will rewrite every section of your provisional draft — Title, Background, Summary, Detailed Description, Ramifications &amp; Scope, Abstract, and Key Concepts — from scratch. <strong>Any edits you've made by hand to those sections will be permanently lost.</strong> Genus &amp; Species results, diagrams, and the original record of your invention are not affected.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => regenerateDraftMutation.mutate()}>
                            Yes, regenerate
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  {/* ── Genus & Species inline workflow panel ─────────── */}
                  {gsStatus && gsStatus.status !== "idle" && (
                    <div className="border border-primary/20 rounded-lg p-4 sm:p-6 bg-primary/5 space-y-4" data-testid="genus-species-panel">
                      {/* Running spinner */}
                      {["running_stage1","running_stage2","running_stage3","running_stage4"].includes(gsStatus.status) && (() => {
                        const stageHeaders: Record<string, string> = {
                          running_stage1: "Stage 1 of 4 — Extracting the core mechanism",
                          running_stage2: "Stage 2 of 4 — Synthesising architectural variants",
                          running_stage3: "Stage 3 of 4 — Broadening concepts and extending sections",
                          running_stage4: "Stage 4 of 4 — Rewriting the abstract",
                        };
                        const msgs = gsStageMessages[gsStatus.status] || [];
                        const currentMsg = msgs[gsMessageIndex % msgs.length] || "Working…";
                        return (
                          <div className="flex items-start gap-3">
                            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <p className="font-medium text-sm">{stageHeaders[gsStatus.status]}</p>
                                <span className="text-xs text-muted-foreground tabular-nums">elapsed {formatElapsed(gsElapsedSec)}</span>
                              </div>
                              <p className="text-sm text-foreground mt-1 transition-opacity duration-300" key={gsMessageIndex}>{currentMsg}</p>
                              <p className="text-xs text-muted-foreground mt-1">Several agents work in parallel — this can take a few minutes. The page updates automatically when each stage finishes.</p>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Error */}
                      {gsStatus.status === "error" && (
                        <div className="flex items-start gap-3">
                          <p className="text-sm text-destructive flex-1"><strong>Expansion failed:</strong> {gsStatus.error || "Unknown error"}. Try again.</p>
                          <Button size="sm" variant="outline" onClick={() => gsStartMutation.mutate()} disabled={gsStartMutation.isPending}>Retry</Button>
                        </div>
                      )}

                      {/* Gate 1 — species approval */}
                      {gsStatus.status === "awaiting_gate1" && (
                        <div className="space-y-4">
                          <div>
                            <p className="font-semibold text-sm">Review AI implementations</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Approve, edit, or reject each — only approved ones get woven into your draft.</p>
                          </div>
                          {(gsStatus.species || []).map((s: any) => {
                            const decision = gsGate1Decisions[s.species_type];
                            const label = s.species_type === "ai_assisted" ? "AI-Assisted" : s.species_type === "ai_native" ? "AI-Native" : "Agentic";
                            return (
                              <div key={s.species_type} className={`rounded-md border p-3 space-y-2 ${s.failed ? "opacity-50" : ""}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-medium">{label}</span>
                                  {s.failed ? <span className="text-xs text-muted-foreground">Failed to generate</span> : (
                                    <div className="flex gap-1">
                                      <Button size="sm" variant={decision?.decision === "approved" ? "default" : "outline"} className="text-xs h-7 px-2" onClick={() => setGsGate1Decisions(p => ({ ...p, [s.species_type]: { decision: "approved" } }))}>Approve</Button>
                                      <Button size="sm" variant={decision?.decision === "rejected" ? "destructive" : "outline"} className="text-xs h-7 px-2" onClick={() => setGsGate1Decisions(p => ({ ...p, [s.species_type]: { decision: "rejected" } }))}>Reject</Button>
                                    </div>
                                  )}
                                </div>
                                {!s.failed && <p className="text-xs text-muted-foreground leading-relaxed">{s.architectural_description}</p>}
                              </div>
                            );
                          })}
                          <Button
                            size="sm"
                            onClick={() => gsApproveSpeciesMutation.mutate()}
                            disabled={gsApproveSpeciesMutation.isPending || Object.keys(gsGate1Decisions).length === 0}
                          >
                            {gsApproveSpeciesMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin"/>Processing…</> : "Confirm & Continue"}
                          </Button>
                        </div>
                      )}

                      {/* Gate 2 — final artifact review */}
                      {gsStatus.status === "awaiting_gate2" && (
                        <div className="space-y-4">
                          <div>
                            <p className="font-semibold text-sm">Review expanded content</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Approve, edit, or reject each artifact. Only approved content enters your draft.</p>
                          </div>
                          {(() => {
                            // Pull text for `textKey` from any shape the AI may return.
                            // Strategy: normalize to a plain object first, then extract.
                            // As a last resort, regex the raw JSON string — this catches
                            // every nesting/double-encoding variant without recursion bugs.
                            const extractConceptText = (val: any, textKey: string): string => {
                              if (val === null || val === undefined) return "";

                              // Flatten any JSON-string wrapper to a plain JS value
                              const flatten = (v: any): any => {
                                if (typeof v !== "string") return v;
                                const t = v.trim();
                                if (t.startsWith("{") || t.startsWith("[")) {
                                  try { return flatten(JSON.parse(t)); } catch {}
                                }
                                return v;
                              };

                              const obj = flatten(val);

                              // If it resolved to a plain string, that IS the text
                              if (typeof obj === "string") return obj;

                              // Object path — check target key directly
                              if (obj && typeof obj === "object" && !Array.isArray(obj)) {
                                const child = flatten(obj[textKey]);
                                if (typeof child === "string") return child;
                                // Child is still an object (double-nested) — try one more level
                                if (child && typeof child === "object" && !Array.isArray(child)) {
                                  const grand = flatten(child[textKey]);
                                  if (typeof grand === "string") return grand;
                                }
                              }

                              // Last resort: regex on the raw JSON string.
                              // Matches  "textKey": "...value..."  even if deeply nested.
                              try {
                                const raw = typeof val === "string" ? val : JSON.stringify(val);
                                const escaped = textKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                                const m = raw.match(new RegExp(`"${escaped}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
                                if (m) return m[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
                              } catch {}

                              return "";
                            };

                            const aspectLabel: Record<string, string> = {
                              genus_mechanism: "Core Mechanism",
                              species_spectrum: "Architectural Spectrum",
                              hardware_optimization: "Hardware Optimization",
                            };

                            return [
                              ...((gsStatus.broadenings || []).map((b: any, i: number) => ({
                                id: `broadening_${i}`,
                                label: `Broadened Key Concept ${i + 1}`,
                                sublabel: typeof b?.original_key_concept === "string" ? b.original_key_concept : undefined,
                                text: extractConceptText(b, "broadened_concept_text"),
                              }))),
                              ...((gsStatus.appendings || []).map((a: any, i: number) => ({
                                id: `appending_${i}`,
                                label: `New Key Concept — ${aspectLabel[a?.concept_aspect] ?? (a?.concept_aspect || "").replace(/_/g, " ")}`,
                                sublabel: undefined as string | undefined,
                                text: extractConceptText(a, "key_concept_text"),
                              }))),
                              ...(gsStatus.backgroundExtension
                                ? [{ id: "background_extension", label: "Background Extension", sublabel: undefined as string | undefined, text: extractConceptText(gsStatus.backgroundExtension, "additional_paragraphs") }]
                                : []),
                              ...(gsStatus.summaryExtension
                                ? [{ id: "summary_extension", label: "Summary Extension", sublabel: undefined as string | undefined, text: extractConceptText(gsStatus.summaryExtension, "additional_paragraphs") }]
                                : []),
                              ...(gsStatus.abstractRewrite
                                ? [{ id: "abstract", label: `Abstract Rewrite (${gsStatus.abstractRewrite.word_count ?? "?"} words)`, sublabel: undefined as string | undefined, text: extractConceptText(gsStatus.abstractRewrite, "abstract_text") }]
                                : []),
                            ];
                          })().map((artifact) => {
                            const d = gsGate2Decisions[artifact.id];
                            return (
                              <div key={artifact.id} className="rounded-md border p-3 space-y-2">
                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                  <div className="space-y-0.5 min-w-0">
                                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{artifact.label}</span>
                                    {artifact.sublabel && (
                                      <p className="text-xs text-muted-foreground/70 italic truncate max-w-xs">{artifact.sublabel}</p>
                                    )}
                                  </div>
                                  <div className="flex gap-1 shrink-0 flex-wrap">
                                    <Button size="sm" variant="outline" className="text-xs h-6 px-2" onClick={() => regenerateArtifactMutation.mutate(artifact.id)} disabled={!!gsRegenInFlight[artifact.id]} title="Re-run this single AI call">
                                      {gsRegenInFlight[artifact.id] ? <><Loader2 className="h-3 w-3 mr-1 animate-spin"/>…</> : "Regenerate"}
                                    </Button>
                                    <Button size="sm" variant={(!d || d.decision === "approved") ? "default" : "outline"} className="text-xs h-6 px-2" onClick={() => setGsGate2Decisions(p => ({ ...p, [artifact.id]: { decision: "approved" } }))}>Keep</Button>
                                    <Button size="sm" variant={d?.decision === "edited" ? "default" : "outline"} className="text-xs h-6 px-2" onClick={() => setGsGate2Decisions(p => ({ ...p, [artifact.id]: { decision: "edited", editedText: d?.editedText ?? artifact.text } }))}>Edit</Button>
                                    <Button size="sm" variant={d?.decision === "rejected" ? "destructive" : "outline"} className="text-xs h-6 px-2" onClick={() => setGsGate2Decisions(p => ({ ...p, [artifact.id]: { decision: "rejected" } }))}>Remove</Button>
                                  </div>
                                </div>
                                {!artifact.text && (
                                  <p className="text-xs text-destructive/70 italic">Could not extract text — run Genus &amp; Species again to regenerate.</p>
                                )}
                                {d?.decision === "edited" ? (
                                  <textarea className="w-full text-xs rounded border p-2 min-h-24 bg-background resize-y leading-relaxed" value={d.editedText ?? artifact.text} onChange={e => setGsGate2Decisions(p => ({ ...p, [artifact.id]: { ...p[artifact.id], editedText: e.target.value } }))} />
                                ) : gsExpandedArtifact === artifact.id ? (
                                  <div className="space-y-2">
                                    <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{artifact.text}</p>
                                    <button className="text-xs text-primary underline" onClick={() => setGsExpandedArtifact(null)}>Collapse</button>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <p className="text-sm leading-relaxed text-foreground line-clamp-3">{artifact.text}</p>
                                    {artifact.text && <button className="text-xs text-primary underline" onClick={() => setGsExpandedArtifact(artifact.id)}>Read full text</button>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <Button size="sm" onClick={() => gsFinalizeMutation.mutate()} disabled={gsFinalizeMutation.isPending}>
                            {gsFinalizeMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin"/>Finalizing…</> : "Finalize Expansion"}
                          </Button>
                        </div>
                      )}

                      {/* Complete */}
                      {gsStatus.status === "complete" && gsStatus.finalSpec && (() => {
                        const alreadyApplied = !!(gsStatus as any).appliedToDraft;
                        return (
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                              <CheckCircle2 className="h-4 w-4 shrink-0" />
                              {alreadyApplied ? "Expansion applied to your provisional draft." : "Expansion complete."}
                            </div>
                            <button
                              onClick={() => applyToDraftMutation.mutate()}
                              disabled={applyToDraftMutation.isPending || alreadyApplied}
                              title={alreadyApplied ? "Already applied — applying again would duplicate the extensions" : undefined}
                              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {applyToDraftMutation.isPending ? "Applying…" : alreadyApplied ? "Applied" : "Apply to Provisional Draft"}
                            </button>
                          </div>
                        );
                      })()}
                      {gsStatus.status === "complete" && !gsStatus.finalSpec && (
                        <p className="text-xs text-muted-foreground">No species were approved — original draft unchanged.</p>
                      )}
                    </div>
                  )}
                  {/* ─────────────────────────────────────────────────── */}

                  {specSectionsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="md:w-56 shrink-0">
                        <div className="block md:hidden">
                          <select
                            data-testid="select-spec-section-mobile"
                            value={activeSpecSection}
                            onChange={(e) => {
                              setActiveSpecSection(e.target.value);
                              if (editingSection && editingSection !== e.target.value) {
                                setEditingSection(null);
                              }
                            }}
                            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <option value="title">1. Title</option>
                            <option value="background">2. Background</option>
                            <option value="summary">3. Summary</option>
                            <option value="detailed_description">4. Detailed Description</option>
                            <option value="ramifications_and_scope">5. Ramifications & Scope</option>
                            <option value="abstract">6. Abstract</option>
                            <option value="claims">7. Key Concepts</option>
                          </select>
                        </div>
                        <div className="hidden md:flex md:flex-col gap-1">
                          {[
                            { key: 'title', label: '1. Title' },
                            { key: 'background', label: '2. Background' },
                            { key: 'summary', label: '3. Summary' },
                            { key: 'detailed_description', label: '4. Detailed Description' },
                            { key: 'ramifications_and_scope', label: '5. Ramifications & Scope' },
                            { key: 'abstract', label: '6. Abstract' },
                            { key: 'claims', label: '7. Key Concepts' },
                          ].map((tab) => (
                            <button
                              key={tab.key}
                              data-testid={`tab-spec-${tab.key}`}
                              onClick={() => {
                                setActiveSpecSection(tab.key);
                                if (editingSection && editingSection !== tab.key) {
                                  setEditingSection(null);
                                }
                              }}
                              className={`whitespace-nowrap text-left text-sm px-3 py-2 rounded-md transition-colors ${
                                activeSpecSection === tab.key
                                  ? 'bg-primary text-primary-foreground font-medium'
                                  : 'hover-elevate text-muted-foreground'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        {(() => {
                          const currentSection = specSections?.find(s => s.key === activeSpecSection);
                          const sectionContent = currentSection?.content || '';
                          const isEditing = editingSection === activeSpecSection;

                          return (
                            <div className={`rounded-lg ${isEditing ? 'ring-2 ring-primary/30' : ''}`}>
                              <div className="flex items-center justify-between mb-3 gap-2">
                                <h4 className="font-medium text-sm">{currentSection?.label || activeSpecSection}</h4>
                                {!isEditing ? (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    data-testid={`button-edit-${activeSpecSection}`}
                                    onClick={() => {
                                      setEditContent(sectionContent);
                                      setEditingSection(activeSpecSection);
                                    }}
                                  >
                                    <Pencil className="h-4 w-4 mr-2" />
                                    Edit
                                  </Button>
                                ) : (
                                  <div className="flex gap-2 flex-wrap">
                                    <Button
                                      variant="default"
                                      size="sm"
                                      data-testid={`button-save-${activeSpecSection}`}
                                      disabled={saveSpecSectionMutation.isPending}
                                      onClick={() => saveSpecSectionMutation.mutate({ section: activeSpecSection, content: editContent })}
                                    >
                                      {saveSpecSectionMutation.isPending ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                      ) : (
                                        <Save className="h-4 w-4 mr-2" />
                                      )}
                                      Save
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      data-testid={`button-cancel-${activeSpecSection}`}
                                      onClick={() => setEditingSection(null)}
                                      disabled={saveSpecSectionMutation.isPending}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                              </div>
                              {isEditing ? (
                                <div data-color-mode="auto">
                                  <Suspense fallback={<div className="flex items-center justify-center h-75"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
                                    <MDEditor
                                      value={editContent}
                                      onChange={(val) => setEditContent(val || '')}
                                      height={activeSpecSection === 'title' ? 200 : 300}
                                      preview="edit"
                                    />
                                  </Suspense>
                                </div>
                              ) : (
                                <div className="bg-muted p-3 sm:p-6 rounded-lg text-xs sm:text-sm leading-relaxed max-h-100 sm:max-h-150 overflow-y-auto prose prose-sm dark:prose-invert max-w-none">
                                  {sectionContent ? (
                                    <ReactMarkdown>{sectionContent}</ReactMarkdown>
                                  ) : (
                                    <p className="text-muted-foreground">No content for this section yet.</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
              </div>
            </CardContent>
          </Card>

          {diagrams.length === 0 && (() => {
            const gsComplete = gsStatus?.status === "complete";
            const disabled = generateDiagramsMutation.isPending || !gsComplete;
            return (
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ImageIcon className="h-12 w-12 text-amber-600 dark:text-amber-400 mb-4" />
                <p className="text-amber-900 dark:text-amber-100 text-center mb-6">
                  Diagrams haven't been generated yet. Click below to generate technical diagrams.
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="default"
                        onClick={() => generateDiagramsMutation.mutate()}
                        disabled={disabled}
                        data-testid="button-generate-diagrams"
                      >
                        {generateDiagramsMutation.isPending ? (
                          <>
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                            Generating Diagrams...
                          </>
                        ) : (
                          "Generate Diagrams"
                        )}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!gsComplete && (
                    <TooltipContent>
                      Run Genus &amp; Species Expansion first — drawings are generated from the expanded specification.
                    </TooltipContent>
                  )}
                </Tooltip>
              </CardContent>
            </Card>
          );})()}

          {diagrams.length > 0 && (
            <div className="space-y-4 sm:space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <ImageIcon className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
                  <h3 className="text-lg sm:text-2xl font-bold">Technical Diagrams</h3>
                  <span className="text-xs sm:text-sm text-muted-foreground">({diagrams.length} {diagrams.length === 1 ? 'diagram' : 'diagrams'})</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => setShowRegenerateDialog(true)}
                  disabled={generateDiagramsMutation.isPending}
                  data-testid="button-regenerate-diagrams"
                >
                  {generateDiagramsMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Regenerating...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Re-Generate Drawings
                    </>
                  )}
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:gap-6">
                {diagrams.map((diagram: any, index: number) => {
                  // New format: flowchart objects with imageUrl, title, editLink
                  const imageUrl = diagram.imageUrl || null;
                  const title = diagram.title || diagram.diagramType === "flowchart-diagram" ? "System Architecture Diagram" : `Diagram ${index + 1}`;
                  const chartNumber = diagram.chartNumber || index + 1;
                  const editLink = diagram.editLink || null;
                  const isSuccessful = diagram.success !== false;
                  
                  return (
                    <Card key={index} data-testid={`card-diagram-${index}`} className={!isSuccessful ? "border-destructive" : ""}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <CardTitle className="text-base">
                              {chartNumber}. {title}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {isSuccessful ? "Generated technical flowchart" : "Failed to generate"}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {isSuccessful && imageUrl ? (
                          <>
                            <div className="bg-muted rounded-lg flex items-center justify-center border p-2 max-h-64 overflow-hidden">
                              <img
                                src={imageUrl}
                                alt={title}
                                className="max-w-full max-h-56 object-contain rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                                data-testid={`image-diagram-${index}`}
                                onClick={() => window.open(imageUrl, '_blank')}
                                title="Click to view full size"
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="default"
                                size="sm"
                                className="flex-1 min-w-25"
                                data-testid={`button-save-diagram-${index}`}
                                onClick={() => downloadDiagram(imageUrl, title, chartNumber)}
                              >
                                <Save className="h-4 w-4 mr-1 sm:mr-2" />
                                <span className="text-xs sm:text-sm">Save</span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 min-w-25"
                                data-testid={`button-view-diagram-${index}`}
                                onClick={() => window.open(imageUrl, '_blank')}
                              >
                                <ExternalLink className="h-4 w-4 mr-1 sm:mr-2" />
                                <span className="text-xs sm:text-sm">View Full</span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 min-w-25"
                                data-testid={`button-regenerate-diagram-${index}`}
                                onClick={() => regenerateDiagramMutation.mutate(chartNumber)}
                                disabled={!!gsDiagramRegenInFlight[chartNumber]}
                                title="Re-render this single diagram"
                              >
                                {gsDiagramRegenInFlight[chartNumber] ? <Loader2 className="h-4 w-4 mr-1 sm:mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1 sm:mr-2" />}
                                <span className="text-xs sm:text-sm">{gsDiagramRegenInFlight[chartNumber] ? "Regenerating…" : "Regenerate"}</span>
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="bg-muted rounded-lg aspect-video flex items-center justify-center border">
                              <div className="text-center text-muted-foreground">
                                <ImageIcon className="h-12 w-12 mx-auto mb-2" />
                                <p className="text-sm">Diagram not available</p>
                                {diagram.error && (
                                  <p className="text-xs text-destructive mt-1 max-w-xs mx-auto">{diagram.error}</p>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="default"
                              size="sm"
                              className="w-full"
                              data-testid={`button-regenerate-diagram-${index}`}
                              onClick={() => regenerateDiagramMutation.mutate(chartNumber)}
                              disabled={!!gsDiagramRegenInFlight[chartNumber]}
                            >
                              {gsDiagramRegenInFlight[chartNumber] ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Regenerating…</> : <><RefreshCw className="h-4 w-4 mr-2" />Regenerate this diagram</>}
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Find a Practitioner entry point */}
          <div
            className="flex items-center justify-between gap-4 p-4 border rounded-md hover-elevate cursor-pointer"
            onClick={() => setLocation(`/project/${projectId}/agent/5-practitioner`)}
            data-testid="button-find-practitioner-link"
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 shrink-0">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="font-medium text-sm">Find a Patent Practitioner</div>
                <div className="text-xs text-muted-foreground">
                  {diagrams.length > 0
                    ? "Match your invention with registered patent practitioners"
                    : "Generate drawings first to unlock"}
                </div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </div>
      </main>

      <AlertDialog open={showRegenerateDialog} onOpenChange={setShowRegenerateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-Generate Drawings?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace all your current diagrams with newly generated ones. 
              If you want to keep the current drawings, click Cancel and save them first using the "Save Diagram" buttons.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-regenerate-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-regenerate-confirm"
              onClick={() => {
                generateDiagramsMutation.mutate();
                setShowRegenerateDialog(false);
              }}
            >
              Yes, Re-Generate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDownloadWarning} onOpenChange={setShowDownloadWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-download-warning-title">Your draft may be incomplete</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <span className="block">The following haven't been generated yet:</span>
                <ul className="list-disc pl-5 space-y-1">
                  {diagrams.length === 0 && (
                    <li data-testid="text-missing-diagrams">Technical diagrams</li>
                  )}
                </ul>
                <span className="block">We recommend generating these before downloading for a more complete draft. You can still download now if you prefer.</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-download-warning-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-download-anyway"
              onClick={() => {
                exportDOCXMutation.mutate();
                setShowDownloadWarning(false);
              }}
            >
              Download Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

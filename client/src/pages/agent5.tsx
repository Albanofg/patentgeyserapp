import { useEffect, useRef, useState, lazy, Suspense } from "react";
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
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
const MDEditor = lazy(() => import('@uiw/react-md-editor'));
import { Loader2, Download, FileText, Image as ImageIcon, CheckCircle2, Save, RefreshCw, ExternalLink, Pencil, Users, ArrowRight } from "lucide-react";
import type { Project } from "@shared/schema";

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
                data-testid="button-generate-diagrams-header"
                onClick={() => generateDiagramsMutation.mutate()}
                disabled={generateDiagramsMutation.isPending}
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
              <Button
                size="lg"
                className="w-full sm:w-auto text-base"
                data-testid="button-download-draft"
                onClick={() => {
                  if (!hasKeyConcepts) {
                    toast({
                      title: "Create your key concepts first",
                      description: "You must select key concepts before downloading the final application.",
                    });
                    setLocation(`/project/${projectId}/agent/4b`);
                    return;
                  }
                  const missingDiagrams = diagrams.length === 0;
                  if (missingDiagrams) {
                    setShowDownloadWarning(true);
                  } else {
                    exportDOCXMutation.mutate();
                  }
                }}
                disabled={exportDOCXMutation.isPending || !hasKeyConcepts}
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
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => regenerateDraftMutation.mutate()}
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
                  </div>
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
                                  <Suspense fallback={<div className="flex items-center justify-center h-[300px]"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
                                    <MDEditor
                                      value={editContent}
                                      onChange={(val) => setEditContent(val || '')}
                                      height={activeSpecSection === 'title' ? 200 : 300}
                                      preview="edit"
                                    />
                                  </Suspense>
                                </div>
                              ) : (
                                <div className="bg-muted p-3 sm:p-6 rounded-lg text-xs sm:text-sm leading-relaxed max-h-[400px] sm:max-h-[600px] overflow-y-auto prose prose-sm dark:prose-invert max-w-none">
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

          {diagrams.length === 0 && (
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ImageIcon className="h-12 w-12 text-amber-600 dark:text-amber-400 mb-4" />
                <p className="text-amber-900 dark:text-amber-100 text-center mb-6">
                  Diagrams haven't been generated yet. Click below to generate technical diagrams.
                </p>
                <Button
                  variant="default"
                  onClick={() => generateDiagramsMutation.mutate()}
                  disabled={generateDiagramsMutation.isPending}
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
              </CardContent>
            </Card>
          )}

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
                                className="flex-1 min-w-[100px]"
                                data-testid={`button-save-diagram-${index}`}
                                onClick={() => downloadDiagram(imageUrl, title, chartNumber)}
                              >
                                <Save className="h-4 w-4 mr-1 sm:mr-2" />
                                <span className="text-xs sm:text-sm">Save</span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 min-w-[100px]"
                                data-testid={`button-view-diagram-${index}`}
                                onClick={() => window.open(imageUrl, '_blank')}
                              >
                                <ExternalLink className="h-4 w-4 mr-1 sm:mr-2" />
                                <span className="text-xs sm:text-sm">View Full</span>
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="bg-muted rounded-lg aspect-video flex items-center justify-center border">
                            <div className="text-center text-muted-foreground">
                              <ImageIcon className="h-12 w-12 mx-auto mb-2" />
                              <p className="text-sm">Diagram not available</p>
                            </div>
                          </div>
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

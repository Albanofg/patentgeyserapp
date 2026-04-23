import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { Loader2, FileText, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Project } from "@shared/schema";

export default function Agent4c() {
  const [, params] = useRoute("/project/:id/agent/4c");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent2Data } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "agent", 2],
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
    if (currentStage < 4 || (currentStage === 4 && ['4a', '4b'].includes(currentSubstage || ''))) {
      const targetPage = currentStage === 4 && currentSubstage
        ? `/project/${projectId}/agent/${currentSubstage}`
        : currentStage === 2 && currentSubstage
          ? `/project/${projectId}/agent/${currentSubstage}`
          : currentStage
            ? `/project/${projectId}/agent/${currentStage}`
            : `/`;
      
      toast({
        title: "Complete previous stages first",
        description: "Please complete Strategy and Key Concepts before viewing the draft.",
      });
      setLocation(targetPage);
    }
  }, [project, projectId, setLocation, toast]);

  const proceedMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/agent/4/proceed`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      await queryClient.refetchQueries({ queryKey: ["/api/projects", projectId] });
      
      toast({
        title: "Provisional draft complete!",
        description: "Moving to diagram generation.",
      });
      setLocation(`/project/${projectId}/agent/5`);
    },
    onError: (error: Error) => {
      toast({
        title: "Submission failed",
        description: error.message,
        // Softer UX - no red banner
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

  const agent2DataObj = agent2Data?.data as any;
  const agent4DataObj = agent4Data?.data as any;
  
  const expandedConcept = agent2DataObj?.provisionalDraft || agent2DataObj?.draftSpecification || "";
  const selectedKeyConcepts = agent4DataObj?.selectedKeyConcepts || [];
  
  const normalizeStrategicDirective = (md: string): string => {
    if (!md) return md;
    return md.replace(/^(#{1,6}\s*)Nugget\s+(\d+)\s*:\s*undefined\s*$/gim, "$1Concept $2");
  };
  
  const analysisResults = Array.isArray(agent4DataObj) ? agent4DataObj[0] : agent4DataObj || {};
  const strategicDirectiveRaw = analysisResults.strategicDirective || "";
  const strategicDirective = normalizeStrategicDirective(strategicDirectiveRaw);
  
  // Format selected key concepts grouped by variation
  const formatClaims = () => {
    if (!selectedKeyConcepts || selectedKeyConcepts.length === 0) return "";

    // Group by variationId to maintain group structure
    const groupedByVariation: Record<string, any[]> = {};
    selectedKeyConcepts.forEach((concept: any) => {
      const variationId = concept.variationId || 'default';
      if (!groupedByVariation[variationId]) {
        groupedByVariation[variationId] = [];
      }
      groupedByVariation[variationId].push(concept);
    });

    const formattedConcepts: string[] = [];
    let groupNumber = 1;

    Object.keys(groupedByVariation).forEach((variationId) => {
      const groupConcepts = groupedByVariation[variationId];
      groupConcepts.forEach((concept: any, conceptIndex: number) => {
        formattedConcepts.push(`Group ${groupNumber} / Key Concept ${conceptIndex + 1}: ${concept.text}`);
      });
      groupNumber++;
    });

    return formattedConcepts.join('\n\n');
  };

  const formattedClaims = formatClaims();

  return (
    <div className="min-h-screen bg-background">
      <AgentHeader
        project={project}
        agentNumber={4}
        agentName="Provisional Draft"
        agentDescription="AI-generated provisional patent application draft"
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {agent4Loading ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-muted-foreground">Assembling provisional draft...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Draft Overview */}
            <Card className="border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Provisional Patent Application Draft
                </CardTitle>
                <CardDescription>
                  Review your AI-generated provisional draft before generating diagrams
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Technical Specification */}
            <Card>
              <CardHeader>
                <CardTitle>Technical Specification</CardTitle>
                <CardDescription>Detailed description of your invention</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{expandedConcept}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>

            {/* Patent Claims */}
            {formattedClaims && (
              <Card>
                <CardHeader>
                  <CardTitle>Patent Key Concepts</CardTitle>
                  <CardDescription>
                    {selectedKeyConcepts.length} {selectedKeyConcepts.length === 1 ? 'key concept' : 'key concepts'} selected - Key concept language defining the technical scope of the invention
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted p-6 rounded-lg whitespace-pre-wrap text-sm leading-relaxed">
                    {formattedClaims}
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* No claims selected fallback */}
            {!formattedClaims && (
              <Card className="border-destructive/20 bg-destructive/5">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground text-center mb-6">
                    No key concepts have been selected yet. Please go back to Key Concepts Selection and choose your key concepts.
                  </p>
                  <Button
                    variant="default"
                    onClick={() => setLocation(`/project/${projectId}/agent/4b`)}
                    data-testid="button-back-to-claims"
                  >
                    ← Back to Key Concepts Selection
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Strategic Analysis */}
            {strategicDirective && (
              <Card data-testid="card-strategic-analysis">
                <CardHeader>
                  <CardTitle>Strategic Analysis Summary</CardTitle>
                  <CardDescription>White space analysis and differentiation strategy</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{strategicDirective}</ReactMarkdown>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Action Buttons */}
            <div className="flex justify-center gap-4">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setLocation(`/project/${projectId}/agent/4b`)}
                data-testid="button-back"
              >
                ← Back to Key Concepts
              </Button>
              <Button
                size="lg"
                data-testid="button-continue"
                onClick={() => proceedMutation.mutate()}
                disabled={proceedMutation.isPending}
                className="px-12"
              >
                {proceedMutation.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Generate Diagrams →"
                )}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

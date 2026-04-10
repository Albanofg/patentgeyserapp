import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { Loader2, Search, ExternalLink, ChevronRight, RefreshCw } from "lucide-react";
import type { Project } from "@shared/schema";

// Helper to fix malformed patent URLs (B1/B2 patents often have extra digits from webhook)
function getPatentUrl(url: string | undefined, publicationNumber: string | undefined): string {
  if (!url && !publicationNumber) return '#';
  
  // For A1 patents (applications), the webhook URL is usually correct - use it directly
  if (url && url.includes('A1')) {
    return url;
  }
  
  // For B1/B2 patents (granted), the webhook URLs often have malformed numbers
  // Try to construct a proper URL from the publication_number field
  if (publicationNumber) {
    // Format from webhook: "US-12292309-B2" or "US-2022307872-A1"
    // Need to convert to: "US12292309B2" or "US20220307872A1"
    const cleanNumber = publicationNumber.replace(/-/g, '');
    
    // For B1/B2, use the clean publication number directly
    if (cleanNumber.match(/B[12]$/)) {
      return `https://patents.google.com/patent/${cleanNumber}`;
    }
    
    // For A1, the publication number may be missing a leading 0 in the year
    // e.g., "US2022307872A1" should be "US20220307872A1"
    if (cleanNumber.match(/A1$/)) {
      const match = cleanNumber.match(/^US(\d+)A1$/);
      if (match && match[1].length === 10) {
        // Year is 4 digits, number is 6-7 digits - add leading 0 after year
        const yearAndNum = match[1];
        const year = yearAndNum.substring(0, 4);
        const num = yearAndNum.substring(4);
        // Patent application numbers have format: YYYY + 7 digits
        const paddedNum = num.padStart(7, '0');
        return `https://patents.google.com/patent/US${year}${paddedNum}A1`;
      }
    }
    
    return `https://patents.google.com/patent/${cleanNumber}`;
  }
  
  // Fallback: if we only have URL but it's a B1/B2 with too many digits, use search
  if (url) {
    const match = url.match(/patent\/(US\d+B[12])/);
    if (match && match[1].length > 13) {
      // Malformed B1/B2 - use Google Patents search
      return `https://patents.google.com/?q=${encodeURIComponent(match[1])}`;
    }
    return url;
  }
  
  return '#';
}

export default function Agent3() {
  const [, params] = useRoute("/project/:id/agent/3");
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const { data: agent3Data, isLoading: agent3Loading } = useQuery({
    queryKey: ["/api/projects", projectId, "agent", 3],
    enabled: !!projectId,
  });

  // Navigation guard: Block skipping ahead, allow backward navigation
  useEffect(() => {
    if (!project) return;
    
    // Only redirect if trying to skip ahead (stage < 3)
    if (project.currentStage < 3) {
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

  const searchMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/agent/3/search`, {});
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 3] });
      toast({
        title: "Prior art search complete!",
        description: "Review the findings below.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Search failed",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  const proceedMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${projectId}/agent/3/submit`, {});
    },
    onSuccess: async () => {
      // Wait for project data to refetch before navigating
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      await queryClient.refetchQueries({ queryKey: ["/api/projects", projectId] });
      
      toast({
        title: "Prior art analysis complete!",
        description: "Moving to white space analysis.",
      });
      setLocation(`/project/${projectId}/agent/4`);
    },
    onError: (error: Error) => {
      toast({
        title: "Submission failed",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  if (projectLoading || agent3Loading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const agent3DataObj = (agent3Data as any)?.data || {};
  const status = agent3DataObj?.status;
  const priorArtResults = agent3DataObj?.priorArtResults || [];
  const searchMetadata = agent3DataObj?.searchMetadata;

  const showSearchButton = !status || status === 'pending' || status === 'pending_research';
  const showResults = status === 'search_complete';

  return (
    <div className="min-h-screen bg-background">
      <AgentHeader
        project={project}
        agentNumber={3}
        agentName="The Research Library"
        agentDescription="AI-powered prior art search across patent databases and publications"
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="space-y-6">
          {/* Search Button */}
          {showSearchButton && (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <div className="flex justify-center">
                    <div className="rounded-full bg-primary/10 p-4">
                      <Search className="h-8 w-8 text-primary" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Search for Prior Art</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      AI will search patent databases and publications for related prior art
                    </p>
                    <Button
                      size="lg"
                      data-testid="button-search-prior-art"
                      onClick={() => searchMutation.mutate()}
                      disabled={searchMutation.isPending}
                    >
                      {searchMutation.isPending ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          Searching Databases...
                        </>
                      ) : (
                        <>
                          <Search className="h-5 w-5 mr-2" />
                          Start Prior Art Search
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {showResults && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Prior Art Findings</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {priorArtResults.length === 0 
                      ? "Search completed - no prior art found" 
                      : `${searchMetadata?.totalPriorArtFound || priorArtResults.reduce((sum: number, r: any) => sum + (r.priorArt?.length || 0), 0)} results found across ${priorArtResults.length} concepts`
                    }
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => searchMutation.mutate()}
                  disabled={searchMutation.isPending}
                  data-testid="button-re-search"
                >
                  {searchMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Re-searching...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Re-search
                    </>
                  )}
                </Button>
              </div>

              {priorArtResults.length === 0 ? (
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center space-y-4 py-8">
                      <div className="flex justify-center">
                        <div className="rounded-full bg-green-500/10 p-4">
                          <Search className="h-8 w-8 text-green-600" />
                        </div>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold mb-2">No Prior Art Found</h3>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto">
                          The search didn't find any closely related prior art for your concepts. This could indicate strong novelty, but you may want to try the search again or proceed to white space analysis.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                priorArtResults.map((conceptResult: any, idx: number) => (
                <Card key={idx}>
                  <CardHeader>
                    <CardTitle className="text-lg">{conceptResult.conceptTitle}</CardTitle>
                    <CardDescription>
                      {conceptResult.priorArt?.length || 0} related {conceptResult.priorArt?.length === 1 ? 'item' : 'items'} found
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {conceptResult.priorArt && conceptResult.priorArt.length > 0 ? (
                      <div className="space-y-3">
                        {conceptResult.priorArt.map((item: any, itemIdx: number) => (
                          <div
                            key={itemIdx}
                            className="border rounded-lg p-4 space-y-2 hover-elevate"
                            data-testid={`prior-art-${conceptResult.conceptId}-${itemIdx}`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <h4 className="font-semibold text-sm">{item.title}</h4>
                                {item.publicationNumber && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {item.publicationNumber}
                                  </p>
                                )}
                              </div>
                              {item.relevanceScore !== undefined && (
                                <Badge variant="secondary">
                                  {Math.round(item.relevanceScore * 100)}% match
                                </Badge>
                              )}
                            </div>
                            {item.summary && (
                              <p className="text-sm text-muted-foreground">{item.summary}</p>
                            )}
                            {(item.url || item.publication_number || item.publicationNumber) && (
                              <a
                                href={getPatentUrl(item.url, item.publication_number || item.publicationNumber)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                              >
                                View source <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        No prior art found for this concept
                      </p>
                    )}
                  </CardContent>
                </Card>
              )))}

              {/* Action Buttons */}
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-6">
                    <div className="text-center">
                      <h3 className="text-lg font-semibold mb-2">What would you like to do next?</h3>
                      <p className="text-sm text-muted-foreground">
                        Choose whether to refine your ideas or proceed to white space analysis
                      </p>
                    </div>
                    
                    <div className="grid md:grid-cols-2 gap-4">
                      {/* Go back to refinement */}
                      <div className="border rounded-lg p-6 space-y-4 hover-elevate">
                        <div>
                          <h4 className="font-semibold mb-2">Refine Ideas</h4>
                          <p className="text-sm text-muted-foreground mb-4">
                            Go back to refinement with the selected ideas based on prior art findings
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full"
                          data-testid="button-back-to-refinement"
                          onClick={() => setLocation(`/project/${projectId}/agent/2a`)}
                        >
                          Back to Refinement
                        </Button>
                      </div>

                      {/* Proceed to white space */}
                      <div className="border rounded-lg p-6 space-y-4 hover-elevate border-primary/50 bg-primary/5">
                        <div>
                          <h4 className="font-semibold mb-2">Continue Forward</h4>
                          <p className="text-sm text-muted-foreground mb-4">
                            Proceed to white space analysis to identify unique aspects and strengthen claims
                          </p>
                        </div>
                        <Button
                          className="w-full"
                          data-testid="button-proceed"
                          onClick={() => proceedMutation.mutate()}
                          disabled={proceedMutation.isPending}
                        >
                          {proceedMutation.isPending ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <span>White Space Analysis</span>
                              <ChevronRight className="h-5 w-5 ml-2" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

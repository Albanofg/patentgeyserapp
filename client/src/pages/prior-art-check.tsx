import { useState } from "react";

function matchLabel(distanceScore: string | number | undefined): { label: string; variant: "default" | "secondary" | "outline" | "destructive" } | null {
  if (distanceScore === undefined || distanceScore === null || distanceScore === "") return null;
  const d = typeof distanceScore === "number" ? distanceScore : parseFloat(distanceScore);
  if (Number.isNaN(d)) return null;
  const similarity = 1 - d;
  if (similarity >= 0.8) return { label: "High match", variant: "destructive" };
  if (similarity >= 0.55) return { label: "Moderate match", variant: "default" };
  if (similarity >= 0.3) return { label: "Some overlap", variant: "secondary" };
  return { label: "Low match", variant: "outline" };
}

import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, 
  Loader2, 
  Trash2, 
  Clock, 
  FileText, 
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Lightbulb,
  Target,
  Plus,
  History
} from "lucide-react";
import { format } from "date-fns";
import type { PriorArtSearch } from "@shared/schema";

// Helper to fix malformed patent URLs (B1/B2 patents often have extra digits from webhook)
function getPatentUrl(url: string | undefined, publicationNumber: string | undefined): string {
  if (!url && !publicationNumber) return '#';
  
  if (url && url.includes('A1')) {
    return url;
  }
  
  if (publicationNumber) {
    const cleanNumber = publicationNumber.replace(/-/g, '');
    
    if (cleanNumber.match(/B[12]$/)) {
      return `https://patents.google.com/patent/${cleanNumber}`;
    }
    
    if (cleanNumber.match(/A1$/)) {
      const match = cleanNumber.match(/^US(\d+)A1$/);
      if (match && match[1].length === 10) {
        const yearAndNum = match[1];
        const year = yearAndNum.substring(0, 4);
        const num = yearAndNum.substring(4);
        const paddedNum = num.padStart(7, '0');
        return `https://patents.google.com/patent/US${year}${paddedNum}A1`;
      }
    }
    
    return `https://patents.google.com/patent/${cleanNumber}`;
  }
  
  if (url) {
    const match = url.match(/patent\/(US\d+B[12])/);
    if (match && match[1].length > 13) {
      return `https://patents.google.com/?q=${encodeURIComponent(match[1])}`;
    }
    return url;
  }
  
  return '#';
}

export default function PriorArtCheck() {
  const { toast } = useToast();
  const [searchText, setSearchText] = useState("");
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"search" | "history" | "results">("search");

  const { data: searches = [], isLoading: loadingSearches } = useQuery<PriorArtSearch[]>({
    queryKey: ["/api/prior-art-searches"],
  });

  const checkMutation = useMutation({
    mutationFn: async (text: string) => {
      return await apiRequest("POST", "/api/prior-art-check", { searchText: text });
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/prior-art-searches"] });
      setSearchText("");
      if (data?.search?.id) {
        setSelectedSearchId(data.search.id);
        setMobileTab("results");
      }
      toast({
        title: "Prior art check complete!",
        description: "Results are ready to view.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Check failed",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/prior-art-searches/${id}`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/prior-art-searches"] });
      if (selectedSearchId) {
        setSelectedSearchId(null);
      }
      toast({
        title: "Search deleted",
        description: "The search has been removed from your history.",
      });
    },
  });

  const selectedSearch = searches.find(s => s.id === selectedSearchId);
  const rawResults = selectedSearch?.results;
  const results: any[] = Array.isArray(rawResults) 
    ? rawResults 
    : (rawResults && typeof rawResults === 'object' 
        ? (Array.isArray((rawResults as any).results) ? (rawResults as any).results :
           Array.isArray((rawResults as any).patents) ? (rawResults as any).patents :
           Array.isArray((rawResults as any).data) ? (rawResults as any).data : [])
        : []);
  
  const analysis = selectedSearch?.analysis as any;
  const keyDifferentiators: string[] = analysis?.key_differentiators || [];
  const claimsFocus: string[] = analysis?.claims_focus || [];

  // Mobile view - using tabs
  const renderMobileView = () => (
    <div className="h-full flex flex-col md:hidden">
      <div className="border-b p-4">
        <h1 className="text-xl font-bold">Quick Prior Art Check</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Check for existing prior art
        </p>
      </div>

      <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as any)} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-auto p-0">
          <TabsTrigger 
            value="search" 
            className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3"
          >
            <Plus className="h-4 w-4 mr-2" />
            New
          </TabsTrigger>
          <TabsTrigger 
            value="history" 
            className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3"
          >
            <History className="h-4 w-4 mr-2" />
            History
            {searches.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {searches.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="results" 
            className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3"
            disabled={!selectedSearch}
          >
            <FileText className="h-4 w-4 mr-2" />
            Results
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="flex-1 m-0 p-4 overflow-auto">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Describe your invention idea
              </label>
              <Textarea
                placeholder="Enter a detailed description of your invention (at least 10 characters)..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="min-h-[150px] resize-none"
                data-testid="input-prior-art-search"
              />
            </div>
            <Button
              className="w-full"
              size="lg"
              onClick={() => checkMutation.mutate(searchText)}
              disabled={checkMutation.isPending || searchText.trim().length < 10}
              data-testid="button-run-prior-art-check"
            >
              {checkMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Check Prior Art
                </>
              )}
            </Button>
            {checkMutation.isPending && (
              <p className="text-sm text-muted-foreground text-center">
                This may take a minute...
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="flex-1 m-0 overflow-auto">
          {loadingSearches ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : searches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Clock className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">
                No searches yet. Run your first check!
              </p>
              <Button 
                variant="outline" 
                className="mt-4"
                onClick={() => setMobileTab("search")}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Search
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {searches.map((search) => {
                const resultCount = Array.isArray(search.results) ? search.results.length : 0;
                const isSelected = selectedSearchId === search.id;
                
                return (
                  <div
                    key={search.id}
                    className={`p-4 ${isSelected ? 'bg-primary/5' : ''}`}
                    data-testid={`search-item-${search.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div 
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => {
                          setSelectedSearchId(search.id);
                          setMobileTab("results");
                        }}
                      >
                        <p className="text-sm font-medium line-clamp-2">
                          {search.searchText}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="secondary" className="text-xs">
                            {resultCount} result{resultCount !== 1 ? 's' : ''}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {search.createdAt ? format(new Date(search.createdAt), 'MMM d, h:mm a') : ''}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="flex-shrink-0"
                        onClick={() => deleteMutation.mutate(search.id)}
                        data-testid={`button-delete-search-${search.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="results" className="flex-1 m-0 overflow-auto">
          {selectedSearch ? (
            <div className="p-4 space-y-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileTab("history")}
                className="mb-2"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to History
              </Button>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Your Query</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{selectedSearch.searchText}</p>
                </CardContent>
              </Card>

              {(keyDifferentiators.length > 0 || claimsFocus.length > 0) && (
                <div className="space-y-4">
                  <h3 className="font-semibold">Strategic Analysis</h3>

                  {keyDifferentiators.length > 0 && (
                    <Card data-testid="card-key-differentiators">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Lightbulb className="h-4 w-4 text-primary" />
                          Key Differentiators
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {keyDifferentiators.map((item, idx) => (
                            <li key={idx} className="text-sm flex items-start gap-2">
                              <ChevronRight className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  {claimsFocus.length > 0 && (
                    <Card data-testid="card-claims-focus">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Target className="h-4 w-4 text-primary" />
                          Key Concepts Focus
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {claimsFocus.map((item, idx) => (
                            <li key={idx} className="text-sm flex items-start gap-2">
                              <ChevronRight className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                  <Separator />
                </div>
              )}

              <div>
                <h3 className="font-semibold mb-3">
                  Prior Art Results ({results.length})
                </h3>

                {results.length === 0 ? (
                  <Card>
                    <CardContent className="p-6 text-center">
                      <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <h4 className="font-semibold text-sm">No Prior Art Found</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Great news! This is a good sign for patentability.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {results.map((patent: any, index: number) => {
                      const rawUrl = patent.url || patent.patent_url || patent.link || patent.google_patent_url;
                      const patentNumber = patent.patent_number || patent.publication_number;
                      const patentUrl = getPatentUrl(rawUrl, patentNumber);
                      const patentTitle = patent.title || patent.patent_title || `Patent ${index + 1}`;

                      return (
                        <Card key={index} data-testid={`patent-result-${index}`}>
                          <CardContent className="p-4">
                            <p className="font-medium text-sm leading-snug">{patentTitle}</p>
                            {patentNumber && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {patentNumber}
                              </p>
                            )}
                            {patent.abstract && (
                              <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
                                {patent.abstract}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 mt-3">
                              {(() => {
                                const m = matchLabel(patent.distance_score);
                                return m ? (
                                  <Badge variant={m.variant} className="text-xs">
                                    {m.label}
                                  </Badge>
                                ) : null;
                              })()}
                              {patentUrl && patentUrl !== '#' && (
                                <a
                                  href={patentUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                                  data-testid={`link-patent-${index}`}
                                >
                                  View Patent
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Search className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">
                Select a search from history or run a new check
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );

  // Desktop view - side by side layout
  const renderDesktopView = () => (
    <div className="h-full hidden md:flex flex-col">
      <div className="border-b p-6">
        <h1 className="text-2xl font-bold">Quick Prior Art Check</h1>
        <p className="text-muted-foreground mt-1">
          Quickly check if your idea has existing prior art before starting a full patent application
        </p>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 min-w-80 max-w-80 border-r flex flex-col bg-muted/30 overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-sm mb-3">New Search</h2>
            <Textarea
              placeholder="Describe your invention idea in detail (at least 10 characters)..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="min-h-[100px] resize-none text-sm"
              data-testid="input-prior-art-search-desktop"
            />
            <Button
              className="w-full mt-3"
              onClick={() => checkMutation.mutate(searchText)}
              disabled={checkMutation.isPending || searchText.trim().length < 10}
              data-testid="button-run-prior-art-check-desktop"
            >
              {checkMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Check Prior Art
                </>
              )}
            </Button>
          </div>

          <div className="p-4 border-b">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Search History
            </h2>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2">
              {loadingSearches ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : searches.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No searches yet. Run your first check above!
                </p>
              ) : (
                <div className="space-y-1">
                  {searches.map((search) => {
                    const resultCount = Array.isArray(search.results) ? search.results.length : 0;
                    const isSelected = selectedSearchId === search.id;
                    
                    return (
                      <div
                        key={search.id}
                        className={`group p-3 rounded-md cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-primary/10 border border-primary/30' 
                            : 'hover-elevate'
                        }`}
                        onClick={() => setSelectedSearchId(search.id)}
                        data-testid={`search-item-${search.id}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm font-medium line-clamp-3">
                            {search.searchText}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMutation.mutate(search.id);
                            }}
                            data-testid={`button-delete-search-${search.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {resultCount} result{resultCount !== 1 ? 's' : ''}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {search.createdAt ? format(new Date(search.createdAt), 'MMM d, h:mm a') : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 overflow-hidden">
          {checkMutation.isPending ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center">
                <h3 className="font-semibold text-lg">Searching Prior Art...</h3>
                <p className="text-muted-foreground mt-1">
                  This may take a minute as we search through patents and publications
                </p>
              </div>
            </div>
          ) : selectedSearch ? (
            <ScrollArea className="h-full">
              <div className="p-6">
                <div className="mb-6">
                  <h2 className="text-lg font-semibold mb-2">Search Query</h2>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm">{selectedSearch.searchText}</p>
                    </CardContent>
                  </Card>
                </div>

                <Separator className="my-6" />

                {(keyDifferentiators.length > 0 || claimsFocus.length > 0) && (
                  <>
                    <h2 className="text-lg font-semibold mb-4">Strategic Analysis</h2>

                    <div className="grid gap-4 md:grid-cols-2">
                      {keyDifferentiators.length > 0 && (
                        <Card data-testid="card-key-differentiators">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Lightbulb className="h-4 w-4 text-primary" />
                              Key Differentiators
                            </CardTitle>
                            <CardDescription className="text-xs">
                              What makes your invention unique
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <ul className="space-y-2">
                              {keyDifferentiators.map((item, idx) => (
                                <li key={idx} className="text-sm flex items-start gap-2">
                                  <ChevronRight className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      )}

                      {claimsFocus.length > 0 && (
                        <Card data-testid="card-claims-focus">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Target className="h-4 w-4 text-primary" />
                              Key Concepts Focus
                            </CardTitle>
                            <CardDescription className="text-xs">
                              Areas to emphasize in your patent key concepts
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <ul className="space-y-2">
                              {claimsFocus.map((item, idx) => (
                                <li key={idx} className="text-sm flex items-start gap-2">
                                  <ChevronRight className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      )}
                    </div>

                    <Separator className="my-6" />
                  </>
                )}

                <h2 className="text-lg font-semibold mb-4">
                  Prior Art Results ({results.length})
                </h2>

                {results.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="font-semibold">No Prior Art Found</h3>
                      <p className="text-muted-foreground mt-2">
                        Great news! We didn't find any closely related prior art for your idea.
                        This is a positive signal. AI screening is not a substitute for a registered practitioner's patentability opinion.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {results.map((patent: any, index: number) => {
                      const rawUrl = patent.url || patent.patent_url || patent.link || patent.google_patent_url;
                      const patentNumber = patent.patent_number || patent.publication_number;
                      const patentUrl = getPatentUrl(rawUrl, patentNumber);
                      const patentTitle = patent.title || patent.patent_title || `Patent ${index + 1}`;
                      
                      return (
                        <Card key={index} data-testid={`patent-result-${index}`}>
                          <CardContent className="p-4">
                            <p className="font-medium text-sm">{patentTitle}</p>
                            {patentNumber && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {patentNumber}
                              </p>
                            )}
                            {patent.abstract && (
                              <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
                                {patent.abstract}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-3">
                              {(() => {
                                const m = matchLabel(patent.distance_score);
                                return m ? (
                                  <Badge variant={m.variant}>
                                    {m.label}
                                  </Badge>
                                ) : null;
                              })()}
                              {patentUrl && patentUrl !== '#' && (
                                <a 
                                  href={patentUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                                  data-testid={`link-patent-${index}`}
                                >
                                  View Patent
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

              </div>
            </ScrollArea>
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
              <Search className="h-16 w-16 text-muted-foreground/30" />
              <div>
                <h3 className="font-semibold text-lg">Select a Search</h3>
                <p className="text-muted-foreground mt-1">
                  Select a search from the history or run a new prior art check
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {renderMobileView()}
      {renderDesktopView()}
    </>
  );
}

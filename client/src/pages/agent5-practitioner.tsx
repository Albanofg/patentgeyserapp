import { useState, useMemo } from "react";
import { usePageSnapshot, type PageSnapshot } from "@/lib/page-snapshot";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Loader2, Users, Search, AlertCircle, CheckCircle2,
  RefreshCw, Phone, MapPin, Scale, X, ArrowRight,
} from "lucide-react";
import type { Project } from "@shared/schema";

interface Patent {
  app_id: string;
  patent_number: string;
  title: string;
  filing_date: string;
  grant_date: string;
  status: string;
  app_type_label: string;
  art_unit: string;
}

interface Practitioner {
  id: string;
  first_name: string;
  last_name: string;
  firm_name: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  fax: string | null;
  reg_num: string;
  profile_picture: string | null;
  art_unit: string[];
  enriched_art_units: string[];
  cpc_codes: string[];
  patents: Patent[];
}

function PractitionerModal({ practitioner, onClose }: { practitioner: Practitioner; onClose: () => void }) {
  const patents = practitioner.patents || [];
  const artUnits = practitioner.enriched_art_units?.length
    ? practitioner.enriched_art_units
    : practitioner.art_unit || [];
  const cpcCodes = practitioner.cpc_codes || [];
  const granted = patents.filter(p => !!p.grant_date).length;
  const pending = patents.length - granted;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b pr-12">
          <div>
            <div className="font-bold text-base">
              {practitioner.first_name} {practitioner.last_name}
            </div>
            {practitioner.firm_name && (
              <div className="text-sm text-muted-foreground">{practitioner.firm_name}</div>
            )}
          </div>
          <span className="text-xs font-mono text-muted-foreground">Reg. #{practitioner.reg_num}</span>
        </div>

        <div className="flex flex-col sm:flex-row max-h-[70vh] overflow-y-auto">
          {/* Left panel */}
          <div className="sm:w-48 flex-shrink-0 p-5 border-r space-y-4">
            {(practitioner.city || practitioner.state) && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{[practitioner.city, practitioner.state].filter(Boolean).join(", ")}</span>
              </div>
            )}
            {practitioner.phone && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{practitioner.phone}</span>
              </div>
            )}

            {/* Stat boxes */}
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { value: patents.length, label: "Total" },
                { value: granted, label: "Granted" },
                { value: pending, label: "Pending" },
                { value: artUnits.length, label: "Units" },
              ].map(({ value, label }) => (
                <div key={label} className="flex flex-col items-center border rounded-md py-2 px-1">
                  <span className="text-lg font-bold tabular-nums leading-none">{value}</span>
                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 p-5 space-y-5 overflow-y-auto">
            {cpcCodes.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">CPC Codes</div>
                <div className="flex flex-wrap gap-1.5">
                  {cpcCodes.map(code => (
                    <Badge key={code} variant="outline" className="font-mono text-xs">{code}</Badge>
                  ))}
                </div>
              </div>
            )}

            {artUnits.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  <Scale className="h-3.5 w-3.5" />
                  Art Unit Experience
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {artUnits.map(unit => (
                    <Badge key={unit} variant="secondary" className="font-mono text-xs">{unit}</Badge>
                  ))}
                </div>
              </div>
            )}

            {patents.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Patents ({patents.length})
                </div>
                <div className="space-y-2">
                  {patents.map(patent => (
                    <div key={patent.app_id} className="border rounded-md p-3 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-medium leading-snug">{patent.title}</div>
                        {patent.grant_date && (
                          <Badge variant="outline" className="text-[10px] flex-shrink-0 py-0">Granted</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground font-mono">
                        {patent.app_id && <span>App: {patent.app_id}</span>}
                        {patent.patent_number && <span>Pat: {patent.patent_number}</span>}
                        {patent.filing_date && <span>Filed: {patent.filing_date}</span>}
                        {patent.grant_date && <span>Granted: {patent.grant_date}</span>}
                        {patent.app_type_label && <span>{patent.app_type_label}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PractitionerCard({ practitioner, index, onClick }: {
  practitioner: Practitioner;
  index: number;
  onClick: () => void;
}) {
  const patents = practitioner.patents || [];
  const artUnits = practitioner.enriched_art_units?.length
    ? practitioner.enriched_art_units
    : practitioner.art_unit || [];
  const primaryArtUnit = artUnits[0];

  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={onClick}
      data-testid={`card-practitioner-${practitioner.id || index}`}
    >
      <CardContent className="p-4 flex items-center gap-4">
        {/* Left: rank + info */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-xs font-mono text-muted-foreground w-6 flex-shrink-0 text-right">
            {index + 1}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">
              {practitioner.first_name} {practitioner.last_name}
            </div>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {practitioner.firm_name && (
                <span className="text-xs text-muted-foreground truncate">{practitioner.firm_name}</span>
              )}
              {(practitioner.city || practitioner.state) && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  {[practitioner.city, practitioner.state].filter(Boolean).join(", ")}
                </span>
              )}
            </div>
            {primaryArtUnit && (
              <Badge variant="outline" className="text-[10px] font-mono mt-1.5 py-0">{primaryArtUnit}</Badge>
            )}
          </div>
        </div>

        {/* Right: stats */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex flex-col items-center border rounded-md px-2.5 py-1.5 min-w-[44px]">
            <span className="text-sm font-bold tabular-nums leading-none">{patents.length}</span>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">Patents</span>
          </div>
          <div className="flex flex-col items-center border rounded-md px-2.5 py-1.5 min-w-[44px]">
            <span className="text-sm font-bold tabular-nums leading-none">{artUnits.length}</span>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide mt-0.5">Units</span>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Agent5Practitioner() {
  const [, params] = useRoute("/project/:id/agent/5-practitioner");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;
  const [selectedPractitioner, setSelectedPractitioner] = useState<Practitioner | null>(null);

  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    queryFn: () => apiRequest("GET", `/api/projects/${projectId}`),
    enabled: !!projectId,
  });

  const { data: agent5Data } = useQuery({
    queryKey: ["/api/projects", projectId, "agent", 5],
    enabled: !!projectId,
  });

  const agent5Obj = (agent5Data as any)?.data || {};
  const hasDiagrams = Array.isArray(agent5Obj?.diagrams) && agent5Obj.diagrams.length > 0;
  const prereqsMet = hasDiagrams;

  const practitioners: Practitioner[] = Array.isArray(agent5Obj?.practitionerMatchResults)
    ? agent5Obj.practitionerMatchResults
    : [];
  const matchedAt = agent5Obj?.practitionerMatchedAt;

  // ── Page snapshot for the AI Helper ─────────────────────────────────────
  // Practitioner-match page. Read-only list of matched practitioners after
  // running the match. Requires diagrams (stage 5 prereq); without them the
  // only action is going back to the Showcase.
  const practitionerSnapshot = useMemo<PageSnapshot>(() => ({
    pageName: "Find a Patent Practitioner",
    route: `/project/${projectId}/agent/5-practitioner`,
    description: prereqsMet
      ? "User can run the practitioner-match search or review existing matches. Items are read-only practitioner cards."
      : "Diagrams have not been generated yet — the match feature is gated until stage 5 produces drawings.",
    items: practitioners.map((p: any, i: number) => ({
      id: `practitioner_${i + 1}`,
      type: "practitioner_match",
      editable: false,
      content: {
        name: p.name ?? null,
        firm: p.firm ?? null,
        url: p.url ?? null,
        specialty: p.specialty ?? null,
      },
    })),
    drafts: {},
    actions: prereqsMet
      ? [
          {
            id: "find-practitioner",
            label: practitioners.length > 0 ? "Re-run Practitioner Match" : "Find Practitioners",
            kind: "primary",
            enabled: true,
          },
          {
            id: "back-to-showcase",
            label: "Back to The Showcase",
            kind: "secondary",
            enabled: true,
            navigatesTo: `/project/${projectId}/agent/5`,
          },
        ]
      : [
          {
            id: "go-generate-diagrams",
            label: "Go to The Showcase (generate diagrams first)",
            kind: "primary",
            enabled: true,
            navigatesTo: `/project/${projectId}/agent/5`,
            reason: "Diagrams are required before practitioner matching can run",
          },
        ],
    source: "structured",
  }), [prereqsMet, practitioners, projectId]);
  usePageSnapshot(practitionerSnapshot);

  const practitionerMatchMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/projects/${projectId}/practitioner-match`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
      toast({ title: "Search complete", description: "Practitioner matches found based on your invention's abstract." });
    },
    onError: (error: any) => {
      toast({
        title: "Search failed",
        description: error.message || "Failed to find practitioners. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <AgentHeader
        project={project!}
        agentNumber={5}
        agentName="Find a Practitioner"
        agentDescription="Match your invention with registered patent practitioners"
      />

      <main className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-10">
        <div className="space-y-6">

          {/* Controls */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>Matches practitioners to your invention's abstract</span>
            </div>

            {!prereqsMet ? (
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <span className="text-muted-foreground">
                  Generate drawings first.{" "}
                  <button
                    className="underline text-foreground"
                    onClick={() => setLocation(`/project/${projectId}/agent/5`)}
                  >
                    Go to The Showcase
                  </button>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Ready
                </div>
                <Button
                  data-testid="button-find-practitioner"
                  onClick={() => practitionerMatchMutation.mutate()}
                  disabled={practitionerMatchMutation.isPending}
                >
                  {practitionerMatchMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Searching...</>
                  ) : practitioners.length > 0 ? (
                    <><RefreshCw className="h-4 w-4 mr-2" />Search Again</>
                  ) : (
                    <><Search className="h-4 w-4 mr-2" />Find Practitioners</>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Loading overlay */}
          {practitionerMatchMutation.isPending && (
            <div className="flex flex-col items-center justify-center py-24 gap-6" data-testid="loading-practitioner-search">
              <div className="relative flex items-center justify-center">
                <div className="h-20 w-20 rounded-full border-4 border-primary/20" />
                <Loader2 className="h-10 w-10 animate-spin text-primary absolute" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-lg font-medium">Searching for practitioners...</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Matching your invention's abstract against registered patent attorneys and agents
                </p>
              </div>
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-2 w-2 rounded-full bg-primary/50 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {!practitionerMatchMutation.isPending && practitioners.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm flex-wrap gap-2 pb-1">
                <span className="font-medium">{practitioners.length} practitioners matched</span>
                {matchedAt && (
                  <span className="text-xs text-muted-foreground">
                    Last searched {new Date(matchedAt).toLocaleDateString(undefined, {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {practitioners.map((p, i) => (
                  <PractitionerCard
                    key={p.id || i}
                    practitioner={p}
                    index={i}
                    onClick={() => setSelectedPractitioner(p)}
                  />
                ))}
              </div>
            </div>
          )}

        </div>
      </main>

      {selectedPractitioner && (
        <PractitionerModal
          practitioner={selectedPractitioner}
          onClose={() => setSelectedPractitioner(null)}
        />
      )}
    </div>
  );
}

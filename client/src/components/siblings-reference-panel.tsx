// Read-only siblings reference panel. Renders cached digests (preview +
// hash) for every other Project in the same family. Built to handle large
// families: collapsed by default, filterable, virtualisation-free
// scrollable, and excluded from the QA page-snapshot so it never inflates
// AI token cost.
//
// Data is fetched from GET /api/projects/:id/siblings. Returns [] when the
// project has no family — in which case this component renders nothing.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export interface SiblingReference {
  id: string;
  title: string;
  currentStage: number;
  completed: number;
  updatedAt: string | null;
  artifacts: {
    ideaSummary: { preview: string; charCount: number; hash: string } | null;
    extractedIdeas: Array<{ title: string; hash: string }>;
    keyConcepts: Array<{ preview: string; hash: string }>;
  };
}

interface Props {
  projectId: string;
}

export function SiblingsReferencePanel({ projectId }: Props) {
  const { data, isLoading } = useQuery<SiblingReference[]>({
    queryKey: ["/api/projects", projectId, "siblings"],
  });

  const siblings = data ?? [];
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return siblings;
    const q = filter.toLowerCase();
    return siblings.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      if (s.artifacts.ideaSummary?.preview.toLowerCase().includes(q)) return true;
      if (s.artifacts.extractedIdeas.some((e) => e.title.toLowerCase().includes(q))) return true;
      if (s.artifacts.keyConcepts.some((k) => k.preview.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [siblings, filter]);

  if (isLoading) return null;
  if (siblings.length === 0) return null;

  return (
    <div
      // data-snapshot-exclude keeps this panel out of the QA page snapshot so
      // sibling content is NEVER shipped into AI prompts as part of a QA turn.
      // (The QA assistant fetches the same data server-side via the family
      // cache when it needs it — never via the page snapshot.)
      data-snapshot-exclude="true"
      className="border border-border rounded-md bg-card/40"
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left hover-elevate active-elevate-2 rounded-md"
            data-testid="siblings-panel-toggle"
          >
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Other Projects in this family</span>
              <Badge variant="secondary" className="ml-1">{siblings.length}</Badge>
            </span>
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              These Projects share a family with this one. Their content is shown here so you
              can see what's already covered and keep this Project distinct — never to copy
              from. Each Project stays completely independent.
            </p>
            {siblings.length > 6 && (
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by title, idea, or concept…"
                  className="pl-7 h-8 text-xs"
                  data-testid="siblings-filter"
                />
              </div>
            )}
            <ScrollArea className="max-h-[460px] pr-2">
              <div className="space-y-1.5">
                {filtered.map((s) => (
                  <SiblingRow key={s.id} sibling={s} />
                ))}
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">No siblings match this filter.</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function SiblingRow({ sibling }: { sibling: SiblingReference }) {
  const [expanded, setExpanded] = useState(false);
  const totalArtifacts =
    (sibling.artifacts.ideaSummary ? 1 : 0) +
    sibling.artifacts.extractedIdeas.length +
    sibling.artifacts.keyConcepts.length;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="border border-border rounded-md bg-background/60">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left hover-elevate active-elevate-2 rounded-md"
            data-testid={`sibling-row-${sibling.id}`}
          >
            <span className="flex items-center gap-2 min-w-0">
              {expanded ? <ChevronDown className="h-3.5 w-3.5 flex-none" /> : <ChevronRight className="h-3.5 w-3.5 flex-none" />}
              <span className="text-sm font-medium truncate">{sibling.title}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">stage {sibling.currentStage}{sibling.completed ? " ✓" : ""}</Badge>
            </span>
            <span className="text-xs text-muted-foreground flex-none">{totalArtifacts} item{totalArtifacts === 1 ? "" : "s"}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-2 pt-1 space-y-1.5">
            {sibling.artifacts.ideaSummary && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Idea Summary <span className="normal-case">({sibling.artifacts.ideaSummary.charCount} chars total)</span></p>
                <p className="text-xs text-foreground/90 whitespace-pre-wrap">{sibling.artifacts.ideaSummary.preview}{sibling.artifacts.ideaSummary.charCount > sibling.artifacts.ideaSummary.preview.length ? "…" : ""}</p>
              </div>
            )}
            {sibling.artifacts.extractedIdeas.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Extracted Ideas ({sibling.artifacts.extractedIdeas.length})</p>
                <ul className="text-xs space-y-0.5">
                  {sibling.artifacts.extractedIdeas.map((e, i) => (
                    <li key={`${e.hash}-${i}`} className="text-foreground/90">• {e.title}</li>
                  ))}
                </ul>
              </div>
            )}
            {sibling.artifacts.keyConcepts.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Selected Key Concepts ({sibling.artifacts.keyConcepts.length})</p>
                <ul className="text-xs space-y-0.5">
                  {sibling.artifacts.keyConcepts.map((k, i) => (
                    <li key={`${k.hash}-${i}`} className="text-foreground/90">• {k.preview}{k.preview.length >= 80 ? "…" : ""}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="pt-1">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
              >
                <a
                  href={`/projects/${sibling.id}`}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`sibling-open-${sibling.id}`}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  View in {sibling.title}
                </a>
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

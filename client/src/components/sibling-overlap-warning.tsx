// Soft-warn banner that appears when the inventor's current selection
// includes content (exact-match by hash) that already lives in a sibling
// Project in the same family. Tone is informational ("this also lives in
// sibling X") rather than judgmental — the system never decides what is
// in scope; that is a registered practitioner's call.
//
// Powered by POST /api/projects/:id/siblings/overlap-check — a pure indexed
// SQL lookup against the family digest cache. Zero AI calls. Debounced.

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface OverlapCandidate {
  kind: "key_concept" | "extracted_idea" | "idea_summary";
  text: string;
}

interface OverlapHit {
  siblingProjectId: string;
  siblingTitle: string;
  artifactKind: "idea_summary" | "extracted_idea" | "key_concept";
  preview: string;
}

interface Props {
  projectId: string;
  candidates: OverlapCandidate[];
  debounceMs?: number;
}

export function SiblingOverlapWarning({ projectId, candidates, debounceMs = 350 }: Props) {
  const [hits, setHits] = useState<OverlapHit[]>([]);

  const checkMutation = useMutation({
    mutationFn: async (payload: { candidates: OverlapCandidate[] }) => {
      return apiRequest<{ hits: OverlapHit[] }>(
        "POST",
        `/api/projects/${projectId}/siblings/overlap-check`,
        payload,
      );
    },
    onSuccess: (data) => setHits(data?.hits ?? []),
    onError: () => setHits([]),
  });

  // Stable signature so we only re-fire when the actual selection changes,
  // not on every render.
  const candidatesKey = useMemo(
    () => candidates.map((c) => `${c.kind}:${c.text}`).join(""),
    [candidates],
  );

  useEffect(() => {
    if (!projectId) return;
    if (candidates.length === 0) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      checkMutation.mutate({ candidates });
    }, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatesKey, projectId, debounceMs]);

  if (hits.length === 0) return null;

  // Group hits by sibling so a single sibling with multiple overlaps is one
  // row, not three. Important for large families.
  const bySibling = new Map<string, { title: string; previews: Array<{ kind: string; preview: string }> }>();
  for (const h of hits) {
    const entry = bySibling.get(h.siblingProjectId) ?? { title: h.siblingTitle, previews: [] };
    entry.previews.push({ kind: h.artifactKind, preview: h.preview });
    bySibling.set(h.siblingProjectId, entry);
  }

  return (
    <Alert
      data-snapshot-exclude="true"
      className="border-amber-500/30 bg-amber-500/5"
      data-testid="sibling-overlap-warning"
    >
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-sm">Some of your selections also live in sibling Projects</AlertTitle>
      <AlertDescription className="text-xs space-y-2">
        <p className="text-muted-foreground">
          Sibling Projects in this family already include the items below. Projects in a family
          should complement each other — keeping the same concept in two Projects can weaken
          both. Review whether each item belongs in this Project or its sibling.
        </p>
        <ul className="space-y-1.5">
          {Array.from(bySibling.entries()).map(([siblingId, info]) => (
            <li key={siblingId} className="border border-amber-500/20 rounded px-2 py-1.5 bg-background/40">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{info.title}</span>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                >
                  <a
                    href={`/projects/${siblingId}`}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={`overlap-open-${siblingId}`}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open sibling
                  </a>
                </Button>
              </div>
              <ul className="mt-1 space-y-0.5">
                {info.previews.map((p, i) => (
                  <li key={i} className="text-foreground/80">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">{p.kind.replace("_", " ")}</span>
                    {p.preview}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

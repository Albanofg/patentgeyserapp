import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Lightbulb, Plus, Edit2, X, RefreshCw, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CurrentIdeaData {
  currentIdea: string | null;
  currentVersion: number;
  snapshots: any[];
}

interface LogEntry {
  id: string;
  entryType: "pohc" | "leap" | "both";
  verbatimText: string;
  editedText: string | null;
  capturedAt: string;
  capturedBy: "auto" | "manual";
  tags: string[] | null;
  dismissedAt: string | null;
  sourceMessageId: string | null;
  // Enriched by the server from the source assistant message's currentLocation.
  // The trail is a plain-English string like "Key Concepts Selection · Concept 4"
  // — present when we know where the entry came from, null for older rows
  // captured before location stamping landed.
  capturedAtStage?: number | null;
  capturedAtSubstage?: string | null;
  capturedAtLabel?: string | null;
  capturedAtTrail?: string | null;
}

interface OpenQ {
  id: string;
  question: string;
  createdAt: string;
  askedInMessageId: string | null;
}

interface CurrentIdeaModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CurrentIdeaModal({ projectId, open, onOpenChange }: CurrentIdeaModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<"all" | "pohc" | "leap" | "both">("all");
  const [adding, setAdding] = useState(false);
  const [newEntryType, setNewEntryType] = useState<"pohc" | "leap" | "both">("pohc");
  const [newEntryText, setNewEntryText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const idea = useQuery<CurrentIdeaData>({
    queryKey: ["/api/projects", projectId, "current-idea"],
    enabled: !!projectId && open,
  });
  const log = useQuery<LogEntry[]>({
    queryKey: ["/api/projects", projectId, "qa-assistant/log"],
    queryFn: async () =>
      (await fetch(`/api/projects/${projectId}/qa-assistant/log`, { credentials: "include" })).json(),
    enabled: !!projectId && open,
  });
  const openQs = useQuery<OpenQ[]>({
    queryKey: ["/api/projects", projectId, "qa-assistant/open-questions"],
    queryFn: async () =>
      (await fetch(`/api/projects/${projectId}/qa-assistant/open-questions`, { credentials: "include" })).json(),
    enabled: !!projectId && open,
  });

  const backfillMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/projects/${projectId}/backfill-snapshots`),
    onSuccess: () => {
      toast({ title: "Idea Loaded", description: "Your idea has been loaded successfully." });
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "current-idea"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to Load", description: err.message, variant: "destructive" });
    },
  });

  const addEntry = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/projects/${projectId}/qa-assistant/log`, {
        entryType: newEntryType,
        verbatimText: newEntryText,
      }),
    onSuccess: () => {
      setAdding(false);
      setNewEntryText("");
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "qa-assistant/log"] });
    },
  });

  const editEntry = useMutation({
    mutationFn: async ({ entryId, editedText }: { entryId: string; editedText: string }) =>
      apiRequest("PATCH", `/api/projects/${projectId}/qa-assistant/log/${entryId}`, { editedText }),
    onSuccess: () => {
      setEditingId(null);
      setEditText("");
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "qa-assistant/log"] });
    },
  });

  const dismissEntry = useMutation({
    mutationFn: async (entryId: string) =>
      apiRequest("PATCH", `/api/projects/${projectId}/qa-assistant/log/${entryId}`, { dismissed: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "qa-assistant/log"] }),
  });

  const dismissQ = useMutation({
    mutationFn: async (qId: string) =>
      apiRequest("PATCH", `/api/projects/${projectId}/qa-assistant/open-questions/${qId}`, { dismissed: true }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "qa-assistant/open-questions"] }),
  });

  const hasArticulation = !!idea.data?.currentIdea || (idea.data?.snapshots && idea.data.snapshots.length > 0);
  const filteredLog = (log.data ?? []).filter((e) => (filter === "all" ? true : e.entryType === filter));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            Invention Record
          </DialogTitle>
        </DialogHeader>

        {/* Current Articulation */}
        <section className="mt-4">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-semibold">Current Articulation</h3>
            <div className="text-xs text-muted-foreground">v{idea.data?.currentVersion ?? 0}</div>
          </div>
          {idea.isLoading ? (
            <div className="border rounded-md p-4 bg-muted/30 text-sm text-muted-foreground animate-pulse">
              Loading...
            </div>
          ) : !hasArticulation ? (
            <div className="border rounded-md p-6 text-center bg-muted/20">
              <p className="text-sm text-muted-foreground mb-3">
                No articulation yet. Open the AI Helper to start the conversation.
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                If this is an older project, click below to load your idea.
              </p>
              <Button
                onClick={() => backfillMutation.mutate()}
                disabled={backfillMutation.isPending}
                variant="outline"
                size="sm"
                data-testid="button-reconstruct-timeline"
              >
                {backfillMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Load Idea
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="border rounded-md p-4 bg-muted/30">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{idea.data?.currentIdea ?? ""}</ReactMarkdown>
              </div>
            </div>
          )}
        </section>

        {/* Idea Log */}
        <section className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Idea Log ({log.data?.length ?? 0})</h3>
            <div className="flex gap-2 items-center">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className="text-xs border rounded px-2 py-1 bg-background"
              >
                <option value="all">all</option>
                <option value="pohc">POHC</option>
                <option value="leap">leap</option>
                <option value="both">both</option>
              </select>
              <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
                <Plus className="h-4 w-4 mr-1" /> add entry
              </Button>
            </div>
          </div>

          {adding && (
            <div className="border rounded-md p-3 mb-3 space-y-2">
              <select
                value={newEntryType}
                onChange={(e) => setNewEntryType(e.target.value as any)}
                className="text-sm border rounded px-2 py-1 bg-background"
              >
                <option value="pohc">POHC</option>
                <option value="leap">leap</option>
                <option value="both">both</option>
              </select>
              <Textarea
                value={newEntryText}
                onChange={(e) => setNewEntryText(e.target.value)}
                placeholder="The exact words to log..."
                className="h-20"
              />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => addEntry.mutate()}
                  disabled={!newEntryText.trim() || addEntry.isPending}
                >
                  {addEntry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "save"}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {filteredLog.map((e) => (
              <div key={e.id} className="border rounded-md p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mb-1">
                  <span className="inline-block px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                    {e.entryType === "both" ? "LEAP · POHC" : e.entryType.toUpperCase()}
                  </span>
                  <span title={new Date(e.capturedAt).toISOString()}>
                    {new Date(e.capturedAt).toLocaleString()}
                  </span>
                  <span>·</span>
                  <span>{e.capturedBy === "auto" ? "captured from AI Helper" : "added by you"}</span>
                  {Array.isArray(e.tags) && e.tags.length > 0 && (
                    <>
                      <span>·</span>
                      <span className="flex flex-wrap gap-1">
                        {e.tags.map((t) => (
                          <span
                            key={t}
                            className="inline-block px-1.5 py-0.5 rounded bg-muted text-foreground/70 font-mono text-[10px]"
                            title={`Scope tag: ${t}`}
                          >
                            {t}
                          </span>
                        ))}
                      </span>
                    </>
                  )}
                  <span className="flex-1" />
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditingId(e.id);
                        setEditText(e.editedText ?? e.verbatimText);
                      }}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => dismissEntry.mutate(e.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {/* "Captured during" trail — tells the user which workflow
                    step produced this entry. Falls back gracefully when the
                    server didn't record a source location (older entries). */}
                {e.capturedAtTrail ? (
                  <p className="text-[11px] text-muted-foreground mb-1">
                    <span className="text-foreground/80">Captured during:</span>{" "}
                    {e.capturedAtTrail}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground italic mb-1">
                    Captured during an earlier session — workflow location not recorded.
                  </p>
                )}
                {e.editedText && e.editedText !== e.verbatimText && (
                  <p className="text-[10px] text-muted-foreground italic mb-1">
                    Edited from your original — original preserved for the record.
                  </p>
                )}
                {editingId === e.id ? (
                  <div className="space-y-2">
                    <Textarea value={editText} onChange={(ev) => setEditText(ev.target.value)} className="h-20" />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        cancel
                      </Button>
                      <Button size="sm" onClick={() => editEntry.mutate({ entryId: e.id, editedText: editText })}>
                        save edit
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Editing preserves the original verbatim text.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm">{e.editedText ?? e.verbatimText}</p>
                )}
              </div>
            ))}
            {filteredLog.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No entries yet.</p>
            )}
          </div>
        </section>

        {/* Open Questions */}
        <section className="mt-6">
          <h3 className="font-semibold mb-2">Open Questions ({openQs.data?.length ?? 0})</h3>
          <div className="space-y-2">
            {openQs.data?.map((q) => (
              <div key={q.id} className="border rounded-md p-3 flex items-start gap-2">
                <span className="text-sm flex-1">{q.question}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => dismissQ.mutate(q.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {(openQs.data?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No open questions.</p>
            )}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export function CurrentIdeaButton({ projectId }: { projectId: string }) {
  const { data } = useQuery<CurrentIdeaData>({
    queryKey: ["/api/projects", projectId, "current-idea"],
    enabled: !!projectId,
  });

  const hasIdea = data?.currentIdea || (data?.snapshots && data.snapshots.length > 0);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2"
      data-testid="button-view-current-idea"
    >
      <Lightbulb className={`h-4 w-4 ${hasIdea ? "text-primary" : "text-muted-foreground"}`} />
      <span>Invention Record</span>
    </Button>
  );
}

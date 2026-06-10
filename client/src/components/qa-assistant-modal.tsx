import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, User, Loader2, PanelRight, Copy, Check, Brain } from "lucide-react";
import aiHelperAvatar from "@/assets/ai-helper-avatar.png";
import { getCurrentPageSnapshot } from "@/lib/page-snapshot";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface CoachMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: Array<{ name: string; args?: any; result?: any }> | null;
  createdAt: string;
}

// One validated edit from a proposeDraftEdits tool call. `status` comes from
// the server-side anchor validation; only "ready" / "whole_section" edits get
// an Apply button.
interface ProposedDraftEdit {
  section: string;
  find: string;
  replace: string;
  rationale?: string;
  status: "ready" | "whole_section" | "not_found" | "ambiguous";
  matchCount?: number;
}

const SECTION_LABELS: Record<string, string> = {
  title: "TITLE",
  background: "BACKGROUND",
  summary: "SUMMARY",
  detailed_description: "DETAILED DESCRIPTION",
  ramifications_and_scope: "RAMIFICATIONS & SCOPE",
  abstract: "ABSTRACT",
  claims: "KEY CONCEPTS",
};

// Pull the validated edit list out of a persisted toolCalls entry or a
// streamed tool-result event. The executor echoes the validated edits in
// result.edits; fall back to the raw args if an old message predates that.
function extractProposedEdits(call: { name: string; args?: any; result?: any }): ProposedDraftEdit[] {
  if (call.name !== "proposeDraftEdits") return [];
  const fromResult = call.result?.result?.edits ?? call.result?.edits;
  if (Array.isArray(fromResult)) return fromResult;
  const fromArgs = call.args?.edits;
  if (Array.isArray(fromArgs)) return fromArgs.map((e: any) => ({ ...e, status: e.find ? "ready" : "whole_section" }));
  return [];
}

interface QAAssistantPanelProps {
  projectId: string;
  onClose: () => void;
  currentLocation?: string;
  initialText?: string;
  onInitialTextConsumed?: () => void;
}

// SSE consumer for the qa-assistant streaming endpoint.
async function* streamQAAssistant(
  projectId: string,
  body: {
    message: string;
    conversationHistory: any[];
    currentLocation: string;
    pageSnapshot: ReturnType<typeof getCurrentPageSnapshot>;
  },
) {
  const res = await fetch(`/api/projects/${projectId}/qa-assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    yield { type: "error" as const, data: { message: `HTTP ${res.status}`, recoverable: false } };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let dataStr = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataStr += line.slice(6);
      }
      if (!dataStr) continue;
      try {
        const data = JSON.parse(dataStr);
        yield { type: event as "token" | "tool-result" | "done" | "error", data };
      } catch {
        // ignore malformed event
      }
    }
  }
}

export function QAAssistantPanel({
  projectId,
  onClose,
  currentLocation,
  initialText,
  onInitialTextConsumed,
}: QAAssistantPanelProps) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingChips, setStreamingChips] = useState<Array<{ kind: string; label: string }>>([]);
  // Edits from a proposeDraftEdits tool call that arrived mid-stream — shown
  // as apply-able cards immediately, before the message is persisted.
  const [streamingEdits, setStreamingEdits] = useState<ProposedDraftEdit[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [thinkingElapsedSec, setThinkingElapsedSec] = useState(0);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(96);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Drag from the top edge: pulling UP grows the input, pulling DOWN shrinks
  // it. Capped between one line (44px) and 60% of the viewport so it never
  // eats the whole chat area.
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    dragStateRef.current = { startY: e.clientY, startHeight: inputHeight };
    const onMove = (ev: PointerEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      const max = Math.floor(window.innerHeight * 0.6);
      const next = Math.min(max, Math.max(44, s.startHeight + (s.startY - ev.clientY)));
      setInputHeight(next);
    };
    const onUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    if (!isSending) {
      setThinkingElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setThinkingElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [isSending]);

  const { data: messages = [] } = useQuery<CoachMessage[]>({
    queryKey: ["/api/projects", projectId, "qa-assistant/messages"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/qa-assistant/messages?limit=50`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: log = [] } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "qa-assistant/log"],
    queryFn: async () =>
      (await fetch(`/api/projects/${projectId}/qa-assistant/log`, { credentials: "include" })).json(),
    enabled: !!projectId,
  });
  const { data: openQs = [] } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "qa-assistant/open-questions"],
    queryFn: async () =>
      (await fetch(`/api/projects/${projectId}/qa-assistant/open-questions`, { credentials: "include" })).json(),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (initialText) {
      setInput(initialText);
      onInitialTextConsumed?.();
    }
  }, [initialText, onInitialTextConsumed]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingText]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);


  const send = async () => {
    if (!input.trim() || isSending) return;
    const message = input.trim();
    setInput("");
    setIsSending(true);
    setStreamingText("");
    setStreamingChips([]);
    setStreamingEdits([]);

    try {
      for await (const ev of streamQAAssistant(projectId, {
        message,
        conversationHistory: messages.map((m) => ({ role: m.role, content: m.content })),
        currentLocation: currentLocation || "Unknown",
        // Grab the latest page snapshot at send time so the model always sees
        // exactly what the user is looking at right now.
        pageSnapshot: getCurrentPageSnapshot(),
      })) {
        if (ev.type === "token") {
          setStreamingText((prev) => prev + ev.data.delta);
        } else if (ev.type === "tool-result") {
          const r = ev.data;
          if (r.name === "proposeDraftEdits") {
            // Edits render as apply-able diff cards, not a chip.
            const edits = extractProposedEdits({ name: r.name, result: r });
            if (edits.length) setStreamingEdits((prev) => [...prev, ...edits]);
            continue;
          }
          const label =
            r.name === "recordEntry"
              ? `📝 logged ${r.result?.entryType ?? "entry"}`
              : r.name === "updateArticulation"
                ? `✏️ articulation → v${r.result?.version}`
                : r.name === "addOpenQuestion"
                  ? `❓ new open question`
                  : r.name === "closeOpenQuestion"
                    ? `✅ question answered`
                    : r.name === "flagScopeDrift"
                      ? `⚠️ scope check`
                      : r.name;
          setStreamingChips((prev) => [...prev, { kind: r.name, label }]);
        } else if (ev.type === "done") {
          await qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "qa-assistant/messages"] });
          await qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "qa-assistant/log"] });
          await qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "qa-assistant/open-questions"] });
          await qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "current-idea"] });
          setStreamingText("");
          setStreamingChips([]);
          setStreamingEdits([]);
        } else if (ev.type === "error") {
          setStreamingText((prev) => prev + `\n\n⚠️ ${ev.data.message}`);
        }
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Bucket entries by their semantic role. Counts were previously stuck at 0
  // because the reducer keyed by raw entryType ("pohc_answer", "first_conceptual_leap",
  // etc.) while the UI read `logBreakdown.pohc / .leap / .both` — different
  // strings, no match. The real entryTypes are defined in the AI Helper prompt's
  // recordEntry tool spec and are stable categorical labels we group here.
  //
  // POHC bucket: entries that defend Proof of Human Conception — direct PoHC
  //   answers and the conception/contribution facts captured throughout the flow.
  // LEAP bucket: entries that capture the inventor's conceptual leap in their
  //   own words from White Space (Phase 4) and Genus & Species (Phase 6) edits.
  // BOTH bucket: entries that play a dual role — typically Phase 6/7 leaps that
  //   are also tagged to a Key Concept Set, satisfying both inventorship
  //   evidence and conceptual-leap capture from a single entry.
  const POHC_TYPES = new Set(["pohc_answer", "conception", "contribution"]);
  const LEAP_TYPES = new Set(["first_conceptual_leap"]);
  const logBreakdown = log.reduce(
    (acc: { pohc: number; leap: number; both: number; total: number }, e: any) => {
      const t = String(e?.entryType || "");
      const tags: string[] = Array.isArray(e?.tags) ? e.tags.map((x: any) => String(x)) : [];
      const inPohc = POHC_TYPES.has(t);
      const inLeap = LEAP_TYPES.has(t);
      // A leap that is also tagged to a Key Concept Set (or to a PoHC
      // dimension like "_conception" / "_contribution_quality") serves both
      // roles, per the prompt's cross-phase reuse pattern.
      const isBoth = inLeap && tags.some((tg) => /^Key Concept Set\b/i.test(tg) || /_conception$|_contribution_quality$|_exceeding_known$/.test(tg));
      if (isBoth) acc.both++;
      else if (inPohc) acc.pohc++;
      else if (inLeap) acc.leap++;
      acc.total++;
      return acc;
    },
    { pohc: 0, leap: 0, both: 0, total: 0 },
  );

  return (
    <div className="flex flex-col h-full w-full bg-background" data-testid="ai-helper-panel">
      {/* Header */}
      <div className="border-b shrink-0">
        <div className="px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <img src={aiHelperAvatar} alt="" className="h-5 w-5 shrink-0 object-contain" />
            <h2 className="font-semibold truncate">AI Helper</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs font-normal"
            onClick={() => setMemoryOpen(true)}
            data-testid="button-toggle-memory"
          >
            <Brain className="h-3.5 w-3.5" />
            What I know
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onClose}
            data-testid="button-close-ai-helper"
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* "What I know" — modal so the trigger button can sit next to the
          panel's collapse button without accidental closures while the user
          is exploring memory state. */}
      <Dialog open={memoryOpen} onOpenChange={setMemoryOpen}>
        <DialogContent className="max-w-md" data-testid="memory-panel">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-4 w-4" /> What I know
            </DialogTitle>
            <DialogDescription>
              Everything the AI Helper has captured about your project so far.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-4">
            <section>
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="font-semibold text-foreground">Invention log</h3>
                <span className="font-mono text-foreground text-base">{log.length}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Every captured statement about your invention — used as evidence of inventorship.
              </p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border border-border/60 bg-background/60 px-2 py-1.5">
                  <div className="text-muted-foreground">Proof of Human Conception</div>
                  <div className="font-mono text-foreground text-sm mt-0.5">
                    {logBreakdown.pohc ?? 0}
                  </div>
                </div>
                <div className="rounded border border-border/60 bg-background/60 px-2 py-1.5">
                  <div className="text-muted-foreground">Conceptual Leap</div>
                  <div className="font-mono text-foreground text-sm mt-0.5">
                    {logBreakdown.leap ?? 0}
                  </div>
                </div>
                <div className="rounded border border-border/60 bg-background/60 px-2 py-1.5">
                  <div className="text-muted-foreground">Both</div>
                  <div className="font-mono text-foreground text-sm mt-0.5">
                    {logBreakdown.both ?? 0}
                  </div>
                </div>
              </div>
            </section>

            <section className="flex items-baseline justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Open questions</h3>
                <p className="text-xs text-muted-foreground">
                  Questions I've asked that you haven't answered yet.
                </p>
              </div>
              <span className="font-mono text-foreground text-base">{openQs.length}</span>
            </section>

            <section className="flex items-baseline justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Conversation history</h3>
                <p className="text-xs text-muted-foreground">
                  Messages I remember from this project.
                </p>
              </div>
              <span className="font-mono text-foreground text-base">{messages.length}</span>
            </section>

            <section className="pt-2 border-t border-border/40">
              <h3 className="font-semibold text-foreground mb-1">Start fresh</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Use this if the conversation feels stuck. Clears pending questions and lets us pick up from a clean slate. Your saved progress in the invention log stays put.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={async () => {
                  if (!confirm("Start fresh? Any pending question I asked will be set aside. Your invention log is kept.")) return;
                  await fetch(`/api/projects/${projectId}/qa-assistant/force-reset`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: "{}",
                  });
                  await qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "qa-assistant/open-questions"] });
                  await qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "qa-assistant/log"] });
                }}
                data-testid="button-force-reset"
              >
                Start fresh
              </Button>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" ref={scrollRef}>
        {messages.length === 0 && !streamingText && !isSending ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-8">
            <img src={aiHelperAvatar} alt="" className="h-12 w-12 mb-4 opacity-50 object-contain" />
            <p className="text-base font-medium">How can I help you?</p>
            <p className="text-sm mt-2">
              Ask me questions about your patent application, key concepts, or the workflow process.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} projectId={projectId} />
            ))}
            {streamingText && (
              <MessageBubble
                m={{
                  id: "streaming",
                  role: "assistant",
                  content: streamingText,
                  createdAt: "",
                  toolCalls: [],
                }}
                projectId={projectId}
              />
            )}
            {streamingEdits.length > 0 && (
              <div className="pl-2">
                <DraftEditCards projectId={projectId} edits={streamingEdits} />
              </div>
            )}
            {streamingChips.map((c, i) => (
              <div key={i} className="text-xs text-muted-foreground pl-11">
                {c.label}
              </div>
            ))}
            {isSending && !streamingText && (
              <ThinkingBubble elapsedSec={thinkingElapsedSec} />
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t bg-background shrink-0">
        <div
          className="relative rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0"
          style={{ height: inputHeight }}
        >
          {/* Drag handle: pull up to enlarge, pull down to shrink. */}
          <div
            onPointerDown={onResizeStart}
            className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize flex items-center justify-center group"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize input"
            data-testid="resize-input-handle"
          >
            <div className="h-1 w-10 rounded-full bg-border group-hover:bg-muted-foreground/60 transition-colors" />
          </div>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            disabled={isSending}
            data-testid="input-qa-message"
            className="block h-full w-full resize-none rounded-md border-0 bg-transparent pl-3 pr-14 pt-3 pb-10 text-sm leading-6 placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button
            onClick={send}
            disabled={!input.trim() || isSending}
            size="icon"
            className="absolute! bottom-2 right-2 h-8 w-8 z-10 no-default-hover-elevate no-default-active-elevate"
            data-testid="button-send-qa-message"
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Collapse runs of identical tool calls into one chip with a count, so the
// model invoking recordEntry 11 times shows as "↳ recordEntry × 11" instead
// of 11 separate chips that dominate the bubble.
function groupToolCalls(
  calls: Array<{ name: string }>,
): Array<{ name: string; count: number }> {
  const out: Array<{ name: string; count: number }> = [];
  for (const c of calls) {
    const last = out[out.length - 1];
    if (last && last.name === c.name) last.count += 1;
    else out.push({ name: c.name, count: 1 });
  }
  return out;
}

function MessageBubble({ m, projectId }: { m: CoachMessage; projectId: string }) {
  const isUser = m.role === "user";
  const label = isUser ? "You" : "AI Helper";
  // Draft edits render as apply-able cards below the prose; every other tool
  // call stays a compact chip.
  const proposedEdits = (m.toolCalls ?? []).flatMap(extractProposedEdits);
  const chipCalls = (m.toolCalls ?? []).filter((c) => c.name !== "proposeDraftEdits");
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={`message-${m.role}-${m.id}`}
    >
      <div
        className={`rounded-lg px-4 py-3 max-w-full w-full ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        <div className="flex items-center gap-2 mb-2 opacity-80">
          {isUser ? (
            <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-primary-foreground/20">
              <User className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
          ) : (
            <img src={aiHelperAvatar} alt="" className="shrink-0 h-6 w-6 object-contain" />
          )}
          <span className="text-xs font-medium">{label}</span>
        </div>
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap wrap-break-word">{m.content}</p>
        ) : (
          <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-2 wrap-break-word">
            <ReactMarkdown components={{ pre: CopyablePre }}>{m.content}</ReactMarkdown>
          </div>
        )}
        {proposedEdits.length > 0 && (
          <div className="mt-3">
            <DraftEditCards projectId={projectId} edits={proposedEdits} />
          </div>
        )}
        {chipCalls.length ? (
          <div className="mt-2 space-y-1">
            {groupToolCalls(chipCalls).map((g, i) => (
              <div key={i} className="text-xs opacity-70">
                ↳ {g.name}
                {g.count > 1 ? ` × ${g.count}` : ""}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Draft-edit cards ────────────────────────────────────────────────────────
// Each proposeDraftEdits edit renders as a card: destination section, the
// helper's rationale, the text being replaced, the replacement, and an Apply
// button that writes the change to the saved draft server-side. No more
// find / copy / paste round-trips for the inventor.

function DraftEditCards({ projectId, edits }: { projectId: string; edits: ProposedDraftEdit[] }) {
  return (
    <div className="space-y-2" data-testid="draft-edit-cards">
      {edits.map((e, i) => (
        <DraftEditCard key={i} projectId={projectId} edit={e} index={i} />
      ))}
    </div>
  );
}

function DraftEditCard({ projectId, edit, index }: { projectId: string; edit: ProposedDraftEdit; index: number }) {
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "applying" | "applied" | "failed">("idle");
  const [note, setNote] = useState<string>("");

  const sectionLabel = SECTION_LABELS[edit.section] ?? edit.section.toUpperCase();
  const isWholeSection = edit.status === "whole_section" || !edit.find?.trim();
  const validationFailed = edit.status === "not_found" || edit.status === "ambiguous";

  const apply = async () => {
    setState("applying");
    setNote("");
    try {
      const res = await fetch(`/api/projects/${projectId}/apply-draft-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ section: edit.section, find: edit.find ?? "", replace: edit.replace }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok || body?.alreadyApplied) {
        setState("applied");
        if (body?.alreadyApplied) setNote("This change was already in the draft.");
        // Refresh the Showcase tabs + polish payload sources.
        await qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "specification-sections"] });
        await qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "agent", 5] });
      } else {
        setState("failed");
        setNote(body?.message || "Couldn't apply the edit.");
      }
    } catch {
      setState("failed");
      setNote("Couldn't reach the server — try again.");
    }
  };

  return (
    <div
      className="rounded-md border border-border bg-background text-foreground px-3 py-2.5"
      data-testid={`draft-edit-card-${index}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-bold tracking-wide">{sectionLabel}</span>
        {state === "applied" ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
            <Check className="h-3.5 w-3.5" /> Applied
          </span>
        ) : validationFailed ? (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {edit.status === "ambiguous" ? "Needs a more specific anchor" : "Text not found in saved draft"}
          </span>
        ) : (
          <Button
            size="sm"
            className="h-7 px-3 text-xs"
            disabled={state === "applying"}
            onClick={apply}
            data-testid={`button-apply-edit-${index}`}
          >
            {state === "applying" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
          </Button>
        )}
      </div>
      {edit.rationale ? <p className="text-xs text-muted-foreground mb-2">{edit.rationale}</p> : null}
      {isWholeSection ? (
        <p className="text-xs mb-1 font-medium">Replaces the entire {sectionLabel} section with:</p>
      ) : (
        <div className="mb-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">Replaces</p>
          <div className="text-xs font-mono whitespace-pre-wrap rounded bg-red-500/10 border border-red-500/20 px-2 py-1.5 max-h-24 overflow-y-auto">
            {edit.find}
          </div>
        </div>
      )}
      <div>
        {!isWholeSection && (
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">With</p>
        )}
        <div className="text-xs font-mono whitespace-pre-wrap rounded bg-green-500/10 border border-green-500/20 px-2 py-1.5 max-h-40 overflow-y-auto">
          {edit.replace}
        </div>
      </div>
      {note ? (
        <p className={`text-xs mt-1.5 ${state === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{note}</p>
      ) : null}
    </div>
  );
}

/**
 * Wraps the default markdown <pre> with a copy button overlaid in the top-right
 * corner. Clicking copies the entire text content of the code block to the
 * clipboard and briefly flips the button to a "Copied" state.
 */
function CopyablePre({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!preRef.current) return;
    const text = preRef.current.innerText;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard not available; ignore.
    }
  };

  return (
    <div className="relative my-2">
      <pre
        ref={preRef}
        {...rest}
        className="overflow-x-auto rounded-md bg-zinc-900 text-zinc-100 p-3 pr-20 text-xs leading-relaxed"
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 transition-colors"
        data-testid="button-copy-code-block"
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            Copy
          </>
        )}
      </button>
    </div>
  );
}

function ThinkingBubble({ elapsedSec }: { elapsedSec: number }) {
  let label = "Thinking";
  if (elapsedSec >= 3 && elapsedSec < 10) label = "Reading your project context";
  else if (elapsedSec >= 10 && elapsedSec < 25) label = "Working through your idea";
  else if (elapsedSec >= 25 && elapsedSec < 60) label = "Still working — this is a complex one";
  else if (elapsedSec >= 60) label = "Hang tight — large context, deep pass";

  return (
    <div className="flex justify-start" data-testid="ai-thinking-bubble">
      <div className="bg-muted rounded-lg px-4 py-3 max-w-full w-full">
        <div className="flex items-center gap-2 mb-2 opacity-80">
          <img src={aiHelperAvatar} alt="" className="shrink-0 h-6 w-6 object-contain animate-pulse" />
          <span className="text-xs font-medium">AI Helper</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-end gap-1 h-4">
            <span
              className="block w-2 h-2 rounded-full bg-primary/70 animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="block w-2 h-2 rounded-full bg-primary/70 animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="block w-2 h-2 rounded-full bg-primary/70 animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </span>
          <span className="text-sm text-muted-foreground">
            {label}
            {elapsedSec >= 3 && (
              <span className="ml-2 text-xs opacity-60">({elapsedSec}s)</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

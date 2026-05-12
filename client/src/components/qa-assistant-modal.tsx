import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot, User, Loader2 } from "lucide-react";

interface CoachMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: Array<{ name: string; result?: any }> | null;
  createdAt: string;
}

interface QAAssistantModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLocation?: string;
  initialText?: string;
  onInitialTextConsumed?: () => void;
}

// SSE consumer for the qa-assistant streaming endpoint.
async function* streamQAAssistant(
  projectId: string,
  body: { message: string; conversationHistory: any[]; currentLocation: string },
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

export function QAAssistantModal({
  projectId,
  open,
  onOpenChange,
  currentLocation,
  initialText,
  onInitialTextConsumed,
}: QAAssistantModalProps) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingChips, setStreamingChips] = useState<Array<{ kind: string; label: string }>>([]);
  const [isSending, setIsSending] = useState(false);
  const [thinkingElapsedSec, setThinkingElapsedSec] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Tick an elapsed-seconds counter while the AI is working so the user gets
  // visible progress instead of just a spinner.
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
    enabled: open && !!projectId,
  });

  const { data: log = [] } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "qa-assistant/log"],
    queryFn: async () =>
      (await fetch(`/api/projects/${projectId}/qa-assistant/log`, { credentials: "include" })).json(),
    enabled: open && !!projectId,
  });
  const { data: openQs = [] } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "qa-assistant/open-questions"],
    queryFn: async () =>
      (await fetch(`/api/projects/${projectId}/qa-assistant/open-questions`, { credentials: "include" })).json(),
    enabled: open && !!projectId,
  });

  useEffect(() => {
    if (open && initialText) {
      setInput(initialText);
      onInitialTextConsumed?.();
    }
  }, [open, initialText, onInitialTextConsumed]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingText]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const send = async () => {
    if (!input.trim() || isSending) return;
    const message = input.trim();
    setInput("");
    setIsSending(true);
    setStreamingText("");
    setStreamingChips([]);

    try {
      for await (const ev of streamQAAssistant(projectId, {
        message,
        conversationHistory: messages.map((m) => ({ role: m.role, content: m.content })),
        currentLocation: currentLocation || "Unknown",
      })) {
        if (ev.type === "token") {
          setStreamingText((prev) => prev + ev.data.delta);
        } else if (ev.type === "tool-result") {
          const r = ev.data;
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

  const logBreakdown: Record<string, number> = log.reduce((acc: any, e: any) => {
    acc[e.entryType] = (acc[e.entryType] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-150 lg:max-w-275 h-[70vh] lg:h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            AI Helper
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4" ref={scrollRef}>
            {messages.length === 0 && !streamingText ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-8">
                <Bot className="h-12 w-12 mb-4 opacity-50" />
                <p className="text-lg font-medium">How can I help you?</p>
                <p className="text-sm mt-2">
                  Ask me questions about your patent application, key concepts, or the workflow process.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} />
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
                  />
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

          <aside className="hidden lg:flex flex-col w-72 border-l bg-muted/30 p-4 text-xs gap-3 overflow-y-auto shrink-0">
            <div className="font-semibold text-sm">What I remember</div>
            <div>
              <div className="text-muted-foreground">Idea log</div>
              <div>
                {log.length} entries ({logBreakdown.pohc ?? 0} POHC · {logBreakdown.leap ?? 0} leap ·{" "}
                {logBreakdown.both ?? 0} both)
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Open questions</div>
              <div>{openQs.length} open</div>
            </div>
            <div>
              <div className="text-muted-foreground">History</div>
              <div>{messages.length} messages stored</div>
            </div>
          </aside>
        </div>

        <div className="px-6 py-4 border-t bg-background shrink-0">
          <div className="flex gap-2 items-center">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              className="resize-none h-11 overflow-y-auto"
              disabled={isSending}
              data-testid="input-qa-message"
            />
            <Button
              onClick={send}
              disabled={!input.trim() || isSending}
              size="icon"
              data-testid="button-send-qa-message"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageBubble({ m }: { m: CoachMessage }) {
  return (
    <div
      className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
      data-testid={`message-${m.role}-${m.id}`}
    >
      {m.role === "assistant" && (
        <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {m.role === "assistant" ? (
          <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-2">
            <ReactMarkdown>{m.content}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{m.content}</p>
        )}
        {m.toolCalls?.length ? (
          <div className="mt-2 space-y-1">
            {m.toolCalls.map((c, i) => (
              <div key={i} className="text-xs opacity-70">
                ↳ {c.name}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {m.role === "user" && (
        <div className="shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
          <User className="h-4 w-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}

function ThinkingBubble({ elapsedSec }: { elapsedSec: number }) {
  // Progressive labels: short turns get a short message; longer turns get
  // increasingly specific reassurance so the user knows the bot is still alive.
  let label = "Thinking";
  if (elapsedSec >= 3 && elapsedSec < 10) label = "Reading your project context";
  else if (elapsedSec >= 10 && elapsedSec < 25) label = "Working through your idea";
  else if (elapsedSec >= 25 && elapsedSec < 60) label = "Still working — this is a complex one";
  else if (elapsedSec >= 60) label = "Hang tight — large context, deep pass";

  return (
    <div className="flex gap-3 justify-start" data-testid="ai-thinking-bubble">
      <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
        <Bot className="h-4 w-4 text-primary animate-pulse" />
      </div>
      <div className="bg-muted rounded-lg px-4 py-3 flex items-center gap-3 min-w-[220px]">
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
  );
}

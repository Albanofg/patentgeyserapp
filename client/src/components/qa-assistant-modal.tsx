import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot, User, Loader2, X, Copy, Check, Brain, ChevronDown, ChevronUp } from "lucide-react";
import { getCurrentPageSnapshot } from "@/lib/page-snapshot";

interface CoachMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: Array<{ name: string; result?: any }> | null;
  createdAt: string;
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
  const [isSending, setIsSending] = useState(false);
  const [thinkingElapsedSec, setThinkingElapsedSec] = useState(0);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    <div className="flex flex-col h-full w-full bg-background" data-testid="ai-helper-panel">
      {/* Header */}
      <div className="border-b shrink-0">
        <div className="px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Bot className="h-5 w-5 text-primary shrink-0" />
            <h2 className="font-semibold truncate">AI Helper</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs font-normal"
            onClick={() => setMemoryOpen((v) => !v)}
            data-testid="button-toggle-memory"
            aria-expanded={memoryOpen}
          >
            <Brain className="h-3.5 w-3.5" />
            What I know
            {memoryOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onClose}
            data-testid="button-close-ai-helper"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {memoryOpen && (
          <div
            className="px-4 py-4 text-sm border-t border-border/50 bg-muted/30 space-y-4"
            data-testid="memory-panel"
          >
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
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" ref={scrollRef}>
        {messages.length === 0 && !streamingText && !isSending ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-8">
            <Bot className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-base font-medium">How can I help you?</p>
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

      {/* Input */}
      <div className="px-4 py-3 border-t bg-background shrink-0">
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
    </div>
  );
}

function MessageBubble({ m }: { m: CoachMessage }) {
  const isUser = m.role === "user";
  const Icon = isUser ? User : Bot;
  const label = isUser ? "You" : "AI Helper";
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
          <div
            className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
              isUser ? "bg-primary-foreground/20" : "bg-primary/15"
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${isUser ? "text-primary-foreground" : "text-primary"}`} />
          </div>
          <span className="text-xs font-medium">{label}</span>
        </div>
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap wrap-break-word">{m.content}</p>
        ) : (
          <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-2 wrap-break-word">
            <ReactMarkdown components={{ pre: CopyablePre }}>{m.content}</ReactMarkdown>
          </div>
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
          <div className="shrink-0 w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
            <Bot className="h-3.5 w-3.5 text-primary animate-pulse" />
          </div>
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

import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import ReactMarkdown from "react-markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot, User, Loader2 } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface QAAssistantModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLocation?: string;
  initialText?: string;
  onInitialTextConsumed?: () => void;
}

export function QAAssistantModal({ projectId, open, onOpenChange, currentLocation, initialText, onInitialTextConsumed }: QAAssistantModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Handle initial text pre-fill when modal opens with selected text
  useEffect(() => {
    if (open && initialText) {
      setInput(initialText);
      onInitialTextConsumed?.();
    }
  }, [open, initialText, onInitialTextConsumed]);

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      const data = await apiRequest("POST", `/api/projects/${projectId}/qa-assistant`, {
        message,
        conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
        currentLocation: currentLocation || "Unknown",
      });
      return data;
    },
    onSuccess: (data) => {
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.response || "I apologize, but I couldn't process that request. Please try again.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    },
    onError: (error: any) => {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Sorry, I encountered an error: ${error.message || "Please try again later."}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    },
  });

  const handleSend = () => {
    if (!input.trim() || sendMessageMutation.isPending) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    sendMessageMutation.mutate(userMessage.content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] h-[70vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Q&A Assistant
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4" ref={scrollAreaRef}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-8">
              <Bot className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">How can I help you?</p>
              <p className="text-sm mt-2">
                Ask me questions about your patent application, claims, or the workflow process.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  data-testid={`message-${message.role}-${message.id}`}
                >
                  {message.role === "assistant" && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:my-2">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                  {message.role === "user" && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                      <User className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))}
              {sendMessageMutation.isPending && (
                <div className="flex gap-3 justify-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="bg-muted rounded-lg px-4 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-background shrink-0">
          <div className="flex gap-2 items-center">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              className="resize-none h-[44px] overflow-y-auto"
              disabled={sendMessageMutation.isPending}
              data-testid="input-qa-message"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || sendMessageMutation.isPending}
              size="icon"
              data-testid="button-send-qa-message"
            >
              {sendMessageMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

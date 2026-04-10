import { useState, useEffect, useCallback } from 'react';
import { Copy, Check, MessageCircleQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Custom event for Ask AI functionality
export const ASK_AI_EVENT = 'patent-geyser-ask-ai';

export interface AskAIEventDetail {
  selectedText: string;
}

export function CopySelectionButton() {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const [copied, setCopied] = useState(false);

  const handleMouseUp = useCallback(() => {
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      
      if (text && text.length > 0) {
        const range = selection?.getRangeAt(0);
        if (range) {
          const rect = range.getBoundingClientRect();
          setPosition({
            x: rect.left + rect.width / 2,
            y: rect.top - 10
          });
          setSelectedText(text);
          setCopied(false);
        }
      } else {
        setPosition(null);
        setSelectedText('');
      }
    }, 10);
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-copy-button]')) {
      setPosition(null);
      setSelectedText('');
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (selectedText) {
      try {
        await navigator.clipboard.writeText(selectedText);
        setCopied(true);
        setTimeout(() => {
          setPosition(null);
          setSelectedText('');
          setCopied(false);
        }, 1000);
      } catch (err) {
        const textArea = document.createElement('textarea');
        textArea.value = selectedText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => {
          setPosition(null);
          setSelectedText('');
          setCopied(false);
        }, 1000);
      }
    }
  }, [selectedText]);

  const handleAskAI = useCallback(() => {
    if (selectedText) {
      // Dispatch custom event with selected text
      const event = new CustomEvent<AskAIEventDetail>(ASK_AI_EVENT, {
        detail: { selectedText }
      });
      window.dispatchEvent(event);
      // Clear selection UI
      setPosition(null);
      setSelectedText('');
    }
  }, [selectedText]);

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [handleMouseUp, handleMouseDown]);

  if (!position) return null;

  return (
    <div
      data-copy-button
      className="fixed z-[9999] transform -translate-x-1/2 -translate-y-full flex gap-1"
      style={{ left: position.x, top: position.y }}
    >
      <Button
        size="sm"
        variant={copied ? "default" : "secondary"}
        className="shadow-lg gap-1.5 px-3"
        onClick={handleCopy}
        data-testid="button-copy-selection"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Copy
          </>
        )}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        className="shadow-lg gap-1.5 px-3"
        onClick={handleAskAI}
        data-testid="button-ask-ai-selection"
      >
        <MessageCircleQuestion className="h-3.5 w-3.5" />
        Ask AI
      </Button>
    </div>
  );
}

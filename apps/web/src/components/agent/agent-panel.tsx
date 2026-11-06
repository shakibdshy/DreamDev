import { useChat, fetchServerSentEvents } from "@tanstack/ai-react";
import type { UIMessage } from "@tanstack/ai";
import { BotIcon, Loader2Icon, MessageCircleIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@DreamDev/ui/components/button";
import { Input } from "@DreamDev/ui/components/input";

import type { ShellUser } from "../app-shell";

/**
 * The fund assistant: a floating chat panel available on every authenticated
 * page (ticket 3/8). Read-only in this version — write tools and approval
 * cards arrive in ticket 4/8.
 */

export function AgentPanel({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<UIMessage[] | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useChat({
    connection: fetchServerSentEvents("/api/agent/chat"),
    threadId: `web-${user.email}`,
    initialMessages: history ?? [],
  });

  // Load the persisted conversation once, when the panel first opens.
  useEffect(() => {
    if (!open || history) return;
    fetch("/api/agent/chat")
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((body: { messages?: UIMessage[] }) => setHistory(body.messages ?? []))
      .catch(() => setHistory([]));
  }, [open, history]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat.messages.length, chat.isLoading]);

  const send = () => {
    const text = input.trim();
    if (!text || chat.isLoading) return;
    void chat.sendMessage(text);
    setInput("");
  };

  return (
    <>
      <button
        type="button"
        aria-label="Open fund assistant"
        onClick={() => setOpen((v) => !v)}
        className="fixed right-5 bottom-5 z-50 inline-flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        {open ? <XIcon className="size-5" /> : <MessageCircleIcon className="size-5" />}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Fund assistant"
          className="fixed right-5 bottom-20 z-50 flex h-[32rem] w-[calc(100vw-2.5rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        >
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <BotIcon className="size-4 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Fund assistant</p>
              <p className="text-xs text-muted-foreground">Read-only — looks up members, dues, banks</p>
            </div>
            <Button variant="ghost" size="icon" className="ml-auto size-7" aria-label="Close assistant" onClick={() => setOpen(false)}>
              <XIcon className="size-4" />
            </Button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {history !== null && chat.messages.length === 0 && !chat.isLoading ? (
              <div className="space-y-2 pt-8 text-center">
                <BotIcon className="mx-auto size-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">Ask about your fund</p>
                <p className="mx-auto max-w-56 text-xs text-muted-foreground">
                  “What is Rahim’s due?” · “How much did we collect this month?” · “Bank balances?”
                </p>
              </div>
            ) : null}

            {chat.messages.map((message) => (
              <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                      : "max-w-[85%] space-y-1.5 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm"
                  }
                >
                  {message.parts.map((part, index) => {
                    if (part.type === "text" && part.content) {
                      return <p key={index} className="whitespace-pre-wrap">{part.content}</p>;
                    }
                    if (part.type === "tool-call") {
                      return (
                        <p key={index} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2Icon className="size-3 animate-spin" />
                          Looking up fund data…
                        </p>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}

            {chat.isLoading && chat.messages.at(-1)?.role !== "assistant" ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Thinking…
                </div>
              </div>
            ) : null}

            {chat.error ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
                The assistant is unavailable right now. Try again shortly.
              </p>
            ) : null}
          </div>

          <form
            className="flex items-center gap-2 border-t border-border px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about members, dues, banks…"
              aria-label="Message the fund assistant"
            />
            <Button type="submit" size="icon" disabled={!input.trim() || chat.isLoading} aria-label="Send message">
              <SendIcon className="size-4" />
            </Button>
          </form>
        </div>
      ) : null}
    </>
  );
}

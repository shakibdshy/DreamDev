import { useChat, fetchServerSentEvents, type UseChatReturn } from "@tanstack/ai-react";
import type { UIMessage } from "@tanstack/ai";
import { BotIcon, CheckIcon, Loader2Icon, MessageCircleIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatTaka } from "@DreamDev/db/domain/money";
import { Button } from "@DreamDev/ui/components/button";
import { Input } from "@DreamDev/ui/components/input";

import { previewContributionDef, recordContributionDef, type ContributionPreview } from "@/agent/contribution-tools";
import { previewDeleteDef, previewWriteDef, writeRecordDef, deleteRecordDef } from "@/agent/write-tools-defs";
import type { ShellUser } from "../app-shell";

type AgentTools = readonly [typeof previewContributionDef, typeof recordContributionDef, typeof previewWriteDef, typeof writeRecordDef, typeof previewDeleteDef, typeof deleteRecordDef];
type AgentChat = UseChatReturn<AgentTools>;
type AgentUIMessage = AgentChat["messages"][number];

/**
 * The fund assistant: a floating chat panel available on every authenticated
 * page. Contribution recording pauses on a confirm card (ticket 4/8) whose
 * values come from the canonical preview_contribution result — never from
 * model-paraphrased text.
 */

export function AgentPanel({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<AgentUIMessage[] | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useChat({
    connection: fetchServerSentEvents("/api/agent/chat"),
    threadId: `web-${user.email}`,
    initialMessages: history ?? [],
    tools: [previewContributionDef, recordContributionDef, previewWriteDef, writeRecordDef, previewDeleteDef, deleteRecordDef],
  });

  // Load the persisted conversation once, when the panel first opens.
  useEffect(() => {
    if (!open || history) return;
    fetch("/api/agent/chat")
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((body: { messages?: AgentUIMessage[] }) => setHistory(body.messages ?? []))
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

            {chat.interrupts.map((interrupt) => {
              if (interrupt.kind !== "tool-approval") return null;
              if (interrupt.toolName === "record_contribution") {
              // Canonical values from the correlated preview result — the same
              // numbers the service will write, never the model's paraphrase.
              const preview = findLatestPreview(chat.messages as UIMessage<never>[], interrupt.id);
              return (
                <div key={interrupt.id} className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <CheckIcon className="size-4 text-primary" aria-hidden />
                    Confirm contribution
                  </p>
                  {preview ? (
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Member</dt><dd className="font-medium">{preview.memberName}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Amount</dt><dd className="font-medium tabular">{formatTaka(preview.amount)}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Credit Date</dt><dd className="font-medium">{preview.creditDate}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Bank Account</dt><dd className="font-medium">{preview.bankName}</dd></div>
                      <div className="flex justify-between gap-2 border-t border-border pt-1">
                        <dt className="text-muted-foreground">Due after</dt>
                        <dd className={cnDue(preview.dueAfter)}>{preview.dueAfter > 0 ? formatTaka(preview.dueAfter) : preview.dueAfter < 0 ? `Advance ${formatTaka(preview.advanceAfter)}` : "Settled"}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">Waiting for the canonical preview — approve unlocks once it arrives.</p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={!interrupt.canResolve || chat.resuming || !preview}
                      title={preview ? undefined : "Waiting for the canonical preview"}
                      onClick={() => interrupt.resolveInterrupt(true)}
                    >
                      {chat.resuming ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={!interrupt.canResolve || chat.resuming}
                      onClick={() => interrupt.resolveInterrupt(false)}
                    >
                      <XIcon className="size-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              );
              }
              // Generic gated writes/deletes: canonical lines from the correlated preview
              const isDelete = interrupt.toolName === "delete_record";
              const lines = findPreviewLines(chat.messages as UIMessage<never>[], interrupt);
              return (
                <div key={interrupt.id} className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <CheckIcon className="size-4 text-primary" aria-hidden />
                    {isDelete ? "Confirm delete" : "Confirm change"}
                  </p>
                  {lines ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {lines.map((line, index) => (
                        <li key={index} className="text-foreground">{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">Waiting for the canonical preview — approve unlocks once it arrives.</p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={!interrupt.canResolve || chat.resuming || !lines}
                      title={lines ? undefined : "Waiting for the canonical preview"}
                      onClick={() => interrupt.resolveInterrupt(true)}
                    >
                      {chat.resuming ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
                      {isDelete ? "Delete" : "Approve"}
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" disabled={!interrupt.canResolve || chat.resuming} onClick={() => interrupt.resolveInterrupt(false)}>
                      <XIcon className="size-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              );
            })}
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

/**
 * The canonical preview for the interrupt: the result part of the last
 * preview_contribution call. The interrupt's id is the paused tool-call id,
 * so a direct match wins; otherwise the newest preview in the thread.
 */
function findLatestPreview(messages: readonly UIMessage<never>[], interruptId: string): ContributionPreview | null {
  let fallback: ContributionPreview | null = null;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool-result") continue;
      const resultPart = part as { type: "tool-result"; toolCallId?: string; name?: string; content?: unknown };
      if (resultPart.name !== previewContributionDef.name) continue;
      const parsed = parsePreview(resultPart.content);
      if (!parsed) continue;
      if (resultPart.toolCallId === interruptId) return parsed;
      fallback = parsed;
    }
  }
  return fallback;
}

function parsePreview(content: unknown): ContributionPreview | null {
  const raw = typeof content === "string" ? safeJson(content) : content;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<ContributionPreview> & { output?: unknown; result?: unknown };
  const source = (candidate.output ?? candidate.result ?? candidate) as Partial<ContributionPreview>;
  if (typeof source.memberName !== "string" || typeof source.amount !== "number") return null;
  return source as ContributionPreview;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cnDue(due: number): string {
  return due > 0 ? "font-medium text-destructive tabular" : "font-medium text-success tabular";
}

/**
 * Canonical preview lines for a generic write/delete interrupt: the result of
 * the preview_write / preview_delete call whose arguments match the paused
 * call's, falling back to the newest preview result.
 */
function findPreviewLines(messages: UIMessage<never>[], interrupt: { toolName: string; originalArgs: unknown }): string[] | null {
  const previewTool = interrupt.toolName === "delete_record" ? previewDeleteDef.name : previewWriteDef.name;
  let fallback: string[] | null = null;
  const argsOf = new Map<string, string>(); // toolCallId → arguments JSON
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool-call") {
        const call = part as { type: "tool-call"; id?: string; name?: string; arguments?: string };
        if (call.id && call.arguments) argsOf.set(call.id, call.arguments);
      }
    }
  }
  const matches = (callArgs: string | undefined) => {
    if (!callArgs || typeof interrupt.originalArgs !== "object" || interrupt.originalArgs === null) return true; // fallback: latest
    try {
      return stableJson(JSON.parse(callArgs)) === stableJson(interrupt.originalArgs);
    } catch {
      return true;
    }
  };
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool-result") continue;
      const result = part as { type: "tool-result"; toolCallId?: string; name?: string; content?: unknown };
      if (result.name !== previewTool || !result.toolCallId) continue;
      const parsed = parseLines(result.content);
      if (!parsed) continue;
      if (matches(argsOf.get(result.toolCallId))) return parsed;
      fallback = parsed;
    }
  }
  return fallback;
}

function parseLines(content: unknown): string[] | null {
  const raw = typeof content === "string" ? safeJson(content) : content;
  if (!raw || typeof raw !== "object") return null;
  const source = (raw as { lines?: unknown }).lines ?? (raw as { output?: { lines?: unknown } }).output?.lines;
  if (!Array.isArray(source)) return null;
  return source.map(String);
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value ?? null);
  const sorted = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stableJson(v)]);
  return JSON.stringify(sorted);
}

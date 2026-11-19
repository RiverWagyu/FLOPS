"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What is funding?",
  "Why did H100 move today?",
  "How does the pool make money?",
  "How could an AI startup hedge its GPU costs?",
];

/** Floating "Ask FLOPS AI" chat, available on every page. */
export function Assistant() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || enabled !== null) return;
    fetch("/api/assistant")
      .then((r) => r.json())
      .then((d) => setEnabled(Boolean(d.enabled)))
      .catch(() => setEnabled(false));
  }, [open, enabled]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, open]);

  useEffect(() => () => abort.current?.abort(), []);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, page: path }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Something went wrong. Please try again.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: answer }]);
      }
      if (!answer.trim()) throw new Error("No answer came back. Please try again.");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setMessages(history.slice(0, -1));
      setInput(q);
      setError((e as Error).message);
    } finally {
      if (abort.current === ctrl) abort.current = null;
      setBusy(false);
    }
  }

  function reset() {
    abort.current?.abort();
    setMessages([]);
    setError("");
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:brightness-110"
      >
        <Sparkle />
        Ask FLOPS AI
      </button>
    );
  }

  return (
    <aside
      aria-label="FLOPS assistant"
      className="fixed bottom-4 right-4 z-50 flex h-[min(560px,calc(100vh-6rem))] w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-md border border-line bg-panel shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Sparkle className="text-accent" />
        <div className="whitespace-nowrap text-sm font-semibold">FLOPS assistant</div>
        <span className="whitespace-nowrap rounded bg-panel-3 px-1.5 py-0.5 text-[10px] text-muted" title="Answers come from AI and can be wrong">
          AI beta
        </span>
        <div className="ml-auto flex items-center gap-1">
          {messages.length > 0 && (
            <button type="button" onClick={reset} className="whitespace-nowrap rounded px-2 py-1 text-[11px] text-muted hover:text-fg">
              New chat
            </button>
          )}
          <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded px-2 py-1 text-muted hover:text-fg">
            ✕
          </button>
        </div>
      </div>

      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted">
              Ask anything about FLOPS or GPU prices in plain language. I can see live prices and the latest (simulated)
              news, but not your wallet. Answers come from AI and can be wrong.
            </p>
            {enabled === false ? (
              <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                The assistant isn&apos;t set up on this site yet.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded border border-line px-3 py-2 text-left text-xs hover:border-accent hover:bg-panel-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 rounded-md bg-accent/20 px-3 py-2 text-sm">
              {m.content}
            </div>
          ) : (
            <div key={i} className="mr-4 text-sm leading-relaxed">
              {m.content ? <Rich text={m.content} /> : <Dots />}
            </div>
          ),
        )}
        {error && <p className="text-xs text-short">{error}</p>}
      </div>

      <form
        className="flex items-end gap-2 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          maxLength={1500}
          placeholder="Ask about funding, prices, the pool…"
          disabled={enabled === false}
          className="max-h-28 min-h-[38px] flex-1 resize-none rounded border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || enabled === false}
          className="h-[38px] rounded bg-accent px-3 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </aside>
  );
}

/** Renders the small markdown subset the assistant is asked to use: paragraphs, "- " lists, **bold**. */
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let numbered = false;
  const flush = () => {
    if (bullets.length === 0) return;
    const items = bullets.map((b, i) => <li key={i}>{inline(b)}</li>);
    blocks.push(
      numbered ? (
        <ol key={blocks.length} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      ),
    );
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const num = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      if (bullets.length > 0 && numbered !== Boolean(num)) flush();
      numbered = Boolean(num);
      bullets.push((bullet ?? num)![1]);
    } else {
      flush();
      if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
    }
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}

function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 12l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" />
    </svg>
  );
}

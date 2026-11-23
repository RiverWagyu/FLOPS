"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Toast = {
  id: number;
  kind: "pending" | "success" | "error" | "info";
  title: string;
  body?: string;
  /** A link button under the body, e.g. "Open MetaMask" while a phone wallet request waits. */
  action?: { label: string; href: string };
};
type Api = { push: (t: Omit<Toast, "id">) => number; update: (id: number, t: Partial<Toast>) => void };

const Ctx = createContext<Api | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const api = useMemo<Api>(
    () => ({
      push: (t) => {
        const id = nextId++;
        setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
        if (t.kind !== "pending") setTimeout(() => dismiss(id), 5000);
        return id;
      },
      update: (id, patch) => {
        setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
        if (patch.kind && patch.kind !== "pending") setTimeout(() => dismiss(id), patch.kind === "error" ? 8000 : 4000);
      },
    }),
    [dismiss],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="rounded-md border border-line bg-panel-2 px-3 py-2.5 text-sm shadow-xl shadow-black/40"
          >
            <div className="flex items-center gap-2">
              <span
                className={
                  "h-2 w-2 shrink-0 rounded-full " +
                  (t.kind === "pending"
                    ? "animate-pulse bg-accent"
                    : t.kind === "success"
                      ? "bg-long"
                      : t.kind === "error"
                        ? "bg-short"
                        : "bg-muted")
                }
              />
              <span className="font-medium text-fg">{t.title}</span>
              <button onClick={() => dismiss(t.id)} className="ml-auto text-muted hover:text-fg" aria-label="Dismiss">
                ×
              </button>
            </div>
            {t.body && <p className="mt-1 pl-4 text-xs text-muted">{t.body}</p>}
            {t.action && t.kind === "pending" && (
              <a
                href={t.action.href}
                className="ml-4 mt-2 inline-block rounded border border-accent/60 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10"
              >
                {t.action.label}
              </a>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx;
}

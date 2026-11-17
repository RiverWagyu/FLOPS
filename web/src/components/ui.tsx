import type { ReactNode } from "react";

export function Panel({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-md border border-line bg-panel ${className}`}>
      {children}
    </section>
  );
}

export function PanelHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-10 items-center justify-between border-b border-line px-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex gap-1 ${className}`}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={
            "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
            (value === it.value ? "bg-panel-3 text-fg" : "text-muted hover:text-fg")
          }
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, className = "" }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[11px] text-muted">{label}</div>
      <div className="num text-sm text-fg">{value}</div>
      {sub && <div className="num text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-24 items-center justify-center text-xs text-muted">{children}</div>;
}

export function SideBadge({ isLong, lev }: { isLong: boolean; lev?: number }) {
  return (
    <span className={`num text-xs font-semibold ${isLong ? "text-long" : "text-short"}`}>
      {isLong ? "LONG" : "SHORT"}
      {lev !== undefined && <span className="ml-1 font-normal text-muted">{lev.toFixed(1)}x</span>}
    </span>
  );
}

export function Button({
  children,
  className = "",
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "long" | "short" | "accent" | "ghost" }) {
  const styles = {
    default: "bg-panel-3 text-fg hover:bg-line",
    long: "bg-long text-black hover:brightness-110",
    short: "bg-short text-white hover:brightness-110",
    accent: "bg-accent text-white hover:brightness-110",
    ghost: "text-muted hover:text-fg hover:bg-panel-3",
  }[variant];
  return (
    <button
      {...props}
      className={`rounded px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

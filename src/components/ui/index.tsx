import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn, titleCase } from "@/lib/cn";

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
const btn: Record<BtnVariant, string> = {
  primary: "bg-calm-400 text-ink-950 hover:bg-calm-300 shadow-glow",
  secondary: "border border-white/10 bg-white/[0.04] text-mist-100 hover:bg-white/[0.08]",
  ghost: "text-mist-200 hover:bg-white/[0.06]",
  danger: "border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20",
  quiet: "text-mist-300 hover:text-white",
};
const btnBase = "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

export function Button({ variant = "secondary", className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant }) {
  return <button {...p} className={cn(btnBase, btn[variant], className)} />;
}

export function LinkButton({ variant = "secondary", className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link {...p} className={cn(btnBase, btn[variant], className)} />;
}

const tone: Record<string, string> = {
  neutral: "bg-white/[0.06] text-mist-200 border-white/10",
  calm: "bg-calm-400/10 text-calm-200 border-calm-400/25",
  ok: "bg-ok/10 text-ok border-ok/25",
  warn: "bg-warn/10 text-warn border-warn/25",
  bad: "bg-bad/10 text-bad border-bad/25",
  violet: "bg-violet/10 text-violet border-violet/25",
  paper: "bg-paper-100/10 text-paper-200 border-paper-200/20",
};

export function Badge({ tone: t = "neutral", className, children, dot }: { tone?: keyof typeof tone | string; className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", tone[t] ?? tone.neutral, className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  // review
  draft: "neutral",
  in_production: "calm",
  ready_for_review: "warn",
  changes_requested: "violet",
  approved: "ok",
  rejected: "bad",
  published: "calm",
  // production / step
  planning: "neutral",
  pending: "neutral",
  queued: "calm",
  running: "calm",
  paused: "warn",
  awaiting_input: "warn",
  awaiting_approval: "warn",
  completed: "ok",
  failed: "bad",
  blocked: "bad",
  skipped: "neutral",
  cancelled: "neutral",
  // canon
  official: "ok",
  ai_proposal: "violet",
  experimental: "violet",
  archived: "neutral",
  superseded: "neutral",
  pending_approval: "warn",
  // references
  official_master: "ok",
  approved_supporting: "calm",
  style_inspiration: "paper",
  unclassified: "neutral",
  // game
  concept: "neutral",
  validation_failed: "bad",
  technically_validated: "ok",
  // providers
  connected: "ok",
  disconnected: "neutral",
  error: "bad",
  unknown: "neutral",
  proposed: "violet",
  scheduled: "calm",
};

const STATUS_LABEL: Record<string, string> = {
  official: "Official canon",
  ai_proposal: "AI proposal",
  draft: "Draft",
  official_master: "Official master",
  approved_supporting: "Approved supporting",
  style_inspiration: "Style inspiration only",
  awaiting_input: "Needs you",
  awaiting_approval: "Awaiting approval",
  ready_for_review: "Ready for review",
  published: "Published / exported",
  technically_validated: "Technically validated",
};

export function Status({ value, className }: { value: string; className?: string }) {
  const live = value === "running" || value === "queued";
  return (
    <Badge tone={STATUS_TONE[value] ?? "neutral"} className={cn(live && "animate-pulseSoft", className)} dot>
      {STATUS_LABEL[value] ?? titleCase(value)}
    </Badge>
  );
}

export function Card({ className, children, ...p }: ComponentProps<"div">) {
  return (
    <div {...p} className={cn("panel p-5", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, sub, action, className }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4", className)}>
      <div>
        <h2 className="font-display text-lg text-white">{title}</h2>
        {sub && <p className="mt-0.5 text-sm text-mist-400">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-6 animate-rise">
      <div className="max-w-3xl">
        {eyebrow && <div className="label mb-2 text-calm-300/80">{eyebrow}</div>}
        <h1 className="font-display text-[34px] leading-tight tracking-tight text-white">{title}</h1>
        {sub && <p className="mt-2 text-[15px] text-mist-300">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-mist-400">{icon}</div>}
      <div className="font-display text-lg text-mist-100">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-mist-400">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Neutral, clearly-labelled placeholder – never an invented character design. */
export function Placeholder({ label = "No approved reference yet", className, aspect = "aspect-square" }: { label?: string; className?: string; aspect?: string }) {
  return (
    <div className={cn("relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/10 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.025)_0_10px,transparent_10px_20px)]", aspect, className)}>
      <span className="px-3 text-center text-[11px] uppercase tracking-[0.14em] text-mist-500">{label}</span>
    </div>
  );
}

export function Stat({ label, value, sub, tone: t }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "bad" | "calm" }) {
  return (
    <div className="panel-quiet p-4">
      <div className="label">{label}</div>
      <div className={cn("mt-1.5 font-display text-2xl text-white", t === "ok" && "text-ok", t === "warn" && "text-warn", t === "bad" && "text-bad", t === "calm" && "text-calm-300")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-mist-400">{sub}</div>}
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <div className="h-full rounded-full bg-gradient-to-r from-calm-500 to-calm-300 transition-all" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-mist-500">{hint}</span>}
    </label>
  );
}

export function KeyVal({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.05] py-1.5 text-sm last:border-0">
      <span className="text-mist-400">{k}</span>
      <span className="text-right text-mist-100">{v}</span>
    </div>
  );
}

export function Notice({ tone: t = "calm", title, children, action }: { tone?: "calm" | "warn" | "bad" | "ok"; title: string; children?: ReactNode; action?: ReactNode }) {
  const c = { calm: "border-calm-400/25 bg-calm-400/[0.06]", warn: "border-warn/25 bg-warn/[0.06]", bad: "border-bad/30 bg-bad/[0.07]", ok: "border-ok/25 bg-ok/[0.06]" }[t];
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3", c)}>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        {children && <div className="mt-0.5 text-sm text-mist-300">{children}</div>}
      </div>
      {action}
    </div>
  );
}

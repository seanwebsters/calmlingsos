"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { api, ApiError } from "./api";

const variants = {
  primary: "bg-calm-400 text-ink-950 hover:bg-calm-300 shadow-glow",
  secondary: "border border-white/10 bg-white/[0.04] text-mist-100 hover:bg-white/[0.08]",
  ghost: "text-mist-200 hover:bg-white/[0.06]",
  danger: "border border-bad/30 bg-bad/10 text-bad hover:bg-bad/20",
  ok: "border border-ok/30 bg-ok/10 text-ok hover:bg-ok/20",
};

export function ErrorNote({ error }: { error: ApiError | Error | null }) {
  if (!error) return null;
  const href = error instanceof ApiError ? error.details?.setupHref : undefined;
  return (
    <div className="mt-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
      {error.message}
      {href && (
        <Link href={href} className="ml-2 font-medium underline">
          Fix this →
        </Link>
      )}
    </div>
  );
}

/** A button that calls an API route, shows progress and real errors, then refreshes server data. */
export function Action({
  endpoint,
  method = "POST",
  body,
  children,
  variant = "secondary",
  confirm,
  prompt,
  promptField = "notes",
  className,
  onDone,
  redirectTo,
  disabled,
  size = "md",
}: {
  endpoint: string;
  method?: string;
  body?: Record<string, unknown>;
  children: ReactNode;
  variant?: keyof typeof variants;
  confirm?: string;
  prompt?: string;
  promptField?: string;
  className?: string;
  onDone?: (result: unknown) => void;
  redirectTo?: string | ((result: Record<string, unknown>) => string);
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={busy || disabled}
        className={cn("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm", variants[variant], className)}
        onClick={async () => {
          setError(null);
          let payload = body ?? {};
          if (prompt) {
            const v = window.prompt(prompt);
            if (v === null) return;
            payload = { ...payload, [promptField]: v };
          }
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          try {
            const res = await api<Record<string, unknown>>(endpoint, { method, body: payload });
            onDone?.(res);
            if (redirectTo) router.push(typeof redirectTo === "function" ? redirectTo(res) : redirectTo);
            else router.refresh();
          } catch (e) {
            setError(e as Error);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {children}
      </button>
      <ErrorNote error={error} />
    </span>
  );
}

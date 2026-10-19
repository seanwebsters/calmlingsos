"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { cn } from "@/lib/cn";

export interface Candidate {
  id: string;
  title: string;
  body: string;
  meta?: string;
  score?: number | null;
  flags?: string[];
  imageUrl?: string | null;
}

export function Selection({ stepId, candidates, max }: { stepId: string; candidates: Candidate[]; max: number }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  return (
    <div>
      <div className="mb-3 text-sm text-mist-300">Choose up to {max}. Your choices – and any reasons you give for passing – are logged as creative decisions that steer future ranking.</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {candidates.map((c) => {
          const on = picked.includes(c.id);
          return (
            <div key={c.id} className={cn("rounded-xl border p-4 transition", on ? "border-calm-300/60 bg-calm-400/[0.08]" : "border-white/[0.07] bg-ink-900/60")}>
              <button className="w-full text-left" onClick={() => setPicked(on ? picked.filter((x) => x !== c.id) : picked.length < max ? [...picked, c.id] : max === 1 ? [c.id] : picked)}>
                {c.imageUrl && <img src={c.imageUrl} alt={c.title} className="checker mb-3 aspect-square w-full rounded-lg object-contain" />}
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-white">{c.title}</div>
                  {typeof c.score === "number" && <span className="rounded-md bg-white/[0.06] px-1.5 text-xs text-calm-200">{c.score.toFixed(1)}</span>}
                </div>
                {c.meta && <div className="mt-0.5 text-[11px] text-mist-500">{c.meta}</div>}
                <p className="mt-2 text-sm text-mist-300">{c.body}</p>
                {c.flags && c.flags.length > 0 && <div className="mt-2 text-xs text-warn">⚑ {c.flags.join("; ")}</div>}
              </button>
              {!on && <input value={reasons[c.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [c.id]: e.target.value })} placeholder="Why pass? (optional, teaches the system)" className="field mt-3 py-1 text-xs" />}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          disabled={busy || !picked.length}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/api/steps/${stepId}/select`, { body: { selected: picked, reasons } });
              router.refresh();
            } catch (e) {
              setError(e as Error);
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg bg-calm-400 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-calm-300 disabled:opacity-50"
        >
          Continue with {picked.length || "…"} selected
        </button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

export function AgentEditor({ agentKey, instructions, enabled, budget, quality }: { agentKey: string; instructions: string; enabled: boolean; budget: number; quality: string }) {
  const router = useRouter();
  const [s, setS] = useState({ instructions, enabled, budget, quality });
  const [error, setError] = useState<Error | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <div className="space-y-3">
      <textarea value={s.instructions} onChange={(e) => setS({ ...s, instructions: e.target.value })} rows={14} className="field font-mono text-xs" />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-mist-200"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} className="accent-calm-400" />Enabled</label>
        <label className="text-sm text-mist-300">Budget per run (¢) <input type="number" value={s.budget} onChange={(e) => setS({ ...s, budget: Number(e.target.value) })} className="field ml-2 inline w-24 py-1" /></label>
        <label className="text-sm text-mist-300">Quality <select value={s.quality} onChange={(e) => setS({ ...s, quality: e.target.value })} className="field ml-2 inline w-32 py-1">{["best", "balanced", "fast", "cheap"].map((q) => <option key={q}>{q}</option>)}</select></label>
        <button onClick={async () => { setError(null); try { await api("/api/agents", { method: "PATCH", body: { key: agentKey, instructions: s.instructions, enabled: s.enabled, budgetCentsPerRun: s.budget, qualityPreference: s.quality } }); setOk(true); router.refresh(); } catch (e) { setError(e as Error); } }} className="rounded-lg bg-calm-400 px-3 py-1.5 text-sm font-medium text-ink-950">Save agent</button>
        {ok && <span className="text-xs text-ok">Saved</span>}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

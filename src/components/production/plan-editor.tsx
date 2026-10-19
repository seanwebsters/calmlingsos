"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { usd } from "@/lib/cn";

interface Step {
  key: string;
  name: string;
  agentKey: string | null;
  handler: string;
  requiresApproval: boolean;
  providerOverride: string | null;
  budgetEstimateCents: number;
  human: boolean;
}

export function PlanEditor({ productionId, steps, agents, providers, budgetCents, canStart }: { productionId: string; steps: Step[]; agents: { key: string; name: string; department: string }[]; providers: { key: string; name: string; connected: boolean }[]; budgetCents: number; canStart: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(steps.map((s) => ({ ...s, remove: false })));
  const [budget, setBudget] = useState((budgetCents / 100).toFixed(2));
  const [reviewAfter, setReviewAfter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const total = rows.filter((r) => !r.remove).reduce((n, r) => n + r.budgetEstimateCents, 0);

  async function save(start: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/productions/${productionId}/plan`, {
        body: {
          budgetCents: Math.round(Number(budget) * 100),
          steps: rows.map((r) => ({ key: r.key, name: r.name, agentKey: r.agentKey, requiresApproval: r.requiresApproval, providerOverride: r.providerOverride || null, budgetEstimateCents: r.budgetEstimateCents, remove: r.remove || undefined })),
          insertReviewAfter: reviewAfter || undefined,
        },
      });
      if (start) await api(`/api/productions/${productionId}/start`, { body: {} });
      router.refresh();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label text-calm-300">Execution plan – edit before anything costly runs</div>
          <p className="mt-1 text-sm text-mist-400">Change agents, add human review, set provider overrides per step, remove optional steps, or adjust the budget.</p>
        </div>
        <div className="flex items-end gap-3">
          <label className="text-xs"><span className="label mb-1 block">Budget (USD)</span><input value={budget} onChange={(e) => setBudget(e.target.value)} className="field w-28" /></label>
          <div className="pb-2 text-xs text-mist-400">Estimated {usd(total)}</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-mist-500">
            <tr><th className="py-2">#</th><th>Step</th><th>Agent</th><th>Human approval</th><th>Provider</th><th className="text-right">Estimate</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className={r.remove ? "opacity-40 line-through" : "border-t border-white/[0.04]"}>
                <td className="py-2 pr-2 font-mono text-xs text-mist-500">{i + 1}</td>
                <td className="pr-2"><input value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="field py-1 text-xs" /></td>
                <td className="pr-2">
                  {r.human ? <span className="text-xs text-warn">Creative director</span> : r.agentKey === null ? <span className="text-xs text-mist-500">deterministic</span> : (
                    <select value={r.agentKey} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, agentKey: e.target.value } : x)))} className="field py-1 text-xs">
                      {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="pr-2">{r.human ? <span className="text-xs text-warn">always</span> : <input type="checkbox" checked={r.requiresApproval} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, requiresApproval: e.target.checked } : x)))} className="accent-calm-400" />}</td>
                <td className="pr-2">
                  {!r.human && r.agentKey !== null && (
                    <select value={r.providerOverride ?? ""} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, providerOverride: e.target.value || null } : x)))} className="field py-1 text-xs">
                      <option value="">Router decides</option>
                      {providers.map((p) => <option key={p.key} value={p.key}>{p.name}{p.connected ? "" : " (not connected)"}</option>)}
                    </select>
                  )}
                </td>
                <td className="text-right text-xs text-mist-300">{usd(r.budgetEstimateCents)}</td>
                <td className="pl-2"><button onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, remove: !x.remove } : x)))} className="text-mist-500 hover:text-bad" title="Remove step"><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select value={reviewAfter} onChange={(e) => setReviewAfter(e.target.value)} className="field w-64 py-1.5 text-xs">
          <option value="">Insert a human review after…</option>
          {rows.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
        <div className="flex-1" />
        <button disabled={busy} onClick={() => save(false)} className="rounded-lg border border-white/10 px-3.5 py-2 text-sm text-mist-100 hover:bg-white/[0.06]">Save plan</button>
        {canStart && <button disabled={busy} onClick={() => save(true)} className="rounded-lg bg-calm-400 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-calm-300">Approve plan & start</button>}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

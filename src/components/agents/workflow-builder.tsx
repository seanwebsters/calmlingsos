"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { cn, usd } from "@/lib/cn";

interface StepDef {
  key: string;
  name: string;
  agent: string | null;
  handler: string;
  dependsOn: string[];
  config: Record<string, unknown>;
  condition?: { step: string; path: string; op: "eq" | "neq" | "gt" | "lt" | "truthy" | "falsy"; value?: unknown } | null;
  requiresApproval?: boolean;
  maxAttempts?: number;
  budgetEstimateCents?: number;
}
interface StepType {
  key: string;
  label: string;
  handler: string;
  agent: string | null;
  inputSchema: string;
  outputSchema: string;
  description: string;
  capabilities: string[];
  estimateCents: number;
  human?: boolean;
}

export function WorkflowBuilder({ template, stepTypes, agents, canEdit }: { template: { key: string; name: string; department: string; description: string; briefSchema: string; steps: StepDef[]; builtIn: boolean }; stepTypes: StepType[]; agents: { key: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(template.builtIn ? `${template.name} (custom)` : template.name);
  const [steps, setSteps] = useState<StepDef[]>(template.steps);
  const [sel, setSel] = useState<string | null>(steps[0]?.key ?? null);
  const [error, setError] = useState<Error | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const depth = useMemo(() => {
    const d: Record<string, number> = {};
    const get = (k: string, seen = new Set<string>()): number => {
      if (d[k] !== undefined) return d[k];
      if (seen.has(k)) return 0;
      seen.add(k);
      const s = steps.find((x) => x.key === k);
      d[k] = s && s.dependsOn.length ? 1 + Math.max(...s.dependsOn.map((x) => get(x, seen))) : 0;
      return d[k];
    };
    steps.forEach((s) => get(s.key));
    return d;
  }, [steps]);
  const cols = Math.max(0, ...Object.values(depth)) + 1;
  const step = steps.find((s) => s.key === sel);
  const upd = (p: Partial<StepDef>) => setSteps(steps.map((s) => (s.key === sel ? { ...s, ...p } : s)));
  const typeOf = (s: StepDef) => stepTypes.find((t) => t.key === s.config.type);

  function addStep(typeKey: string) {
    const t = stepTypes.find((x) => x.key === typeKey)!;
    let key = typeKey;
    let i = 2;
    while (steps.some((s) => s.key === key)) key = `${typeKey}_${i++}`;
    const after = sel ? [sel] : [];
    setSteps([...steps, { key, name: t.label, agent: t.agent, handler: t.handler, dependsOn: after, config: { type: t.key }, requiresApproval: false, maxAttempts: 3, budgetEstimateCents: t.estimateCents }]);
    setSel(key);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1"><span className="label mb-1 block">Template name</span><input disabled={!canEdit} value={name} onChange={(e) => setName(e.target.value)} className="field" /></label>
        <div className="text-xs text-mist-400">Brief: {template.briefSchema} · {steps.length} steps · est. {usd(steps.reduce((n, s) => n + (s.budgetEstimateCents ?? 0), 0))} base</div>
        {canEdit && (
          <button
            onClick={async () => {
              setError(null);
              try {
                const r = await api<{ key: string }>("/api/workflows", { body: { key: template.builtIn ? undefined : template.key, name, department: template.department, description: template.description, briefSchema: template.briefSchema, steps } });
                setSaved(r.key);
                router.push(`/agents?tab=workflows&key=${r.key}`);
                router.refresh();
              } catch (e) {
                setError(e as Error);
              }
            }}
            className="rounded-lg bg-calm-400 px-4 py-2 text-sm font-medium text-ink-950"
          >
            {template.builtIn ? "Save as custom template" : "Save new version"}
          </button>
        )}
      </div>
      {saved && <div className="text-xs text-ok">Saved as {saved}. It now appears in its department studio.</div>}
      <ErrorNote error={error} />
      <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-ink-950/60 p-4">
        <div className="flex gap-6" style={{ minWidth: cols * 210 }}>
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="w-[190px] shrink-0 space-y-2">
              {steps.filter((s) => depth[s.key] === c).map((s) => {
                const t = typeOf(s);
                return (
                  <button key={s.key} onClick={() => setSel(s.key)} className={cn("w-full rounded-xl border p-2.5 text-left transition", sel === s.key ? "border-calm-300/60 bg-calm-400/10" : "border-white/[0.07] bg-ink-850 hover:border-white/20", t?.human && "border-warn/30")}>
                    <div className="truncate text-[13px] text-white">{s.name}</div>
                    <div className="truncate text-[10px] text-mist-500">{t?.human ? "human" : s.agent ? agents.find((a) => a.key === s.agent)?.name : "deterministic"}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
                      {s.requiresApproval && <span className="rounded bg-warn/15 px-1 text-warn">approval</span>}
                      {s.condition && <span className="rounded bg-violet/15 px-1 text-violet">if {s.condition.path}</span>}
                      {s.dependsOn.length > 1 && <span className="rounded bg-white/[0.06] px-1 text-mist-400">joins {s.dependsOn.length}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">Add step after selected:</span>
          <select onChange={(e) => e.target.value && (addStep(e.target.value), (e.target.value = ""))} className="field w-72 py-1.5 text-xs" defaultValue="">
            <option value="">Choose from the step library…</option>
            {stepTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <Plus className="size-4 text-mist-500" />
        </div>
      )}
      {step && (
        <div className="panel-quiet grid gap-3 p-4 md:grid-cols-2">
          <div className="md:col-span-2 flex items-center justify-between">
            <div className="text-sm text-white">{step.key} <span className="text-mist-500">· {typeOf(step)?.description}</span></div>
            {canEdit && <button onClick={() => { setSteps(steps.filter((s) => s.key !== step.key).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== step.key) }))); setSel(null); }} className="text-mist-500 hover:text-bad"><Trash2 className="size-4" /></button>}
          </div>
          <div className="text-xs text-mist-400">Input schema: <span className="text-mist-200">{typeOf(step)?.inputSchema}</span></div>
          <div className="text-xs text-mist-400">Output schema: <span className="text-mist-200">{typeOf(step)?.outputSchema}</span> · tools: {typeOf(step)?.capabilities.join(", ") || "none"}</div>
          <label><span className="label mb-1 block">Name</span><input disabled={!canEdit} value={step.name} onChange={(e) => upd({ name: e.target.value })} className="field" /></label>
          <label><span className="label mb-1 block">Agent</span>
            <select disabled={!canEdit || typeOf(step)?.human || step.agent === null} value={step.agent ?? ""} onChange={(e) => upd({ agent: e.target.value || null })} className="field">
              <option value="">(none)</option>
              {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
            </select>
          </label>
          <div className="md:col-span-2"><span className="label mb-1 block">Depends on</span>
            <div className="flex flex-wrap gap-1.5">{steps.filter((s) => s.key !== step.key).map((s) => { const on = step.dependsOn.includes(s.key); return <button key={s.key} disabled={!canEdit} onClick={() => upd({ dependsOn: on ? step.dependsOn.filter((d) => d !== s.key) : [...step.dependsOn, s.key] })} className={cn("rounded-full border px-2 py-0.5 text-[11px]", on ? "border-calm-300/50 bg-calm-400/15 text-white" : "border-white/10 text-mist-400")}>{s.key}</button>; })}</div>
          </div>
          <label className="flex items-center gap-2 text-sm text-mist-200"><input disabled={!canEdit} type="checkbox" checked={Boolean(step.requiresApproval)} onChange={(e) => upd({ requiresApproval: e.target.checked })} className="accent-calm-400" />Require human approval of this step's output</label>
          <div className="grid grid-cols-2 gap-2">
            <label><span className="label mb-1 block">Retries</span><input disabled={!canEdit} type="number" min={1} max={10} value={step.maxAttempts ?? 3} onChange={(e) => upd({ maxAttempts: Number(e.target.value) })} className="field" /></label>
            <label><span className="label mb-1 block">Budget estimate (¢)</span><input disabled={!canEdit} type="number" value={step.budgetEstimateCents ?? 0} onChange={(e) => upd({ budgetEstimateCents: Number(e.target.value) })} className="field" /></label>
          </div>
          <div className="md:col-span-2"><span className="label mb-1 block">Branch condition (run only if…)</span>
            <div className="flex flex-wrap gap-2">
              <select disabled={!canEdit} value={step.condition?.step ?? ""} onChange={(e) => upd({ condition: e.target.value ? { step: e.target.value, path: step.condition?.path ?? "", op: step.condition?.op ?? "truthy", value: step.condition?.value } : null })} className="field w-40 py-1 text-xs">
                <option value="">Always run</option>
                <option value="$brief">brief field</option>
                {steps.filter((s) => s.key !== step.key).map((s) => <option key={s.key} value={s.key}>{s.key} output</option>)}
              </select>
              {step.condition && (
                <>
                  <input disabled={!canEdit} value={step.condition.path} onChange={(e) => upd({ condition: { ...step.condition!, path: e.target.value } })} placeholder="path e.g. includeVideo or passed" className="field w-48 py-1 text-xs" />
                  <select disabled={!canEdit} value={step.condition.op} onChange={(e) => upd({ condition: { ...step.condition!, op: e.target.value as "eq" } })} className="field w-24 py-1 text-xs">{["truthy", "falsy", "eq", "neq", "gt", "lt"].map((o) => <option key={o}>{o}</option>)}</select>
                  {["eq", "neq", "gt", "lt"].includes(step.condition.op) && <input disabled={!canEdit} value={String(step.condition.value ?? "")} onChange={(e) => upd({ condition: { ...step.condition!, value: isNaN(Number(e.target.value)) ? (e.target.value === "true" ? true : e.target.value === "false" ? false : e.target.value) : Number(e.target.value) } })} className="field w-24 py-1 text-xs" />}
                </>
              )}
            </div>
          </div>
          {step.config.type === "custom_agent_task" && (
            <label className="md:col-span-2"><span className="label mb-1 block">Instructions for this agent task</span><textarea disabled={!canEdit} value={String(step.config.instructions ?? "")} onChange={(e) => upd({ config: { ...step.config, instructions: e.target.value } })} rows={3} className="field" /></label>
          )}
        </div>
      )}
    </div>
  );
}

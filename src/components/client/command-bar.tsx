"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUp, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { cn, usd } from "@/lib/cn";
import { api, ApiError } from "./api";
import { ErrorNote } from "./action";

interface PlannedProduction {
  templateKey: string;
  templateName: string;
  title: string;
  characterIds: string[];
  unknownCharacters: string[];
  brief: Record<string, unknown>;
  briefErrors: string[];
  rationale: string;
  estimatedCents: number;
  steps: { key: string; name: string; agent: string | null; requiresApproval: boolean; estimateCents: number }[];
}
interface Plan {
  command: string;
  summary: string;
  productions: PlannedProduction[];
  questions: string[];
  canonGaps: string[];
  costCents: number;
}

const EXAMPLES = [
  "Create five new Calmlings TikToks using Blue.",
  "Develop a collectible plush range for Christmas.",
  "Make game-ready character expression sheets.",
  "Generate ten story ideas featuring Dadirri.",
  "Develop a licensing pitch for a major toy company.",
];

export function CommandBar({ characters, big = false }: { characters: { id: string; name: string; approved: boolean }[]; big?: boolean }) {
  const router = useRouter();
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);

  async function submit(text: string) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      setPlan(await api<Plan>("/api/command", { body: { command: text } }));
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  function patch(i: number, p: Partial<PlannedProduction>) {
    setPlan((cur) => (cur ? { ...cur, productions: cur.productions.map((x, j) => (j === i ? { ...x, ...p } : x)) } : cur));
  }

  async function create() {
    if (!plan) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api<{ ids: string[] }>("/api/command/execute", { body: { command: plan.command, productions: plan.productions.map((p) => ({ templateKey: p.templateKey, title: p.title, brief: p.brief, characterIds: p.characterIds })) } });
      setPlan(null);
      setCommand("");
      router.push(res.ids.length === 1 ? `/productions/${res.ids[0]}` : "/mission");
      router.refresh();
    } catch (e) {
      setError(e as Error);
    } finally {
      setCreating(false);
    }
  }

  const integration = error instanceof ApiError && error.code === "integration_required";

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(command);
        }}
        className="relative rounded-2xl border border-calm-300/15 bg-ink-900/90 p-2 shadow-glow"
      >
        <div className="flex items-start gap-3 p-2">
          <Sparkles className="mt-1.5 size-4 shrink-0 text-calm-300" />
          <textarea
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            rows={big ? 3 : 1}
            placeholder="What should we create today?"
            className="flex-1 resize-none bg-transparent text-[15px] text-white outline-none placeholder:text-mist-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(command);
              }
            }}
          />
          <button disabled={busy || !command.trim()} className="grid size-9 shrink-0 place-items-center rounded-full bg-calm-400 text-ink-950 transition hover:bg-calm-300 disabled:opacity-40" aria-label="Plan">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
      </form>
      {big && !plan && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => setCommand(e)} className="rounded-full border border-white/10 px-3 py-1 text-xs text-mist-300 transition hover:border-calm-300/30 hover:text-white">
              {e}
            </button>
          ))}
        </div>
      )}
      {busy && <p className="mt-3 text-sm text-mist-400">The Studio Director is reading your instruction against approved canon…</p>}
      {integration ? (
        <div className="mt-3 rounded-xl border border-warn/30 bg-warn/[0.07] px-4 py-3 text-sm">
          <div className="font-medium text-white">The Studio Director needs a connected text model to plan from natural language.</div>
          <div className="mt-1 text-mist-300">{error!.message}</div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <Link href="/settings" className="link">Connect a provider →</Link>
            <span className="text-mist-500">or start a production manually in</span>
            <Link href="/social" className="link">Social</Link>
            <Link href="/game" className="link">Game</Link>
            <Link href="/product" className="link">Product</Link>
            <Link href="/story" className="link">Story</Link>
          </div>
        </div>
      ) : (
        <ErrorNote error={error} />
      )}
      {plan && (
        <div className="mt-4 panel animate-rise p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="label text-calm-300">Execution plan · review before anything costly runs</div>
              <p className="mt-1 text-sm text-mist-200">{plan.summary}</p>
            </div>
            <button onClick={() => setPlan(null)} className="text-mist-400 hover:text-white" aria-label="Discard plan">
              <X className="size-4" />
            </button>
          </div>
          {(plan.questions.length > 0 || plan.canonGaps.length > 0) && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {plan.questions.length > 0 && (
                <div className="rounded-xl border border-calm-400/20 bg-calm-400/[0.05] p-3 text-sm">
                  <div className="label mb-1">Questions for you</div>
                  <ul className="list-disc space-y-1 pl-4 text-mist-200">{plan.questions.map((q) => <li key={q}>{q}</li>)}</ul>
                </div>
              )}
              {plan.canonGaps.length > 0 && (
                <div className="rounded-xl border border-warn/25 bg-warn/[0.05] p-3 text-sm">
                  <div className="label mb-1 text-warn">Canon gaps</div>
                  <ul className="list-disc space-y-1 pl-4 text-mist-200">{plan.canonGaps.map((q) => <li key={q}>{q}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          <div className="mt-4 space-y-3">
            {plan.productions.map((p, i) => (
              <div key={i} className="rounded-xl border border-white/[0.07] bg-ink-900/70 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input value={p.title} onChange={(e) => patch(i, { title: e.target.value })} className="field max-w-md flex-1 font-medium" />
                  <span className="rounded-md bg-white/[0.05] px-2 py-1 text-xs text-mist-300">{p.templateName}</span>
                  <span className="text-xs text-mist-400">est. {usd(p.estimatedCents)}</span>
                  <button onClick={() => setPlan({ ...plan, productions: plan.productions.filter((_, j) => j !== i) })} className="ml-auto text-mist-500 hover:text-bad" aria-label="Remove">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <p className="mt-2 text-xs text-mist-400">{p.rationale}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {characters.map((c) => {
                    const on = p.characterIds.includes(c.id);
                    return (
                      <button key={c.id} onClick={() => patch(i, { characterIds: on ? p.characterIds.filter((x) => x !== c.id) : [...p.characterIds, c.id] })} className={cn("rounded-full border px-2.5 py-0.5 text-xs transition", on ? "border-calm-300/50 bg-calm-400/15 text-white" : "border-white/10 text-mist-400 hover:text-white")}>
                        {c.name}
                        {!c.approved && " (no canon)"}
                      </button>
                    );
                  })}
                  {p.unknownCharacters.map((u) => (
                    <span key={u} className="rounded-full border border-bad/30 px-2.5 py-0.5 text-xs text-bad" title="Not in the character library – the system won't invent them">
                      {u}: not in library
                    </span>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {Object.entries(p.brief)
                    .filter(([, v]) => typeof v !== "object")
                    .map(([k, v]) => (
                      <label key={k} className="text-xs">
                        <span className="text-mist-500">{k}</span>
                        {typeof v === "boolean" ? (
                          <input type="checkbox" checked={v} onChange={(e) => patch(i, { brief: { ...p.brief, [k]: e.target.checked } })} className="ml-2 accent-calm-400" />
                        ) : (
                          <input value={String(v)} onChange={(e) => patch(i, { brief: { ...p.brief, [k]: typeof v === "number" ? Number(e.target.value) : e.target.value } })} className="field mt-0.5 py-1 text-xs" />
                        )}
                      </label>
                    ))}
                </div>
                {p.briefErrors.length > 0 && <div className="mt-2 text-xs text-bad">{p.briefErrors.join("; ")}</div>}
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.steps.map((s) => (
                    <span key={s.key} className={cn("rounded-md px-2 py-0.5 text-[11px]", s.requiresApproval ? "bg-warn/10 text-warn" : "bg-white/[0.04] text-mist-300")} title={s.agent ?? "human"}>
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs text-mist-500">Planning cost {usd(plan.costCents)} · nothing is generated until you approve each production's plan.</span>
            <button onClick={create} disabled={creating || !plan.productions.length} className="inline-flex items-center gap-2 rounded-lg bg-calm-400 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-calm-300 disabled:opacity-50">
              {creating && <Loader2 className="size-4 animate-spin" />}
              Create {plan.productions.length} production{plan.productions.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

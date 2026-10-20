"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Paintbrush, Send } from "lucide-react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { cn, usd } from "@/lib/cn";
import { DEPT_COLORS, DEPT_NAMES, type Handoff, type OfficeAgent } from "./office-scene";
import { DEFAULT_OFFICE_THEME, OFFICE_THEMES, type OfficeSkinView } from "./themes";
import { SkinPanel } from "./skin-panel";

const OfficeScene = dynamic(() => import("./office-scene"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-sm text-mist-500">Opening the office…</div> });

interface OfficeData {
  agents: OfficeAgent[];
  handoffs: Handoff[];
  missions: { id: string; goal: string; status: string; spentCents: number; budgetCents: number }[];
}

const STATUS_LABEL: Record<string, string> = { working: "Working", queued: "Up next", waiting: "Waiting", blocked: "Blocked", idle: "Available" };
const STATUS_DOT: Record<string, string> = { working: "bg-ok", queued: "bg-calm-400", waiting: "bg-warn", blocked: "bg-bad", idle: "bg-[#9aa3b5]" };

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function OfficeView({ initial, characters, defaultBudgetCents, canStart, skin: initialSkin, canSkin }: { initial: OfficeData; characters: { id: string; name: string; approved: boolean }[]; defaultBudgetCents: number; canStart: boolean; skin: OfficeSkinView; canSkin: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<OfficeData>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [goal, setGoal] = useState("");
  const [cast, setCast] = useState<string[]>([]);
  const [budget, setBudget] = useState((defaultBudgetCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [skin, setSkin] = useState(initialSkin);
  const [customising, setCustomising] = useState(false);
  const theme = OFFICE_THEMES[skin.theme] ?? OFFICE_THEMES[DEFAULT_OFFICE_THEME];

  useEffect(() => setWebgl(hasWebGL()), []);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/office");
        if (res.ok && !stop) setData(await res.json());
      } catch {}
      if (!stop) setTimeout(tick, document.hidden ? 8000 : 2000);
    };
    const t = setTimeout(tick, 2000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, []);

  const sel = data.agents.find((a) => a.key === selected) ?? null;
  const active = useMemo(() => data.agents.filter((a) => a.status !== "idle"), [data.agents]);

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/missions", { body: { goal, characterIds: cast, budgetCents: Math.round(Number(budget) * 100) } });
      router.push(`/missions/${id}`);
    } catch (e) {
      setError(e as Error);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canStart && (
        <div className="panel p-4">
          <div className="flex items-start gap-3">
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="Give the team a goal – e.g. “Create five new Calmlings TikToks using Blue” or “Develop a licensing pitch for a major toy company”" className="field flex-1 resize-none text-[15px]" />
            <button disabled={busy || goal.trim().length < 3} onClick={launch} className="inline-flex h-[60px] items-center gap-2 rounded-xl bg-calm-400 px-5 text-sm font-medium text-ink-950 hover:bg-calm-300 disabled:opacity-40">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}Hand to the team
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {characters.map((c) => {
              const on = cast.includes(c.id);
              return <button key={c.id} onClick={() => setCast(on ? cast.filter((x) => x !== c.id) : [...cast, c.id])} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-calm-300/50 bg-calm-400/15 text-white" : "border-white/10 text-mist-400 hover:text-white")}>{c.name}{!c.approved && " · no canon"}</button>;
            })}
            <span className="ml-auto flex items-center gap-2 text-xs text-mist-400">Budget $<input value={budget} onChange={(e) => setBudget(e.target.value)} className="field w-20 py-1 text-xs" /></span>
          </div>
          <ErrorNote error={error} />
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative h-[640px] overflow-hidden rounded-2xl border border-white/[0.06]" style={{ background: theme.background }}>
          {webgl === false ? (
            <FlatOffice agents={data.agents} onSelect={setSelected} selected={selected} />
          ) : webgl ? (
            <OfficeScene agents={data.agents} handoffs={data.handoffs} selected={selected} onSelect={setSelected} skin={skin} />
          ) : null}
          <div className={cn("pointer-events-none absolute left-4 top-4 flex flex-wrap gap-3 rounded-xl px-3 py-2 text-[11px] shadow-sm backdrop-blur", theme.dark ? "bg-ink-950/70 text-mist-300" : "bg-white/80 text-slate-600")}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", STATUS_DOT[k])} />{v}</span>)}
          </div>
          <div className={cn("pointer-events-none absolute bottom-4 left-4 text-[11px]", theme.dark ? "text-mist-500" : "text-slate-500")}>Drag to orbit · scroll to zoom · click an agent</div>
          {canSkin && webgl && (
            <button onClick={() => setCustomising(!customising)} className={cn("absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium shadow-sm backdrop-blur", theme.dark ? "bg-ink-950/70 text-mist-100 hover:bg-ink-900" : "bg-white/85 text-slate-700 hover:bg-white")}>
              <Paintbrush className="size-3.5" />
              Customise office
            </button>
          )}
          {customising && <SkinPanel skin={skin} onChange={setSkin} onClose={() => setCustomising(false)} />}
        </div>
        <div className="space-y-4">
          {sel ? (
            <div className="panel p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display text-lg text-white">{sel.name}</div>
                  <div className="text-xs text-mist-400">{sel.role}</div>
                  <div className="mt-1 text-[11px]" style={{ color: DEPT_COLORS[sel.department] }}>{DEPT_NAMES[sel.department]}</div>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-mist-200"><span className={cn("size-2 rounded-full", STATUS_DOT[sel.status])} />{STATUS_LABEL[sel.status]}</span>
              </div>
              {sel.title && <div className="mt-3 text-sm text-white">{sel.title}</div>}
              {sel.activity && <p className="mt-1 text-sm text-mist-300">{sel.activity}</p>}
              <div className="mt-3 flex gap-3 text-xs">
                {sel.href && <Link href={sel.href} className="link">Open the work →</Link>}
                <Link href={`/agents/${sel.key}`} className="link">Profile & history →</Link>
              </div>
            </div>
          ) : (
            <div className="panel p-4 text-sm text-mist-400">{active.length ? `${active.length} agent${active.length === 1 ? "" : "s"} busy right now.` : "The office is quiet. Give the team a goal to get them working."} Click any agent to see what they're doing.</div>
          )}
          <div className="panel p-4">
            <div className="label mb-2">Active missions</div>
            {data.missions.length ? data.missions.map((m) => (
              <Link key={m.id} href={`/missions/${m.id}`} className="block border-b border-white/[0.05] py-2 last:border-0 hover:bg-white/[0.02]">
                <div className="line-clamp-2 text-sm text-white">{m.goal}</div>
                <div className="text-xs text-mist-500">{m.status.replace(/_/g, " ")} · {usd(m.spentCents)} / {usd(m.budgetCents, 0)}</div>
              </Link>
            )) : <p className="text-sm text-mist-500">None.</p>}
          </div>
          <div className="panel p-4">
            <div className="label mb-2">On the floor now</div>
            {active.length ? active.slice(0, 12).map((a) => (
              <button key={a.key} onClick={() => setSelected(a.key)} className="flex w-full items-start gap-2 py-1.5 text-left">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATUS_DOT[a.status])} />
                <span className="min-w-0"><span className="text-sm text-mist-100">{a.name}</span><span className="block truncate text-xs text-mist-500">{a.activity}</span></span>
              </button>
            )) : <p className="text-sm text-mist-500">Everyone is available.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function FlatOffice({ agents, onSelect, selected }: { agents: OfficeAgent[]; onSelect: (k: string) => void; selected: string | null }) {
  return (
    <div className="grid h-full grid-cols-2 gap-3 overflow-y-auto p-4 pt-16 md:grid-cols-4">
      {Object.keys(DEPT_NAMES).map((d) => (
        <div key={d} className="rounded-xl border p-3" style={{ borderColor: `${DEPT_COLORS[d]}40` }}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: DEPT_COLORS[d] }}>{DEPT_NAMES[d]}</div>
          {agents.filter((a) => a.department === d).map((a) => (
            <button key={a.key} onClick={() => onSelect(a.key)} className={cn("flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs", selected === a.key && "bg-white/10")}>
              <span className={cn("size-2 rounded-full", STATUS_DOT[a.status])} />
              <span className="truncate text-mist-200">{a.name}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

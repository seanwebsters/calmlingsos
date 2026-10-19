"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

const KINDS: Record<string, string[]> = {
  world: ["environment", "location", "prop", "world_rule", "palette", "lighting", "mood", "material", "environmental_storytelling"],
  lore: ["lore", "lore_event", "relationship", "story_arc"],
  brand: ["mission", "values", "audience", "humour", "tone_of_voice", "visual_language", "brand_guideline", "typography", "logo_usage", "messaging", "brand_safety", "commercial_guideline"],
  production: ["social_format", "animation_reference", "game_spec", "export_format", "naming_convention", "technical_constraint", "creative_template"],
};

export function CanonForm({ domains, characters, reviseId, initial }: { domains: string[]; characters: { id: string; name: string }[]; reviseId?: string; initial?: { domain: string; kind: string; title: string; body: string; characterIds: string[]; timelineOrder: number | null } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(initial ?? { domain: domains[0], kind: KINDS[domains[0]][0], title: "", body: "", characterIds: [] as string[], timelineOrder: null as number | null });
  const [error, setError] = useState<Error | null>(null);
  if (!open) return <button onClick={() => setOpen(true)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-mist-100 hover:bg-white/[0.06]">{reviseId ? "Propose revision" : "+ New canon record (draft)"}</button>;
  return (
    <form
      className="panel-quiet mt-3 space-y-2 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api(reviseId ? `/api/canon/${reviseId}/revise` : "/api/canon", { body: f });
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError(err as Error);
        }
      }}
    >
      <div className="grid gap-2 md:grid-cols-3">
        <select value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value, kind: KINDS[e.target.value][0] })} className="field">{domains.map((d) => <option key={d}>{d}</option>)}</select>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="field">{KINDS[f.domain].map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select>
        <input type="number" value={f.timelineOrder ?? ""} onChange={(e) => setF({ ...f, timelineOrder: e.target.value ? Number(e.target.value) : null })} placeholder="Timeline order (optional)" className="field" />
      </div>
      <input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Title" className="field" />
      <textarea required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={5} placeholder="The canon statement" className="field" />
      <div className="flex flex-wrap gap-1.5">
        {characters.map((c) => {
          const on = f.characterIds.includes(c.id);
          return <button type="button" key={c.id} onClick={() => setF({ ...f, characterIds: on ? f.characterIds.filter((x) => x !== c.id) : [...f.characterIds, c.id] })} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-calm-300/50 bg-calm-400/15 text-white" : "border-white/10 text-mist-400"}`}>{c.name}</button>;
        })}
      </div>
      <div className="flex gap-2"><button className="rounded-lg bg-calm-400 px-3 py-1.5 text-sm font-medium text-ink-950">Save as DRAFT CANON</button><button type="button" onClick={() => setOpen(false)} className="text-sm text-mist-400">Cancel</button></div>
      <ErrorNote error={error} />
    </form>
  );
}

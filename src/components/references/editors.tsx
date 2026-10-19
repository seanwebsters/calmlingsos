"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MachineAnalysis } from "@/db/schema";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { cn } from "@/lib/cn";

export function MetaEditor({ id, initial, characters, assetTypes }: { id: string; initial: { title: string; assetType: string; viewAngle: string | null; rightsStatus: string; usageNotes: string; notes: string; source: string; characterIds: string[]; tags: string[] }; characters: { id: string; name: string }[]; assetTypes: { value: string; label: string }[] }) {
  const router = useRouter();
  const [m, setM] = useState({ ...initial, tags: initial.tags.join(", ") });
  const [error, setError] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api(`/api/references/${id}`, { method: "PATCH", body: { ...m, viewAngle: m.viewAngle || null, tags: m.tags.split(",").map((t) => t.trim()).filter(Boolean) } });
          setSaved(true);
          router.refresh();
        } catch (err) {
          setError(err as Error);
        }
      }}
    >
      <input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} className="field" />
      <div className="grid grid-cols-2 gap-2">
        <select value={m.assetType} onChange={(e) => setM({ ...m, assetType: e.target.value })} className="field">{assetTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
        <select value={m.viewAngle ?? ""} onChange={(e) => setM({ ...m, viewAngle: e.target.value })} className="field"><option value="">No view angle</option>{["front", "side", "rear", "three_quarter", "face_closeup", "expression", "pose", "accessory", "environment_interaction"].map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</select>
        <select value={m.rightsStatus} onChange={(e) => setM({ ...m, rightsStatus: e.target.value })} className="field"><option value="owned">Owned</option><option value="licensed">Licensed</option><option value="restricted">Restricted</option><option value="unknown">Unknown</option></select>
        <input value={m.source} onChange={(e) => setM({ ...m, source: e.target.value })} placeholder="Source" className="field" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {characters.map((c) => {
          const on = m.characterIds.includes(c.id);
          return <button type="button" key={c.id} onClick={() => setM({ ...m, characterIds: on ? m.characterIds.filter((x) => x !== c.id) : [...m.characterIds, c.id] })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-calm-300/50 bg-calm-400/15 text-white" : "border-white/10 text-mist-400")}>{c.name}</button>;
        })}
      </div>
      <input value={m.tags} onChange={(e) => setM({ ...m, tags: e.target.value })} placeholder="Tags" className="field" />
      <textarea value={m.usageNotes} onChange={(e) => setM({ ...m, usageNotes: e.target.value })} placeholder="Rights & usage notes" rows={2} className="field" />
      <textarea value={m.notes} onChange={(e) => setM({ ...m, notes: e.target.value })} placeholder="Notes" rows={2} className="field" />
      <div className="flex items-center gap-3"><button className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-mist-100 hover:bg-white/[0.06]">Save metadata</button>{saved && <span className="text-xs text-ok">Saved</span>}</div>
      <ErrorNote error={error} />
    </form>
  );
}

export function AnalysisEditor({ id, analysis, reviewed, canReview }: { id: string; analysis: MachineAnalysis; reviewed: boolean; canReview: boolean }) {
  const router = useRouter();
  const [a, setA] = useState({ description: analysis.description ?? "", composition: analysis.composition ?? "", styleObservations: (analysis.styleObservations ?? []).join("\n"), consistencyRules: (analysis.consistencyRules ?? []).join("\n"), transcript: analysis.transcript ?? "" });
  const [error, setError] = useState<Error | null>(null);
  return (
    <div className="space-y-3">
      <div className={cn("rounded-lg px-3 py-2 text-xs", reviewed ? "bg-ok/10 text-ok" : "bg-violet/10 text-violet")}>
        {reviewed ? "Reviewed by a human – still machine-derived, but checked." : `MACHINE-GENERATED – not reviewed. ${analysis.provider ? `${analysis.provider} / ${analysis.model}` : ""}`}
      </div>
      <label className="block"><span className="label mb-1 block">Description</span><textarea disabled={!canReview} value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} rows={4} className="field" /></label>
      {analysis.composition !== undefined && <label className="block"><span className="label mb-1 block">Composition</span><textarea disabled={!canReview} value={a.composition} onChange={(e) => setA({ ...a, composition: e.target.value })} rows={2} className="field" /></label>}
      <label className="block"><span className="label mb-1 block">Style observations (one per line)</span><textarea disabled={!canReview} value={a.styleObservations} onChange={(e) => setA({ ...a, styleObservations: e.target.value })} rows={3} className="field" /></label>
      {analysis.consistencyRules !== undefined && <label className="block"><span className="label mb-1 block">Candidate consistency rules (adopt into canon manually)</span><textarea disabled={!canReview} value={a.consistencyRules} onChange={(e) => setA({ ...a, consistencyRules: e.target.value })} rows={3} className="field" /></label>}
      {analysis.transcript !== undefined && <label className="block"><span className="label mb-1 block">Transcript</span><textarea disabled={!canReview} value={a.transcript} onChange={(e) => setA({ ...a, transcript: e.target.value })} rows={4} className="field" /></label>}
      {canReview && (
        <button
          onClick={async () => {
            setError(null);
            try {
              await api(`/api/references/${id}/analysis`, { body: { description: a.description, composition: a.composition || undefined, styleObservations: a.styleObservations.split("\n").map((s) => s.trim()).filter(Boolean), consistencyRules: a.consistencyRules.split("\n").map((s) => s.trim()).filter(Boolean), transcript: a.transcript || undefined } });
              router.refresh();
            } catch (err) {
              setError(err as Error);
            }
          }}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-mist-100 hover:bg-white/[0.06]"
        >
          Save & mark reviewed
        </button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export function NewVersion({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api(`/api/references/${id}/versions`, { form: new FormData(e.currentTarget) });
          (e.target as HTMLFormElement).reset();
          router.refresh();
        } catch (err) {
          setError(err as Error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input type="file" name="file" required className="text-xs text-mist-300 file:mr-2 file:rounded-md file:border-0 file:bg-white/[0.08] file:px-2 file:py-1 file:text-mist-100" />
      <input name="note" placeholder="Version note" className="field w-48 py-1 text-xs" />
      <button disabled={busy} className="rounded-lg border border-white/10 px-3 py-1 text-xs text-mist-100">{busy ? "Uploading…" : "Add version"}</button>
      <div className="w-full"><ErrorNote error={error} /></div>
    </form>
  );
}

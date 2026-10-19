"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

export function CsvImport() {
  const router = useRouter();
  const [res, setRes] = useState<{ imported: number; skipped: string[] } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="panel flex flex-wrap items-center gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          setRes(await api("/api/analytics/import", { form: new FormData(e.currentTarget) }));
          router.refresh();
        } catch (err) {
          setError(err as Error);
        }
      }}
    >
      <div className="font-display text-white">Import analytics CSV</div>
      <input type="file" name="file" accept=".csv,text/csv" required className="text-xs text-mist-300 file:mr-2 file:rounded-md file:border-0 file:bg-white/[0.08] file:px-2 file:py-1 file:text-mist-100" />
      <select name="platform" className="field w-40 py-1 text-xs"><option value="">Platform from file</option><option value="tiktok">TikTok</option><option value="instagram">Instagram</option><option value="youtube">YouTube</option></select>
      <button className="rounded-lg bg-calm-400 px-3 py-1.5 text-sm font-medium text-ink-950">Import</button>
      {res && <span className="text-xs text-ok">Imported {res.imported}. {res.skipped.length ? `Skipped ${res.skipped.length}.` : ""}</span>}
      <div className="w-full"><ErrorNote error={error} /></div>
    </form>
  );
}

export function DecisionForm({ characters, canRule }: { characters: { id: string; name: string }[]; canRule: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="panel space-y-2 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await api("/api/decisions", { body: { kind: f.get("isRule") ? "rule" : f.get("kind"), summary: f.get("summary"), detail: f.get("detail"), characterIds: f.getAll("characterIds"), isRule: Boolean(f.get("isRule")), department: f.get("department") || null, tags: String(f.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean) } });
          (e.target as HTMLFormElement).reset();
          router.refresh();
        } catch (err) {
          setError(err as Error);
        }
      }}
    >
      <div className="font-display text-lg text-white">Record a creative decision</div>
      <input name="summary" required placeholder="e.g. Avoid overly expressive facial animation for Blue" className="field" />
      <textarea name="detail" placeholder="Why" rows={2} className="field" />
      <div className="grid grid-cols-2 gap-2">
        <select name="kind" className="field"><option value="preference">Preference</option><option value="correction">Correction</option><option value="rejection">Rejection</option><option value="pattern">Successful pattern</option><option value="consistency_issue">Consistency issue</option></select>
        <select name="department" className="field"><option value="">All departments</option>{["social", "animation", "game", "product", "story", "music", "marketing", "licensing"].map((d) => <option key={d}>{d}</option>)}</select>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-mist-300">{characters.map((c) => <label key={c.id} className="flex items-center gap-1"><input type="checkbox" name="characterIds" value={c.id} className="accent-calm-400" />{c.name}</label>)}</div>
      <input name="tags" placeholder="Tags (comma separated)" className="field" />
      {canRule && <label className="flex items-center gap-2 text-sm text-mist-200"><input type="checkbox" name="isRule" className="accent-calm-400" />Make this a rule every relevant agent must follow</label>}
      <button className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-mist-100">Record</button>
      <ErrorNote error={error} />
    </form>
  );
}

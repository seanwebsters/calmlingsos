"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export function SpriteTool({ assets }: { assets: { id: string; name: string; url: string | null }[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const [cell, setCell] = useState(256);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="panel p-5">
      <div className="font-display text-lg text-white">Sprite sheet & atlas</div>
      <p className="mb-3 text-sm text-mist-400">Pack validated assets into an atlas (resized to a uniform cell) with TexturePacker-style JSON.</p>
      {assets.length === 0 ? <p className="text-sm text-mist-500">No technically validated assets yet.</p> : (
        <>
          <div className="grid max-h-56 grid-cols-5 gap-1.5 overflow-y-auto">
            {assets.map((a) => (
              <button key={a.id} onClick={() => setSel(sel.includes(a.id) ? sel.filter((x) => x !== a.id) : [...sel, a.id])} className={cn("checker overflow-hidden rounded-md border", sel.includes(a.id) ? "border-calm-300" : "border-white/10")} title={a.name}>
                {a.url && <img src={a.url} alt={a.name} className="aspect-square w-full object-contain" />}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input type="number" value={cell} onChange={(e) => setCell(Number(e.target.value))} className="field w-24 py-1 text-xs" />
            <span className="text-xs text-mist-500">px cell</span>
            <button
              disabled={!sel.length}
              onClick={async () => {
                setError(null);
                const res = await fetch("/api/game-assets/sheet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: sel, cell }) });
                if (!res.ok) return setError((await res.json()).error);
                const blob = await res.blob();
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "calmlings-atlas.zip";
                a.click();
              }}
              className="ml-auto rounded-lg bg-calm-400 px-3 py-1.5 text-xs font-medium text-ink-950 disabled:opacity-40"
            >
              Build atlas ({sel.length})
            </button>
          </div>
          {error && <div className="mt-2 text-xs text-bad">{error}</div>}
        </>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

interface Hit {
  type: string;
  id: string;
  title: string;
  sub: string;
  href: string;
}

export function SearchBox() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [mode, setMode] = useState<string>("");
  const [open, setOpen] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    t.current = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const j = await res.json();
        setHits(j.hits);
        setMode(j.semantic);
        setOpen(true);
      }
    }, 220);
  }, [q]);
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-500" />
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Search the Calmlings brain…" className="field py-1.5 pl-9 text-[13px]" />
      {open && hits.length > 0 && (
        <div className="absolute right-0 top-full z-30 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-ink-850 shadow-card">
          {hits.map((h) => (
            <Link key={`${h.type}:${h.id}`} href={h.href} className="block border-b border-white/[0.04] px-3 py-2 last:border-0 hover:bg-white/[0.04]">
              <div className="flex items-center gap-2 text-sm text-white">
                <span className="rounded bg-white/[0.06] px-1.5 text-[10px] uppercase tracking-wide text-mist-400">{h.type}</span>
                {h.title}
              </div>
              <div className="truncate text-xs text-mist-500">{h.sub}</div>
            </Link>
          ))}
          <div className="px-3 py-1.5 text-[10px] text-mist-500">Semantic search: {mode === "semantic" ? "on" : "off (no embeddings provider) – keyword matching"}</div>
        </div>
      )}
    </div>
  );
}

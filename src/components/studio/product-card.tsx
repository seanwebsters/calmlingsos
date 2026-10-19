"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { usd } from "@/lib/cn";

interface P {
  id: string;
  name: string;
  category: string;
  iteration: number;
  description: string;
  materials: string;
  dimensions: string;
  packaging: string;
  targetAudience: string;
  targetRetailCents: number | null;
  estUnitCostCents: number | null;
  moqAssumption: number | null;
  marginScenarios: { label: string; unitCostCents: number; retailCents: number; wholesaleCents: number; marginPct: number }[];
  feasibilityRisks: string[];
  quoteVerified: boolean;
  status: string;
  productionId: string | null;
}

export function ProductCard({ p, render, iterations, canEdit, canApprove }: { p: P; render: { id: string; thumbUrl: string | null } | null; iterations: number; canEdit: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ description: p.description, materials: p.materials, dimensions: p.dimensions, retail: ((p.targetRetailCents ?? 0) / 100).toFixed(2), unit: ((p.estUnitCostCents ?? 0) / 100).toFixed(2), moq: String(p.moqAssumption ?? ""), quoteVerified: p.quoteVerified });
  const [error, setError] = useState<Error | null>(null);
  const call = async (b: Record<string, unknown>) => {
    setError(null);
    try {
      await api(`/api/products/${p.id}`, { method: "PATCH", body: b });
      setEdit(false);
      router.refresh();
    } catch (e) {
      setError(e as Error);
    }
  };
  return (
    <div className="rounded-xl border border-white/[0.06] bg-ink-900/70 p-4">
      <div className="flex gap-4">
        {render?.thumbUrl ? <Link href={`/assets/${render.id}`}><img src={render.thumbUrl} alt={p.name} className="size-24 rounded-lg object-cover" /></Link> : <div className="flex size-24 items-center justify-center rounded-lg border border-dashed border-white/10 text-[10px] text-mist-600">no render</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div><div className="text-white">{p.name}</div><div className="text-xs text-mist-500">{p.category} · iteration {p.iteration} of {iterations}</div></div>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-mist-200">{p.status.replace(/_/g, " ")}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-mist-300">{p.description}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><div className="text-mist-500">Retail</div><div className="text-white">{usd(p.targetRetailCents)}</div></div>
        <div><div className="text-mist-500">Unit cost</div><div className="text-white">{usd(p.estUnitCostCents)}</div></div>
        <div><div className="text-mist-500">MOQ</div><div className="text-white">{p.moqAssumption ?? "—"}</div></div>
      </div>
      <div className={`mt-2 text-[11px] ${p.quoteVerified ? "text-ok" : "text-warn"}`}>{p.quoteVerified ? "Backed by a supplier quote" : "ESTIMATES – not backed by a supplier quote"}</div>
      {p.marginScenarios.length > 0 && <div className="mt-2 space-y-0.5 text-[11px] text-mist-400">{p.marginScenarios.map((m) => <div key={m.label}>{m.label}: {m.marginPct}% margin</div>)}</div>}
      {p.feasibilityRisks.length > 0 && <div className="mt-2 text-[11px] text-mist-400">Risks: {p.feasibilityRisks.slice(0, 3).join("; ")}</div>}
      {edit && (
        <div className="mt-3 space-y-2">
          <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} className="field text-xs" />
          <div className="grid grid-cols-2 gap-2">
            <input value={f.materials} onChange={(e) => setF({ ...f, materials: e.target.value })} placeholder="Materials" className="field text-xs" />
            <input value={f.dimensions} onChange={(e) => setF({ ...f, dimensions: e.target.value })} placeholder="Dimensions" className="field text-xs" />
            <input value={f.retail} onChange={(e) => setF({ ...f, retail: e.target.value })} placeholder="Retail USD" className="field text-xs" />
            <input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="Unit cost USD" className="field text-xs" />
            <input value={f.moq} onChange={(e) => setF({ ...f, moq: e.target.value })} placeholder="MOQ" className="field text-xs" />
            <label className="flex items-center gap-2 text-xs text-mist-200"><input type="checkbox" checked={f.quoteVerified} onChange={(e) => setF({ ...f, quoteVerified: e.target.checked })} className="accent-calm-400" />Figures from a supplier quote</label>
          </div>
          <button onClick={() => call({ description: f.description, materials: f.materials, dimensions: f.dimensions, targetRetailCents: Math.round(Number(f.retail) * 100), estUnitCostCents: Math.round(Number(f.unit) * 100), moqAssumption: f.moq ? Number(f.moq) : undefined, quoteVerified: f.quoteVerified })} className="rounded-md bg-calm-400 px-3 py-1 text-xs font-medium text-ink-950">Save as new iteration</button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {canEdit && <button onClick={() => setEdit(!edit)} className="rounded-md border border-white/10 px-2 py-0.5 text-xs text-mist-200">{edit ? "Close" : "Iterate"}</button>}
        {canApprove && p.status !== "approved" && <button onClick={() => call({ status: "approved" })} className="rounded-md border border-ok/30 px-2 py-0.5 text-xs text-ok">Approve direction</button>}
        {canApprove && p.status !== "rejected" && <button onClick={() => call({ status: "rejected" })} className="rounded-md border border-bad/30 px-2 py-0.5 text-xs text-bad">Reject</button>}
        {p.productionId && <Link href={`/productions/${p.productionId}`} className="px-2 py-0.5 text-xs text-calm-300">Production →</Link>}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

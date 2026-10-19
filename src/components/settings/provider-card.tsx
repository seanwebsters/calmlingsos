"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { cn } from "@/lib/cn";

interface Model {
  id: string;
  label: string;
  capabilities: string[];
  costNote: string;
  supportsReferences?: boolean;
  transparentBackground?: boolean;
}
interface Props {
  p: {
    key: string;
    name: string;
    connected: boolean;
    credentialSource: string;
    keyHint: string | null;
    enabled: boolean;
    allowProprietaryReferences: boolean;
    models: Record<string, string>;
    status: string;
    lastCheckedAt: string | null;
    lastError: string | null;
    implemented: string[];
    envVar: string;
    consoleUrl: string;
    privacyNote: string;
    rateLimitNote: string;
    capabilities: string[];
    modelList: Model[];
  };
  canManage: boolean;
  canStore: boolean;
}

export function ProviderCard({ p, canManage, canStore }: Props) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [test, setTest] = useState<{ ok: boolean; detail: string; availableModels: string[]; missingModels: string[] } | null>(null);
  const call = async (body: Record<string, unknown>, method = "POST") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ok?: boolean; detail?: string; availableModels?: string[]; missingModels?: string[] }>(`/api/providers/${p.key}`, { method, body: method === "DELETE" ? undefined : body });
      if (r && "detail" in r && r.detail) setTest(r as never);
      setKey("");
      router.refresh();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const caps = [...new Set(p.capabilities)];
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-xl text-white">{p.name}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", p.connected ? "bg-ok/10 text-ok" : p.status === "error" ? "bg-bad/10 text-bad" : "bg-white/[0.06] text-mist-400")}>
              {p.connected ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
              {p.connected ? `connected (${p.credentialSource})` : p.status === "error" ? "error" : "not connected"}
            </span>
          </div>
          <div className="mt-1 text-xs text-mist-500">{p.keyHint ? `Key ${p.keyHint}` : `Set ${p.envVar} on the server${canStore ? " or save a key below" : ""}`} · {p.lastCheckedAt ? `checked ${new Date(p.lastCheckedAt).toLocaleString()}` : "never tested"}</div>
        </div>
        <a href={p.consoleUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-calm-300">Get a key <ExternalLink className="size-3" /></a>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {caps.map((c) => <span key={c} className={cn("rounded px-1.5 py-0.5 text-[10px]", p.implemented.includes(c) ? "bg-calm-400/10 text-calm-200" : "bg-white/[0.04] text-mist-500")} title={p.implemented.includes(c) ? "Adapter implemented" : "Declared, adapter not implemented"}>{c.replace(/_/g, " ")}</span>)}
      </div>
      {p.lastError && <div className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{p.lastError}</div>}
      {test && <div className={cn("mt-3 rounded-lg px-3 py-2 text-xs", test.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad")}>{test.detail}{test.missingModels?.length ? ` · Not visible to this account: ${test.missingModels.join(", ")}` : ""}</div>}
      {canManage && (
        <div className="mt-4 space-y-3">
          {canStore && p.credentialSource !== "environment" && (
            <div className="flex gap-2">
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={p.keyHint ? "Replace stored key" : "Paste API key (stored encrypted, server-side only)"} className="field" autoComplete="off" />
              <button disabled={busy || key.length < 8} onClick={() => call({ apiKey: key })} className="rounded-lg bg-calm-400 px-3 text-sm font-medium text-ink-950 disabled:opacity-40">Save & test</button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2 text-mist-200"><input type="checkbox" checked={p.enabled} onChange={(e) => call({ enabled: e.target.checked })} className="accent-calm-400" />Enabled</label>
            <label className="flex items-center gap-2 text-mist-200" title={p.privacyNote}><input type="checkbox" checked={p.allowProprietaryReferences} onChange={(e) => { if (!e.target.checked || window.confirm(`Allow proprietary Calmlings reference files to be sent to ${p.name}?\n\n${p.privacyNote}`)) void call({ allowProprietaryReferences: e.target.checked }); }} className="accent-calm-400" />Allow proprietary reference files</label>
            <button disabled={busy} onClick={() => call({ test: true })} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1 text-xs text-mist-100">{busy && <Loader2 className="size-3 animate-spin" />}Test connection</button>
            {p.credentialSource === "stored" && <button disabled={busy} onClick={() => call({}, "DELETE")} className="text-xs text-bad">Disconnect</button>}
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-calm-300">Models per capability</summary>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {caps.filter((c) => p.implemented.includes(c)).map((c) => (
                <label key={c} className="text-xs"><span className="text-mist-500">{c.replace(/_/g, " ")}</span>
                  <select value={p.models[c] ?? ""} onChange={(e) => call({ models: { ...p.models, [c]: e.target.value } })} className="field mt-0.5 py-1 text-xs">
                    {p.modelList.filter((m) => m.capabilities.includes(c)).map((m) => <option key={m.id} value={m.id}>{m.label} – {m.costNote}{m.supportsReferences ? " · refs" : ""}{m.transparentBackground ? " · alpha" : ""}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-mist-500">{p.rateLimitNote} Prices are approximate list prices used for estimates.</p>
          </details>
          <p className="text-[11px] text-mist-500">{p.privacyNote}</p>
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

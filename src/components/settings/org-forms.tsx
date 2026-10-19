"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

export function OrgSettingsForm({ s }: { s: { defaultProductionBudgetCents: number; monthlyBudgetCents: number; retentionDays: number; maxUploadMb: number; requirePlanApproval: boolean } }) {
  const router = useRouter();
  const [v, setV] = useState({ prod: (s.defaultProductionBudgetCents / 100).toString(), month: (s.monthlyBudgetCents / 100).toString(), retention: String(s.retentionDays), upload: String(s.maxUploadMb), plan: s.requirePlanApproval });
  const [error, setError] = useState<Error | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api("/api/org", { method: "PATCH", body: { defaultProductionBudgetCents: Math.round(Number(v.prod) * 100), monthlyBudgetCents: Math.round(Number(v.month) * 100), retentionDays: Number(v.retention), maxUploadMb: Number(v.upload), requirePlanApproval: v.plan } });
          setOk(true);
          router.refresh();
        } catch (err) {
          setError(err as Error);
        }
      }}
    >
      <label><span className="label mb-1 block">Default production budget (USD)</span><input value={v.prod} onChange={(e) => setV({ ...v, prod: e.target.value })} className="field" /></label>
      <label><span className="label mb-1 block">Monthly spending limit (USD)</span><input value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })} className="field" /></label>
      <label><span className="label mb-1 block">Purge rejected generations after (days, 0 = keep)</span><input value={v.retention} onChange={(e) => setV({ ...v, retention: e.target.value })} className="field" /></label>
      <label><span className="label mb-1 block">Upload limit per file (MB)</span><input value={v.upload} onChange={(e) => setV({ ...v, upload: e.target.value })} className="field" /></label>
      <label className="flex items-center gap-2 text-sm text-mist-200 md:col-span-2"><input type="checkbox" checked={v.plan} onChange={(e) => setV({ ...v, plan: e.target.checked })} className="accent-calm-400" />Require human approval of every execution plan before generation</label>
      <div className="flex items-center gap-3"><button className="rounded-lg bg-calm-400 px-3 py-1.5 text-sm font-medium text-ink-950">Save settings</button>{ok && <span className="text-xs text-ok">Saved</span>}</div>
      <div className="md:col-span-2"><ErrorNote error={error} /></div>
    </form>
  );
}

export function AddMember() {
  const router = useRouter();
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="grid gap-2 md:grid-cols-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api("/api/org", { body: { action: "add_member", ...Object.fromEntries(new FormData(e.currentTarget)) } });
          (e.target as HTMLFormElement).reset();
          router.refresh();
        } catch (err) {
          setError(err as Error);
        }
      }}
    >
      <input name="name" required placeholder="Name" className="field" />
      <input name="email" type="email" required placeholder="Email" className="field" />
      <input name="password" type="password" required minLength={10} placeholder="Temporary password" className="field" />
      <select name="role" className="field"><option value="creative_director">Creative Director</option><option value="producer">Producer</option><option value="contributor">Contributor</option><option value="viewer">Viewer</option><option value="owner">Owner</option></select>
      <button className="rounded-lg border border-white/10 px-3 text-sm text-mist-100">Add member</button>
      <div className="md:col-span-5"><ErrorNote error={error} /></div>
    </form>
  );
}

import Link from "next/link";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { analyticsOverview } from "@/lib/analytics/service";
import { listDecisions, suggestedRules } from "@/lib/brain/decisions";
import { listCharacters } from "@/lib/brain/characters";
import { Action } from "@/components/client/action";
import { CsvImport, DecisionForm } from "@/components/studio/analytics-forms";
import { Badge, Card, Empty, Notice, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { cn, timeAgo } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics & Learning" };

export default async function Analytics({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const tab = sp.tab ?? "performance";
  const [a, decisions, rules, chars] = await Promise.all([analyticsOverview(viewer.orgId), listDecisions(viewer.orgId, sp.q), suggestedRules(viewer.orgId), listCharacters(viewer.orgId)]);
  const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
  const Table = ({ title, rows }: { title: string; rows: typeof a.byCharacter }) => (
    <Card>
      <SectionTitle title={title} />
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wider text-mist-500"><tr><th className="py-1">Group</th><th>Posts</th><th>Avg views</th><th>Share rate</th><th>Save rate</th><th>Retention</th><th>Confidence</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key} className="border-t border-white/[0.04]"><td className="py-1.5 text-mist-100">{r.key}</td><td>{r.posts}</td><td>{r.avgViews?.toLocaleString() ?? "—"}</td><td>{pct(r.shareRate)}</td><td>{pct(r.saveRate)}</td><td>{r.avgRetention === null ? "—" : `${r.avgRetention.toFixed(1)}%`}</td><td><Badge tone={r.confidence === "LOW" ? "warn" : "ok"}>{r.confidence.toLowerCase()}</Badge></td></tr>)}</tbody>
      </table>
    </Card>
  );
  return (
    <div>
      <PageHeader eyebrow="14 · Analytics & Learning" title="What's working – and what we've learned" sub="Only imported or connected data is shown; missing metrics stay blank. Creative feedback is captured as structured decisions that steer future retrieval, prompts and ranking. (The underlying AI models are not trained on this.)" />
      <nav className="mb-6 flex gap-1 border-b border-white/[0.06]">
        {["performance", "decisions", "connections"].map((t) => <Link key={t} href={`/analytics?tab=${t}`} className={cn("-mb-px border-b-2 px-3 py-2 text-[12px] uppercase tracking-[0.1em]", tab === t ? "border-calm-300 text-white" : "border-transparent text-mist-400")}>{t === "decisions" ? "Creative decisions log" : t}</Link>)}
      </nav>
      {tab === "performance" && (
        a.total === 0 ? (
          <div className="space-y-6">
            <Empty title="No performance data yet">Import a CSV export from TikTok, Instagram or YouTube analytics. Recognised columns: post_id, platform, title, posted_at, views, watch_time, retention, shares, saves, likes, comments, followers_gained, characters, format, theme.</Empty>
            {can(viewer.role, "analytics:import") && <CsvImport />}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <Stat label="Posts imported" value={a.total} />
              <Stat label="Total views (where supplied)" value={a.byPlatform.reduce((n, p) => n + (p.views ?? 0), 0).toLocaleString()} />
              <Stat label="Platforms" value={a.byPlatform.length} />
              <Stat label="Metrics not supplied" value={a.missing.length} sub={a.missing.join(", ") || "none"} />
            </div>
            <Card><SectionTitle title="Recommendations" sub="Derived from observed data, with sample sizes – correlations, not proof" /><ul className="list-disc space-y-1.5 pl-5 text-sm text-mist-200">{a.recommendations.map((r) => <li key={r}>{r}</li>)}</ul></Card>
            <div className="grid gap-6 xl:grid-cols-2">
              <Table title="By character" rows={a.byCharacter} />
              <Table title="By format" rows={a.byFormat} />
              <Table title="By theme" rows={a.byTheme} />
              <Table title="By platform" rows={a.byPlatform} />
            </div>
            {can(viewer.role, "analytics:import") && <CsvImport />}
          </div>
        )
      )}
      {tab === "decisions" && (
        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <Card>
            <SectionTitle title="Creative decisions log" sub="Selections, rejections, corrections and rules – retrieved by agents on future tasks" action={<form action="/analytics"><input type="hidden" name="tab" value="decisions" /><input name="q" defaultValue={sp.q} placeholder="Search decisions" className="field w-48 py-1 text-xs" /></form>} />
            {decisions.length === 0 ? <p className="text-sm text-mist-400">Decisions are recorded automatically as you select, approve, reject and request changes.</p> : decisions.map((d) => (
              <div key={d.id} className={cn("border-b border-white/[0.05] py-2 last:border-0", !d.active && "opacity-50")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={d.isRule ? "calm" : d.kind === "rejection" ? "bad" : d.kind === "correction" ? "violet" : "neutral"}>{d.isRule ? "RULE" : d.kind}</Badge>
                  <span className="text-sm text-mist-100">{d.summary}</span>
                </div>
                {d.detail && <p className="mt-0.5 text-xs text-mist-400">“{d.detail}”</p>}
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-mist-500">
                  {timeAgo(d.createdAt)}{d.characterIds.length > 0 && ` · ${d.characterIds.map((c) => chars.find((x) => x.id === c)?.name ?? c).join(", ")}`}{d.department && ` · ${d.department}`}
                  {can(viewer.role, "canon:approve") && <Action endpoint="/api/decisions" method="PATCH" body={{ id: d.id, active: !d.active }} size="sm" variant="ghost" className="px-1 py-0 text-[10px]">{d.active ? "retire" : "reactivate"}</Action>}
                </div>
              </div>
            ))}
          </Card>
          <div className="space-y-6">
            {rules.length > 0 && (
              <Card>
                <SectionTitle title="Repeated corrections" sub="Patterns seen 3+ times – adopt one as a rule so every agent follows it" />
                {rules.map((r) => <div key={r.key} className="mb-3 text-sm"><div className="text-white">{r.count}× {r.tag.replace(/_/g, " ")}{r.characterIds.length ? ` · ${r.characterIds.map((c) => chars.find((x) => x.id === c)?.name ?? c).join(", ")}` : ""}</div><ul className="list-disc pl-5 text-xs text-mist-400">{r.examples.slice(0, 3).map((e) => <li key={e.id}>{e.detail || e.summary}</li>)}</ul></div>)}
              </Card>
            )}
            {can(viewer.role, "review:comment") && <DecisionForm characters={chars.map((c) => ({ id: c.id, name: c.name }))} canRule={can(viewer.role, "canon:approve")} />}
          </div>
        </div>
      )}
      {tab === "connections" && (
        <div className="space-y-4">
          <Notice tone="calm" title="CSV import is available now">Social platform connectors (TikTok, Instagram, YouTube Analytics) require OAuth apps approved by each platform and are not connected in this build. Nothing is estimated in their absence.</Notice>
          {can(viewer.role, "analytics:import") && <CsvImport />}
        </div>
      )}
    </div>
  );
}

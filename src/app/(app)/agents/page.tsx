import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { AGENTS, DEPARTMENT_LABELS, AGENT_BY_KEY } from "@/lib/agents/definitions";
import { listTemplates } from "@/lib/workflows/registry";
import { STEP_TYPES } from "@/lib/workflows/templates";
import { WorkflowBuilder } from "@/components/agents/workflow-builder";
import { LiveRefresh } from "@/components/client/live";
import { Badge, Card, PageHeader, SectionTitle, Status } from "@/components/ui";
import { cn, timeAgo, usd } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent Headquarters" };

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; key?: string }> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const tab = sp.tab ?? "agents";
  const db = await getDb();
  const stats = await db.select({ key: schema.agentRuns.agentKey, runs: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${schema.agentRuns.costCents}),0)::float`, failed: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'failed')::int`, last: sql<Date>`max(${schema.agentRuns.startedAt})` }).from(schema.agentRuns).where(eq(schema.agentRuns.orgId, viewer.orgId)).groupBy(schema.agentRuns.agentKey);
  const overrides = await db.select().from(schema.agents).where(eq(schema.agents.orgId, viewer.orgId));
  const running = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.orgId, viewer.orgId)).orderBy(desc(schema.agentRuns.startedAt)).limit(60);
  const templates = await listTemplates(viewer.orgId);
  const tpl = templates.find((t) => t.key === sp.key) ?? templates[0];
  return (
    <div>
      <LiveRefresh scope="org" />
      <PageHeader eyebrow="12 · Agent Headquarters" title="The specialist team" sub="45 agents collaborating through typed tasks and shared artifacts – never open-ended chat loops. None can publish, spend beyond budget, contact partners or alter canon without a human." />
      <nav className="mb-6 flex gap-1 border-b border-white/[0.06]">
        {["agents", "runs", "workflows"].map((t) => <Link key={t} href={`/agents?tab=${t}`} className={cn("-mb-px border-b-2 px-3 py-2 text-[12px] uppercase tracking-[0.1em]", tab === t ? "border-calm-300 text-white" : "border-transparent text-mist-400")}>{t === "workflows" ? "Pipelines & workflow builder" : t === "runs" ? "Run history" : "Agents"}</Link>)}
      </nav>
      {tab === "agents" && (
        <div className="space-y-8">
          {(Object.keys(DEPARTMENT_LABELS) as (keyof typeof DEPARTMENT_LABELS)[]).map((d) => (
            <div key={d}>
              <div className="label mb-3">{DEPARTMENT_LABELS[d]}</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {AGENTS.filter((a) => a.department === d).map((a) => {
                  const s = stats.find((x) => x.key === a.key);
                  const o = overrides.find((x) => x.key === a.key);
                  return (
                    <Link key={a.key} href={`/agents/${a.key}`} className="panel p-4 transition hover:border-calm-300/25">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-white">{a.name}</div>
                        {o && !o.enabled ? <Badge tone="bad">off</Badge> : o ? <Badge tone="calm">customised</Badge> : null}
                      </div>
                      <div className="text-xs text-mist-400">{a.role}</div>
                      <div className="mt-2 flex flex-wrap gap-1">{a.tools.slice(0, 4).map((t) => <span key={t} className="rounded bg-white/[0.05] px-1.5 text-[10px] text-mist-300">{t.replace(/_/g, " ")}</span>)}</div>
                      <div className="mt-3 text-[11px] text-mist-500">{s ? `${s.runs} runs · ${usd(s.cost)} · ${s.failed} failed · last ${timeAgo(s.last)}` : "No runs yet"} · budget {a.budgetCentsPerRun}¢/run</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "runs" && (
        <Card>
          <SectionTitle title="Recent agent runs" />
          {running.map((r) => (
            <Link key={r.id} href={r.productionId ? `/productions/${r.productionId}` : `/agents/${r.agentKey}`} className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/[0.05] py-2 text-sm last:border-0 hover:bg-white/[0.02]">
              <div>
                <div className="text-mist-100">{AGENT_BY_KEY[r.agentKey]?.name ?? r.agentKey} <span className="text-mist-500">· {r.task}</span></div>
                <div className="text-xs text-mist-500">{r.provider ?? "local"} / {r.model ?? "—"} · {usd(r.costCents)} · {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "…"} · {timeAgo(r.startedAt)}</div>
                {r.error && <div className="text-xs text-bad">{r.error}</div>}
              </div>
              <Status value={r.status === "succeeded" ? "completed" : r.status} />
            </Link>
          ))}
          {!running.length && <p className="text-sm text-mist-400">No runs yet.</p>}
        </Card>
      )}
      {tab === "workflows" && tpl && (
        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <Card className="p-3">
            {templates.map((t) => (
              <Link key={t.key} href={`/agents?tab=workflows&key=${t.key}`} className={cn("block rounded-lg px-3 py-2 text-sm", t.key === tpl.key ? "bg-calm-400/10 text-white" : "text-mist-300 hover:bg-white/[0.03]")}>
                {t.name}
                <span className="block text-[11px] text-mist-500">{t.department} · {t.builtIn ? "built-in" : `custom v${t.version}`}</span>
              </Link>
            ))}
          </Card>
          <Card className="min-w-0">
            <SectionTitle title={tpl.name} sub={<span className="block break-words">{tpl.description}</span>} />
            <WorkflowBuilder key={tpl.key} template={{ ...tpl, steps: tpl.steps.map((s) => ({ ...s, config: s.config ?? {} })) }} stepTypes={Object.values(STEP_TYPES)} agents={AGENTS.map((a) => ({ key: a.key, name: a.name }))} canEdit={can(viewer.role, "workflow:edit")} />
          </Card>
        </div>
      )}
    </div>
  );
}

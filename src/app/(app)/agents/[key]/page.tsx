import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getAgentConfig } from "@/lib/agents/run";
import { AgentEditor } from "@/components/agents/agent-editor";
import { StructuredView } from "@/components/production/output";
import { Badge, Card, KeyVal, PageHeader, SectionTitle, Status } from "@/components/ui";
import { timeAgo, usd } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ key: string }> }) {
  const viewer = await requireViewer();
  const { key } = await params;
  const a = await getAgentConfig(viewer.orgId, key);
  const db = await getDb();
  const runs = await db.select().from(schema.agentRuns).where(and(eq(schema.agentRuns.orgId, viewer.orgId), eq(schema.agentRuns.agentKey, key))).orderBy(desc(schema.agentRuns.startedAt)).limit(40);
  return (
    <div>
      <PageHeader eyebrow={`Agent Headquarters · ${a.department}`} title={a.name} sub={a.role} actions={<>{a.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="bad">disabled</Badge>}{a.customised && <Badge tone="calm">customised</Badge>}</>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Card>
            <SectionTitle title="Profile" />
            <KeyVal k="Tools" v={a.tools.join(", ") || "deterministic only"} />
            <KeyVal k="Permissions" v={a.permissions.join(", ")} />
            <KeyVal k="Budget per run" v={`${a.budgetCentsPerRun}¢`} />
            <KeyVal k="Reference access" v={a.permissions.includes("read_canon") ? "Approved canon for the production's cast only" : "None"} />
            <KeyVal k="Escalation" v={a.escalation} />
            <div className="label mb-1 mt-4">Quality criteria</div>
            <ul className="list-disc pl-5 text-sm text-mist-200">{a.qualityCriteria.map((q) => <li key={q}>{q}</li>)}</ul>
            <div className="label mb-1 mt-4">Hard limits</div>
            <p className="text-sm text-mist-300">Cannot publish, spend beyond budget, contact external partners, alter canon or commit game changes. New canon is saved as an AI proposal awaiting approval.</p>
          </Card>
          <Card>
            <SectionTitle title="System instructions" />
            {can(viewer.role, "agents:edit") ? <AgentEditor agentKey={key} instructions={a.instructions} enabled={a.enabled} budget={a.budgetCentsPerRun} quality={a.qualityPreference} /> : <pre className="whitespace-pre-wrap text-xs text-mist-300">{a.instructions}</pre>}
          </Card>
        </div>
        <Card>
          <SectionTitle title="Run history" sub="Task queue and results" />
          {runs.map((r) => (
            <details key={r.id} className="border-b border-white/[0.05] py-2 last:border-0">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                <span className="text-mist-100">{r.task}</span>
                <Status value={r.status === "succeeded" ? "completed" : r.status} />
                <span className="text-xs text-mist-500">{usd(r.costCents)} · {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "…"} · {timeAgo(r.startedAt)}</span>
                {r.productionId && <Link href={`/productions/${r.productionId}`} className="link text-xs">production</Link>}
              </summary>
              <div className="mt-2 space-y-2 text-xs">
                {r.error && <div className="text-bad">{r.error}</div>}
                <div className="text-mist-400">{r.provider} / {r.model} · prompt {r.promptVersion} · refs {r.referencesUsed.assetVersionIds.length} · canon {r.referencesUsed.canonRecordIds.length + r.referencesUsed.characterVersionIds.length}</div>
                {r.output != null && <div className="max-h-72 overflow-auto rounded bg-ink-950 p-2"><StructuredView value={r.output} /></div>}
              </div>
            </details>
          ))}
          {!runs.length && <p className="text-sm text-mist-400">No runs yet.</p>}
        </Card>
      </div>
    </div>
  );
}

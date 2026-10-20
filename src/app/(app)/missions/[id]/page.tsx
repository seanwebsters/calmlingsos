import Link from "next/link";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getMission } from "@/lib/agents/team";
import { AGENT_BY_KEY } from "@/lib/agents/definitions";
import type { TranscriptEntry } from "@/db/schema";
import { Action } from "@/components/client/action";
import { LiveRefresh } from "@/components/client/live";
import { Badge, Card, Empty, KeyVal, PageHeader, Progress, SectionTitle, Status } from "@/components/ui";
import { timeAgo, usd } from "@/lib/cn";

export const dynamic = "force-dynamic";

type Task = Awaited<ReturnType<typeof getMission>>["tasks"][number];

const OUTPUT_HREF: Record<string, (id: string) => string> = {
  document: (id) => `/assets/${id}`,
  image: (id) => `/assets/${id}`,
  canon: () => `/canon?status=draft`,
  production: (id) => `/productions/${id}`,
};

const KIND_TONE: Record<TranscriptEntry["kind"], string> = { note: "neutral", tool: "calm", result: "neutral", handoff: "calm", human: "ok", error: "bad" };

function TaskNode({ task, all, open }: { task: Task; all: Task[]; open: boolean }) {
  const agent = AGENT_BY_KEY[task.agentKey];
  const children = all.filter((t) => t.parentTaskId === task.id);
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <details open={open}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
            <span className="font-medium text-mist-50">{agent?.name ?? task.agentKey}</span>
            <span className="text-sm text-mist-300">· {task.title}</span>
            <span className="ml-auto flex items-center gap-2 text-xs text-mist-400">
              {task.turns} turns · {usd(task.costCents)} · {timeAgo(task.updatedAt)}
              <Status value={task.status} />
            </span>
          </summary>
          <div className="mt-3 space-y-3 text-sm">
            <p className="whitespace-pre-wrap text-mist-300">{task.instructions}</p>
            {task.error && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{task.error}</p>}
            {task.transcript.length > 0 && (
              <ol className="space-y-1.5 border-l border-white/10 pl-3">
                {task.transcript.map((e, i) => (
                  <li key={i} className="text-xs leading-relaxed">
                    <Badge tone={KIND_TONE[e.kind]} className="mr-2">{e.tool ?? e.kind}</Badge>
                    <span className="whitespace-pre-wrap text-mist-200">{e.text.length > 600 ? `${e.text.slice(0, 600)}…` : e.text}</span>
                  </li>
                ))}
              </ol>
            )}
            {task.outputs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {task.outputs.map((o) => (
                  <Link key={o.id} href={OUTPUT_HREF[o.type]?.(o.id) ?? "#"} className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-mist-100 hover:bg-white/[0.08]">
                    {o.type}: {o.title}
                  </Link>
                ))}
              </div>
            )}
            {task.pendingApprovalId && (
              <Link href="/approvals" className="inline-block text-xs font-medium text-calm-300 underline">Waiting on your decision in Approvals →</Link>
            )}
            {task.report && (
              <div className="rounded-lg border border-white/10 bg-ink-900/60 p-3">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-mist-400">Report</div>
                <p className="whitespace-pre-wrap text-mist-100">{task.report}</p>
              </div>
            )}
          </div>
        </details>
      </Card>
      {children.length > 0 && (
        <div className="space-y-3 border-l border-white/10 pl-4">
          {children.map((c) => (
            <TaskNode key={c.id} task={c} all={all} open={!["done", "cancelled"].includes(c.status)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default async function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const { mission: m, tasks } = await getMission(viewer.orgId, id);
  const canRun = can(viewer.role, "production:run");
  const root = tasks.find((t) => !t.parentTaskId);
  const done = tasks.filter((t) => t.status === "done").length;
  const active = !["completed", "failed", "cancelled"].includes(m.status);
  const outputs = tasks.flatMap((t) => t.outputs.map((o) => ({ ...o, agent: AGENT_BY_KEY[t.agentKey]?.name ?? t.agentKey })));

  return (
    <div>
      {active && <LiveRefresh scope={`mission:${id}`} />}
      <PageHeader
        eyebrow={`Agent team mission · ${m.id}`}
        title={m.goal.length > 90 ? `${m.goal.slice(0, 90)}…` : m.goal}
        sub={`Started ${timeAgo(m.createdAt)} · ${tasks.length} tasks across ${new Set(tasks.map((t) => t.agentKey)).size} agents`}
        actions={
          <>
            <Status value={m.status} />
            <Link href="/agents" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-mist-100 hover:bg-white/[0.08]">Watch the office</Link>
            {canRun && ["blocked", "failed", "cancelled"].includes(m.status) && <Action endpoint={`/api/missions/${id}/resume`} variant="primary">Resume</Action>}
            {canRun && (m.status === "blocked" || m.spentCents >= m.budgetCents * 0.8) && (
              <Action endpoint={`/api/missions/${id}/budget`} prompt="New total budget in USD" promptField="notes">Raise budget</Action>
            )}
            {canRun && active && <Action endpoint={`/api/missions/${id}/cancel`} variant="danger" confirm="Stop the team? Finished work is kept and you can resume later.">Stop</Action>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <SectionTitle title="Team activity" sub="The Studio Director plans and delegates; specialists work with real tools and report back. Everything they make goes to review." />
          {root ? <TaskNode task={root} all={tasks} open /> : <Empty title="No tasks yet" />}
        </div>
        <div className="space-y-4">
          <Card className="space-y-2 p-4">
            <KeyVal k="Status" v={<Status value={m.status} />} />
            <KeyVal k="Tasks done" v={`${done} / ${tasks.length}`} />
            <KeyVal k="Spent" v={`${usd(m.spentCents)} of ${usd(m.budgetCents)}`} />
            <Progress value={m.budgetCents ? Math.min(100, (m.spentCents / m.budgetCents) * 100) : 0} />
            {m.error && <p className="text-xs text-bad">{m.error}</p>}
          </Card>
          <Card className="p-4">
            <div className="mb-2 text-sm font-medium text-mist-50">Goal</div>
            <p className="whitespace-pre-wrap text-sm text-mist-300">{m.goal}</p>
          </Card>
          <Card className="p-4">
            <div className="mb-2 text-sm font-medium text-mist-50">Deliverables ({outputs.length})</div>
            {outputs.length ? (
              <ul className="space-y-1.5 text-sm">
                {outputs.map((o) => (
                  <li key={o.id}>
                    <Link href={OUTPUT_HREF[o.type]?.(o.id) ?? "#"} className="text-calm-300 hover:underline">{o.title}</Link>
                    <span className="text-xs text-mist-400"> · {o.type} · {o.agent}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-mist-400">Nothing yet. Drafts appear here and in review as agents save them.</p>
            )}
          </Card>
          {m.report && (
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium text-mist-50">Director&apos;s report</div>
              <p className="whitespace-pre-wrap text-sm text-mist-200">{m.report}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

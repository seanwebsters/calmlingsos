import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Cpu, Sparkles } from "lucide-react";
import { requireViewer } from "@/lib/auth/session";
import { missionControl, suggestions } from "@/lib/dashboard";
import { deploymentWarnings } from "@/lib/env";
import { AGENT_BY_KEY } from "@/lib/agents/definitions";
import { CommandBar } from "@/components/client/command-bar";
import { LiveRefresh } from "@/components/client/live";
import { Badge, Card, Empty, Notice, Placeholder, Progress, SectionTitle, Stat, Status } from "@/components/ui";
import { timeAgo, usd } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mission Control" };

export default async function Mission() {
  const viewer = await requireViewer();
  const d = await missionControl(viewer.orgId);
  const ideas = suggestions(d);
  const warnings = deploymentWarnings();
  const hour = new Date().getHours();
  return (
    <div className="space-y-8">
      <LiveRefresh scope="org" />
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-ink-800 via-ink-850 to-ink-900 p-8 shadow-card animate-rise">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-calm-400/10 blur-3xl" />
        <div className="label text-calm-300">01 · Mission Control</div>
        <h1 className="mt-2 font-display text-4xl text-white">Good {hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, {viewer.name.split(" ")[0]}.</h1>
        <p className="mt-1 text-mist-300">What should we create today?</p>
        <div className="mt-6 max-w-4xl">
          <CommandBar big characters={d.characters.map((c) => ({ id: c.id, name: c.name, approved: Boolean(c.approvedVersionId) }))} />
        </div>
      </section>

      {warnings.filter((w) => w.startsWith("TEMPORARY DATABASE")).map((w) => <Notice key={w} tone="warn" title="This deployment doesn't keep data yet">{w.replace("TEMPORARY DATABASE: ", "")}</Notice>)}
      {warnings.length > 0 && (
        <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-sm text-mist-400">
          <summary className="cursor-pointer text-mist-300">Deployment notes ({warnings.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Active productions" value={d.active.length} sub={`${d.active.filter((p) => p.status === "running").length} running now`} tone="calm" />
        <Stat label="Awaiting your approval" value={d.approvals.length} tone={d.approvals.length ? "warn" : undefined} sub="human gates" />
        <Stat label="Needs attention" value={d.failedSteps.length} tone={d.failedSteps.length ? "bad" : undefined} sub="failed or blocked steps" />
        <Stat label="Generation spend · month" value={usd(d.monthCostCents)} sub={`of ${usd(d.monthlyBudgetCents, 0)} limit · list-price estimates`} />
        <Stat label="Job queue" value={(d.jobs.queued ?? 0) + (d.jobs.running ?? 0)} sub={`${d.jobs.running ?? 0} running · ${d.jobs.failed ?? 0} failed`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <SectionTitle title="Active productions" sub="Live – updates as agents work" action={<Link href="/social" className="link text-sm">New production →</Link>} />
          {d.active.length === 0 ? (
            <Empty title="Nothing in production" icon={<Sparkles className="size-6" />}>Use the command bar above, or start from a studio.</Empty>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {d.active.map((p) => (
                <Link key={p.id} href={`/productions/${p.id}`} className="flex items-center gap-4 py-3 transition hover:bg-white/[0.02]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-white">{p.title}</div>
                    <div className="text-xs text-mist-400">{p.department} · {p.templateKey.replace(/_/g, " ")} · updated {timeAgo(p.updatedAt)}</div>
                  </div>
                  <div className="hidden w-40 sm:block">
                    <Progress value={p.budgetCents ? p.spentCents / p.budgetCents : 0} />
                    <div className="mt-1 text-right text-[11px] text-mist-500">{usd(p.spentCents)} / {usd(p.budgetCents, 0)}</div>
                  </div>
                  <Status value={p.status} />
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle title="Waiting on you" action={<Link href="/approvals" className="link text-sm">Approvals →</Link>} />
          {d.approvals.length === 0 ? (
            <Empty title="All clear" icon={<CheckCircle2 className="size-6" />}>No decisions pending.</Empty>
          ) : (
            <ul className="space-y-2">
              {d.approvals.map((a) => (
                <li key={a.id}>
                  <Link href="/approvals" className="block rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2 hover:border-warn/30">
                    <div className="flex items-center gap-2">
                      <Badge tone="warn">{a.kind.replace("_", " ")}</Badge>
                      <span className="truncate text-sm text-white">{a.title}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-mist-400">{a.summary}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle title="Character development" sub="Production readiness is a checklist of approved canon, not a quality score" action={<Link href="/characters" className="link text-sm">Character Universe →</Link>} />
          {d.characters.length === 0 ? (
            <Empty title="No characters yet">Create characters from your official references – the system never invents what Calmlings look like.</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {d.characters.slice(0, 8).map((c) => (
                <Link key={c.id} href={`/characters/${c.id}`} className="group rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 hover:border-calm-300/25">
                  {c.heroUrl ? <img src={c.heroUrl} alt={c.name} className="aspect-square w-full rounded-lg bg-ink-900 object-contain" /> : <Placeholder />}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-white">{c.name}</span>
                    <Status value={c.canonStatus} />
                  </div>
                  <Progress value={c.readiness.score} className="mt-2" />
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle title="Suggested next" />
          <ul className="space-y-2">
            {ideas.map((s) => (
              <li key={s.title}>
                <Link href={s.href} className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.03]">
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-calm-300" />
                  <div>
                    <div className="text-sm text-white">{s.title}</div>
                    <div className="text-xs text-mist-400">{s.why}</div>
                  </div>
                </Link>
              </li>
            ))}
            {!ideas.length && <li className="text-sm text-mist-400">Nothing urgent. The studio is in good shape.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <SectionTitle title="Agent activity" action={<Link href="/agents" className="link text-sm">HQ →</Link>} />
          {d.runs.length === 0 ? <p className="text-sm text-mist-400">No agent runs yet.</p> : (
            <ul className="space-y-2.5">
              {d.runs.map((r) => (
                <li key={r.id} className="flex items-start gap-3 text-sm">
                  <Cpu className="mt-0.5 size-4 shrink-0 text-mist-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-mist-100">{AGENT_BY_KEY[r.agentKey]?.name ?? r.agentKey}</div>
                    <div className="truncate text-xs text-mist-500">{r.task} · {timeAgo(r.startedAt)} · {usd(r.costCents)}</div>
                  </div>
                  <Status value={r.status === "succeeded" ? "completed" : r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle title="Recently approved" />
          {d.approved.length === 0 ? <p className="text-sm text-mist-400">Approved outputs appear here.</p> : (
            <div className="grid grid-cols-4 gap-2">
              {d.approved.map((a) => (
                <Link key={a.id} href={`/assets/${a.id}`} title={a.title} className="overflow-hidden rounded-lg border border-white/[0.05] bg-ink-900">
                  {a.thumbUrl ? <img src={a.thumbUrl} alt={a.title} className="aspect-square w-full object-cover" /> : <Placeholder label={a.kind} />}
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <SectionTitle title="Deadlines & upcoming" action={<Link href="/calendar" className="link text-sm">Calendar →</Link>} />
          {d.calendar.length === 0 ? <p className="text-sm text-mist-400">Nothing scheduled.</p> : (
            <ul className="space-y-2">
              {d.calendar.map((c) => (
                <li key={c.id} className="flex items-center gap-3 text-sm">
                  <CalendarDays className="size-4 text-mist-500" />
                  <span className="w-16 text-xs text-mist-400">{c.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                  <span className="flex-1 truncate text-mist-100">{c.title}</span>
                  <Status value={c.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionTitle title="Needs attention" sub="Failed and blocked steps – each shows the real reason" />
          {d.failedSteps.length === 0 ? <p className="text-sm text-mist-400">No failed jobs.</p> : (
            <ul className="space-y-2">
              {d.failedSteps.map(({ s, p }) => (
                <li key={s.id}>
                  <Link href={`/productions/${p.id}`} className="flex items-start gap-3 rounded-xl border border-bad/15 bg-bad/[0.04] px-3 py-2 hover:border-bad/30">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" />
                    <div className="min-w-0">
                      <div className="text-sm text-white">{p.title} · {s.name}</div>
                      <div className="line-clamp-2 text-xs text-mist-400">{s.error}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle title="Resources & integrations" action={<Link href="/settings" className="link text-sm">Settings →</Link>} />
          <div className="mb-4 flex flex-wrap gap-2">
            {d.providers.map((p) => (
              <Badge key={p.key} tone={p.connected ? "ok" : "neutral"} dot>
                {p.name}: {p.connected ? "connected" : "not connected"}
              </Badge>
            ))}
          </div>
          <div className="label mb-2">Spend by provider this month (estimates)</div>
          {d.costByProvider.length === 0 ? <p className="text-sm text-mist-400">No spend recorded.</p> : d.costByProvider.map((c) => (
            <div key={c.provider} className="flex justify-between border-b border-white/[0.04] py-1.5 text-sm last:border-0">
              <span className="text-mist-300">{c.provider} <span className="text-mist-500">· {c.calls} calls</span></span>
              <span className="text-white">{usd(c.n)}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

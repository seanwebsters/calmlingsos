import Link from "next/link";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { productionView } from "@/lib/productions";
import { AGENTS, AGENT_BY_KEY } from "@/lib/agents/definitions";
import { PROVIDERS } from "@/lib/providers/definitions";
import { providerStatuses } from "@/lib/providers/gateway";
import { STEP_TYPES } from "@/lib/workflows/templates";
import type { Out } from "@/lib/workflows/schemas";
import { Action } from "@/components/client/action";
import { LiveRefresh } from "@/components/client/live";
import { PlanEditor } from "@/components/production/plan-editor";
import { StepCard } from "@/components/production/step-card";
import { Selection, type Candidate } from "@/components/production/selection";
import { StructuredView } from "@/components/production/output";
import { OutputEditor } from "@/components/production/output-editor";
import { ShotRow } from "@/components/production/shot-row";
import { GenTile } from "@/components/media";
import { Badge, Card, Empty, KeyVal, PageHeader, Progress, SectionTitle, Status } from "@/components/ui";
import { timeAgo, titleCase, usd } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function ProductionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; tab?: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const v = await productionView(viewer.orgId, id);
  const { production: p, steps } = v;
  const canRun = can(viewer.role, "production:run");
  const canApprove = can(viewer.role, "review:approve");
  const focusKey = sp.step ?? steps.find((s) => ["awaiting_input", "awaiting_approval", "blocked", "failed"].includes(s.status))?.key ?? [...steps].reverse().find((s) => s.status === "completed" || s.status === "running")?.key ?? steps[0]?.key;
  const focus = steps.find((s) => s.key === focusKey) ?? steps[0];
  const focusAssets = v.assets.filter((a) => a.stepId === focus?.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const focusRuns = v.runs.filter((r) => r.stepId === focus?.id);
  const done = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  const providers = (await providerStatuses(viewer.orgId)).map((x) => ({ key: x.key, name: x.name, connected: x.connected }));
  const snapshot = p.contextSnapshot as { characters?: { name: string; version: number }[]; references?: number; canonRecords?: number; rules?: number; retrieval?: string; warnings?: string[]; builtAt?: string } | null;
  const tab = sp.tab ?? (v.social.length ? "workspace" : "deliverables");

  // Candidate list for a selection gate.
  let candidates: Candidate[] = [];
  let max = 99;
  if (focus?.handler === "human_select" && focus.status === "awaiting_input") {
    const src = steps.find((s) => s.key === focus.config.fromStep);
    const path = String(focus.config.path ?? "items");
    const items = ((src?.output as Record<string, unknown> | null)?.[path] as Record<string, unknown>[] | undefined) ?? [];
    type Scored = Out<"evaluation">["scores"][number] & { total: number; originalityFlags: { matches: string; field: string }[] };
    const evalOut = steps.find((s) => s.key === "evaluate")?.output as { scores?: Scored[] } | null;
    const ranking = (steps.find((s) => s.key === "evaluate")?.output as { ranking?: string[] } | null)?.ranking;
    candidates = items.map((it) => {
      const sc = evalOut?.scores?.find((s) => s.conceptId === it.id);
      const asset = typeof it.assetId === "string" ? v.assets.find((a) => a.id === it.assetId) : null;
      return {
        id: String(it.id),
        title: String(it.title ?? it.name ?? it.id),
        body: String(it.logline ?? it.hook ?? it.description ?? ""),
        meta: [it.format, it.theme, it.emotionalMessage].filter(Boolean).join(" · "),
        score: sc?.total ?? null,
        flags: [...(sc?.originalityFlags ?? []).map((f: { matches: string; field: string }) => `resembles ${f.matches} (${f.field})`), ...(sc?.risks ?? [])],
        imageUrl: asset?.thumbUrl ?? asset?.url ?? null,
      };
    });
    if (ranking) candidates.sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id));
    max = typeof focus.config.max === "number" ? focus.config.max : typeof focus.config.maxFromBrief === "string" ? Number(p.brief[focus.config.maxFromBrief as string] ?? 99) : 99;
  }

  return (
    <div>
      <LiveRefresh scope={`production:${id}`} />
      <PageHeader
        eyebrow={`${titleCase(p.department)} · ${titleCase(p.templateKey)} · ${p.id}`}
        title={p.title}
        sub={p.command ? `“${p.command}”` : undefined}
        actions={
          <>
            <Status value={p.status} />
            {canRun && ["running", "awaiting_input", "blocked"].includes(p.status) && <Action endpoint={`/api/productions/${id}/pause`}>Pause</Action>}
            {canRun && ["paused", "blocked", "failed", "cancelled"].includes(p.status) && <Action endpoint={`/api/productions/${id}/resume`} variant="primary">Resume</Action>}
            {canRun && !["completed", "cancelled"].includes(p.status) && <Action endpoint={`/api/productions/${id}/cancel`} variant="danger" confirm="Stop this production? Completed and approved work is kept; you can resume later.">Stop</Action>}
          </>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card className="p-4"><div className="label">Progress</div><div className="mt-1 font-display text-2xl text-white">{done}/{steps.length}</div><Progress value={done / Math.max(1, steps.length)} className="mt-2" /></Card>
        <Card className="p-4"><div className="label">Spend (estimates)</div><div className="mt-1 font-display text-2xl text-white">{usd(p.spentCents)}</div><div className="text-xs text-mist-400">budget {usd(p.budgetCents, 0)}{canApprove && <> · <Action endpoint={`/api/productions/${id}/budget`} size="sm" variant="ghost" prompt="New budget in USD:" className="px-1 py-0">raise</Action></>}</div></Card>
        <Card className="p-4"><div className="label">Cast</div><div className="mt-2 flex flex-wrap gap-1.5">{v.characters.length ? v.characters.map((c) => <Link key={c.id} href={`/characters/${c.id}`}><Badge tone="calm">{c.name}</Badge></Link>) : <span className="text-sm text-mist-400">No characters</span>}</div></Card>
        <Card className="p-4">
          <div className="label">Canon snapshot</div>
          {snapshot ? <div className="mt-1 text-xs text-mist-300">{snapshot.characters?.map((c) => `${c.name} v${c.version}`).join(", ") || "no approved characters"} · {snapshot.references} refs · {snapshot.canonRecords} canon · {snapshot.rules} rules · {snapshot.retrieval} retrieval</div> : <div className="mt-1 text-xs text-mist-500">Captured when canon retrieval runs.</div>}
          {snapshot?.warnings?.length ? <div className="mt-1 text-[11px] text-warn">{snapshot.warnings.join(" ")}</div> : null}
        </Card>
      </div>

      {p.status === "planning" && (
        <div className="mb-8">
          <PlanEditor productionId={id} budgetCents={p.budgetCents} canStart={canRun} agents={AGENTS.map((a) => ({ key: a.key, name: a.name, department: a.department }))} providers={providers.length ? providers : PROVIDERS.map((x) => ({ key: x.key, name: x.name, connected: false }))} steps={steps.map((s) => ({ key: s.key, name: s.name, agentKey: s.agentKey, handler: s.handler, requiresApproval: s.requiresApproval, providerOverride: s.providerOverride, budgetEstimateCents: s.budgetEstimateCents, human: s.handler.startsWith("human_") }))} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="space-y-2">
          <div className="label mb-2">Pipeline</div>
          {steps.map((s, i) => <StepCard key={s.id} step={s} index={i} active={s.key === focus?.key} productionId={id} canRun={canRun && p.status !== "planning"} canApprove={canApprove} />)}
        </div>
        <div className="space-y-6">
          {focus && (
            <Card>
              <SectionTitle
                title={focus.name}
                sub={`${STEP_TYPES[String(focus.config.type)]?.description ?? ""}${focus.agentKey ? ` · ${AGENT_BY_KEY[focus.agentKey]?.name}` : ""}`}
                action={<Status value={focus.status} />}
              />
              <div className="mb-4 grid gap-2 text-xs text-mist-400 md:grid-cols-2">
                <div>Input: <span className="text-mist-200">{STEP_TYPES[String(focus.config.type)]?.inputSchema}</span></div>
                <div>Output: <span className="text-mist-200">{STEP_TYPES[String(focus.config.type)]?.outputSchema}</span></div>
                <div>Depends on: <span className="text-mist-200">{focus.dependsOn.join(", ") || "—"}</span></div>
                <div>Estimate {usd(focus.budgetEstimateCents)} · actual {usd(focus.actualCostCents)} · retries ≤ {focus.maxAttempts}</div>
                {focus.condition && <div className="md:col-span-2">Runs only if {focus.condition.step === "$brief" ? "brief" : focus.condition.step}.{focus.condition.path} is {focus.condition.op}{focus.condition.value !== undefined ? ` ${String(focus.condition.value)}` : ""}</div>}
                {focus.revisionNotes && <div className="md:col-span-2 text-violet">Revision notes: {focus.revisionNotes}</div>}
              </div>
              {focus.handler === "human_select" && focus.status === "awaiting_input" ? (
                canApprove ? <Selection stepId={focus.id} candidates={candidates} max={max} /> : <Empty title="Waiting for the creative director's selection" />
              ) : focus.handler === "human_review" && focus.status === "awaiting_approval" ? (
                <div>
                  <p className="mb-3 text-sm text-mist-300">{String(focus.config.what ?? "Review the deliverables.")}</p>
                  {(() => {
                    const reviewed = steps.find((s) => s.key === focus.config.reviewsStep);
                    const items = v.assets.filter((a) => a.stepId === reviewed?.id && !["draft"].includes(a.status));
                    return items.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{items.map((a) => <GenTile key={a.id} a={a} />)}</div> : reviewed?.output ? <StructuredView value={reviewed.output} /> : null;
                  })()}
                  {canApprove && (
                    <div className="mt-4 flex gap-2">
                      <Action endpoint={`/api/steps/${focus.id}/approve`} variant="ok">Approve & continue</Action>
                      <Action endpoint={`/api/steps/${focus.id}/changes`} variant="danger" prompt="What needs to change? The reviewed step re-runs with your notes.">Request changes</Action>
                    </div>
                  )}
                </div>
              ) : focus.output ? (
                <div>
                  {"_progress" in focus.output && focus.status === "running" && <div className="mb-3 text-xs text-calm-300">{String(focus.output._progress)}</div>}
                  <StructuredView value={focus.output} />
                  {can(viewer.role, "production:create") && !focus.handler.startsWith("human_") && ["completed", "awaiting_approval"].includes(focus.status) && STEP_TYPES[String(focus.config.type)]?.schemaKey && (
                    <div className="mt-4"><OutputEditor stepId={focus.id} output={focus.output} /></div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-mist-400">{focus.status === "pending" ? "Waiting for upstream steps." : focus.status === "running" || focus.status === "queued" ? "Working…" : "No output."}</p>
              )}
              {focusAssets.length > 0 && (
                <div className="mt-6">
                  <div className="label mb-2">Deliverables from this step</div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-6">{focusAssets.map((a) => <GenTile key={a.id} a={a} />)}</div>
                </div>
              )}
              {focusRuns.length > 0 && (
                <div className="mt-6">
                  <div className="label mb-2">Agent runs</div>
                  {focusRuns.map((r) => (
                    <details key={r.id} className="border-b border-white/[0.05] py-2 text-sm last:border-0">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                        <span className="text-mist-100">{AGENT_BY_KEY[r.agentKey]?.name ?? r.agentKey}</span>
                        <Status value={r.status === "succeeded" ? "completed" : r.status} />
                        <span className="text-xs text-mist-500">{r.provider ?? "—"} / {r.model ?? "—"} · {usd(r.costCents)} · {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"} · prompt {r.promptVersion} · {timeAgo(r.startedAt)}</span>
                      </summary>
                      <div className="mt-2 grid gap-3 text-xs md:grid-cols-2">
                        <div><div className="label mb-1">References used</div><div className="text-mist-300">{r.referencesUsed.assetVersionIds.length} reference versions · {r.referencesUsed.characterVersionIds.length} character versions · {r.referencesUsed.canonRecordIds.length} canon records · {r.referencesUsed.decisionIds.length} decisions</div></div>
                        {r.error && <div className="text-bad">{r.error}</div>}
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-ink-950 p-2 text-[11px] text-mist-400 md:col-span-2">{String((r.inputs as Record<string, unknown>).prompt ?? "").slice(0, 4000)}</pre>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </Card>
          )}

          <nav className="flex gap-1 border-b border-white/[0.06]">
            {[...(v.social.length ? ["workspace"] : []), "deliverables", "runs"].map((t) => (
              <Link key={t} href={`/productions/${id}?tab=${t}${focus ? `&step=${focus.key}` : ""}`} className={`-mb-px border-b-2 px-3 py-2 text-[12px] uppercase tracking-[0.1em] ${tab === t ? "border-calm-300 text-white" : "border-transparent text-mist-400"}`}>{t === "workspace" ? "Video workspace" : t}</Link>
            ))}
          </nav>

          {tab === "workspace" && v.social.map((s) => {
            const script = s.video.script as Out<"scripts">["scripts"][number] | null;
            const captions = s.video.captions as Out<"captions">["packs"][number] | null;
            return (
              <Card key={s.video.id}>
                <SectionTitle title={s.video.title} sub={`${s.video.platform} · ${s.video.durationSeconds}s · storyboard v${s.board?.version ?? "–"} · status ${s.video.status}`} />
                <div className="grid gap-6 2xl:grid-cols-[1fr_340px]">
                  <div>
                    <div className="label mb-2">Shot list & storyboard</div>
                    <div className="space-y-2">{s.shots.map((sh) => <ShotRow key={sh.id} shot={sh} canEdit={can(viewer.role, "production:create")} canApprove={canApprove} />)}</div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="label mb-2">Final draft</div>
                      {s.final?.url ? (
                        <div>
                          <video src={s.final.url} controls className="w-full rounded-xl bg-black" />
                          <div className="mt-2 flex flex-wrap items-center gap-2"><Status value={s.final.status} /><Link href={`/assets/${s.final.id}`} className="link text-xs">Review v{s.final.version} →</Link>{s.final.provenance.parameters.mode === "animatic" && <Badge tone="warn">ANIMATIC – not generated video</Badge>}</div>
                        </div>
                      ) : <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-mist-500">Assembled after frames/clips are ready.</div>}
                    </div>
                    {script && (
                      <div>
                        <div className="label mb-2">Script</div>
                        <div className="space-y-1.5 rounded-xl bg-paper-100 p-4 text-[13px] leading-relaxed text-ink-900">
                          <div className="font-display text-base">{script.title}</div>
                          <div className="italic">Hook: {script.hook}</div>
                          {script.beats.map((b, i) => <div key={i}><span className="font-mono text-[11px] text-ink-600">{b.atSeconds}s</span> {b.action}{b.dialogue && <> — <b>{b.speaker ?? ""}</b>: “{b.dialogue}”</>}</div>)}
                          <div className="text-ink-600">End card: {script.endCard}</div>
                        </div>
                      </div>
                    )}
                    {captions && (
                      <div className="space-y-1 text-sm">
                        <div className="label mb-1">Caption & metadata</div>
                        <p className="text-mist-100">{captions.caption}</p>
                        <p className="text-calm-300">{captions.hashtags.join(" ")}</p>
                        <KeyVal k="Thumbnail text" v={captions.thumbnailText} />
                        <div className="text-xs text-mist-400">Alternate hooks: {captions.alternateHooks.join(" · ")}</div>
                      </div>
                    )}
                    {s.finals.length > 1 && <div className="text-xs text-mist-400">Generation history: {s.finals.map((f) => <Link key={f.id} href={`/assets/${f.id}`} className="link mr-2">v{f.version} ({f.status})</Link>)}</div>}
                  </div>
                </div>
              </Card>
            );
          })}

          {tab === "deliverables" && (
            v.assets.length ? (
              Object.entries(v.assets.reduce<Record<string, typeof v.assets>>((acc, a) => ({ ...acc, [a.role]: [...(acc[a.role] ?? []), a] }), {})).map(([role, list]) => (
                <div key={role}>
                  <div className="label mb-2">{titleCase(role)} ({list.length})</div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-6">{list.map((a) => <GenTile key={a.id} a={a} />)}</div>
                </div>
              ))
            ) : <Empty title="No deliverables yet" />
          )}

          {tab === "runs" && (
            <Card>
              <SectionTitle title="Agent run history" sub="Every agent task with inputs, references, output, cost, duration and errors" />
              {v.runs.map((r) => (
                <div key={r.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/[0.05] py-2 text-sm last:border-0">
                  <div>
                    <div className="text-mist-100">{AGENT_BY_KEY[r.agentKey]?.name ?? r.agentKey} <span className="text-mist-500">· {r.task}</span></div>
                    <div className="text-xs text-mist-500">{r.provider ?? "local"} / {r.model ?? "—"} · {usd(r.costCents)} · {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"} · {timeAgo(r.startedAt)}</div>
                    {r.error && <div className="text-xs text-bad">{r.error}</div>}
                  </div>
                  <Status value={r.status === "succeeded" ? "completed" : r.status} />
                </div>
              ))}
              {!v.runs.length && <p className="text-sm text-mist-400">No runs yet.</p>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

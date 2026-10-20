import Link from "next/link";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listApprovals } from "@/lib/review/approvals";
import { listGeneratedAssets } from "@/lib/review/assets";
import { Action } from "@/components/client/action";
import { LiveRefresh } from "@/components/client/live";
import { GenTile } from "@/components/media";
import { Badge, Card, Empty, PageHeader, SectionTitle, Status } from "@/components/ui";
import { timeAgo } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

const KIND_LABEL: Record<string, string> = { plan: "Execution plan", step: "Production gate", character_change: "Character change", canon_change: "Canon change", spend: "Budget", outreach: "Partner outreach", publish: "Publishing", asset: "Asset", mission: "Agent team question" };

export default async function Approvals() {
  const viewer = await requireViewer();
  const db = await getDb();
  const [pending, queue, decided] = await Promise.all([
    listApprovals(viewer.orgId),
    listGeneratedAssets(viewer.orgId, { status: "ready_for_review", latestOnly: true, limit: 60 }),
    db.select().from(schema.approvals).where(and(eq(schema.approvals.orgId, viewer.orgId), ne(schema.approvals.status, "pending"))).orderBy(desc(schema.approvals.decidedAt)).limit(20),
  ]);
  const steps = pending.filter((a) => a.targetType === "production_step").map((a) => a.targetId);
  const stepRows = steps.length ? await db.select({ id: schema.productionSteps.id, key: schema.productionSteps.key, productionId: schema.productionSteps.productionId, handler: schema.productionSteps.handler }).from(schema.productionSteps).where(inArray(schema.productionSteps.id, steps)) : [];
  const canApprove = can(viewer.role, "review:approve");
  const canCanon = can(viewer.role, "canon:approve");
  return (
    <div>
      <LiveRefresh scope="org" />
      <PageHeader eyebrow="15 · Approvals" title="Creative review" sub="Humans retain creative ownership, canon authority and every final approval. Statuses: draft · in production · ready for review · changes requested · approved · rejected · published/exported." />
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <SectionTitle title={`Decisions waiting (${pending.length})`} />
          {pending.length === 0 ? <Empty title="Nothing waiting on you" /> : (
            <div className="space-y-3">
              {pending.map((a) => {
                const st = stepRows.find((s) => s.id === a.targetId);
                const prodId = (a.payload as Record<string, string>).productionId ?? (a.targetType === "production" ? a.targetId : st?.productionId);
                return (
                  <div key={a.id} className="rounded-xl border border-white/[0.06] bg-ink-900/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={a.kind === "spend" ? "bad" : a.kind.includes("canon") || a.kind.includes("character") ? "violet" : "warn"}>{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                      <span className="text-sm text-white">{a.title}</span>
                      <span className="ml-auto text-xs text-mist-500">{timeAgo(a.createdAt)}</span>
                    </div>
                    {a.summary && <p className="mt-1 text-sm text-mist-300">{a.summary}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {a.kind === "plan" && <><Link href={`/productions/${a.targetId}`} className="link text-sm">Review plan →</Link>{can(viewer.role, "production:run") && <Action endpoint={`/api/productions/${a.targetId}/start`} variant="ok" size="sm">Approve plan & start</Action>}</>}
                      {a.kind === "step" && <Link href={`/productions/${prodId}?step=${st?.key ?? ""}`} className="link text-sm">{(a.payload as Record<string, unknown>).selection ? "Make selection →" : "Review →"}</Link>}
                      {a.kind === "step" && canApprove && st && st.handler !== "human_select" && <><Action endpoint={`/api/steps/${a.targetId}/approve`} variant="ok" size="sm">Approve</Action><Action endpoint={`/api/steps/${a.targetId}/changes`} variant="danger" size="sm" prompt="What needs to change?">Request changes</Action></>}
                      {a.kind === "character_change" && <><Link href={`/characters/${(a.payload as Record<string, string>).characterId}?tab=version%20history`} className="link text-sm">Compare →</Link>{canCanon && <><Action endpoint={`/api/character-versions/${a.targetId}/approve`} variant="ok" size="sm">Approve change</Action><Action endpoint={`/api/character-versions/${a.targetId}/reject`} variant="danger" size="sm" prompt="Why?" promptField="note">Reject</Action></>}</>}
                      {a.kind === "canon_change" && <><Link href={`/canon?record=${a.targetId}#${a.targetId}`} className="link text-sm">Compare with canon →</Link>{canCanon && <><Action endpoint={`/api/canon/${a.targetId}/approve`} variant="ok" size="sm">Approve as canon</Action><Action endpoint={`/api/canon/${a.targetId}/reject`} variant="danger" size="sm" prompt="Why?" promptField="note">Reject</Action></>}</>}
                      {a.kind === "spend" && can(viewer.role, "budget:approve") && <><Link href={`/productions/${prodId}`} className="link text-sm">Production →</Link><Action endpoint={`/api/productions/${prodId}/budget`} variant="ok" size="sm" prompt="New production budget in USD:">Raise budget</Action></>}
                      {a.kind === "mission" && <><Link href={`/missions/${(a.payload as Record<string, string>).missionId}`} className="link text-sm">Open mission →</Link>{canApprove && <><Action endpoint="/api/approvals" body={{ action: "decide", id: a.id, approve: true }} variant="ok" size="sm" prompt="Optional note for the agent:" promptField="note">Approve</Action><Action endpoint="/api/approvals" body={{ action: "decide", id: a.id, approve: false }} variant="danger" size="sm" prompt="Why? The agent will read this." promptField="note">Decline</Action></>}</>}
                      {(a.kind === "outreach" || a.kind === "publish") && can(viewer.role, a.kind === "outreach" ? "outreach:approve" : "publish:approve") && <><Action endpoint="/api/approvals" body={{ action: "decide", id: a.id, approve: true }} variant="ok" size="sm" confirm="Record permission? The system will not contact anyone – your team does.">Approve</Action><Action endpoint="/api/approvals" body={{ action: "decide", id: a.id, approve: false }} variant="danger" size="sm">Decline</Action></>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <SectionTitle title={`Ready for review (${queue.length})`} sub="Latest versions waiting for a decision" />
            {queue.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{queue.map((g) => <GenTile key={g.id} a={g} />)}</div> : <p className="text-sm text-mist-400">Nothing waiting.</p>}
          </Card>
          <Card>
            <SectionTitle title="Recently decided" />
            {decided.map((d) => <div key={d.id} className="flex items-center gap-2 border-b border-white/[0.04] py-1.5 text-sm last:border-0"><Status value={d.status} /><span className="flex-1 truncate text-mist-200">{d.title}</span><span className="text-xs text-mist-500">{timeAgo(d.decidedAt)}</span></div>)}
            {!decided.length && <p className="text-sm text-mist-400">No decisions yet.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

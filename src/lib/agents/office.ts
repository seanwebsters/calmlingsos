import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { AGENTS } from "./definitions";

export type OfficeStatus = "idle" | "working" | "queued" | "waiting" | "blocked";

/** Live state of every agent for the 3D office. */
export async function officeState(orgId: string) {
  const db = await getDb();
  const since = new Date(Date.now() - 6 * 3600_000);
  const tasks = await db.select().from(schema.missionTasks).where(and(eq(schema.missionTasks.orgId, orgId), gte(schema.missionTasks.updatedAt, since))).orderBy(desc(schema.missionTasks.updatedAt)).limit(300);
  const missionIds = [...new Set(tasks.map((t) => t.missionId))];
  const missions = missionIds.length ? await db.select().from(schema.missions).where(inArray(schema.missions.id, missionIds)) : [];
  const steps = await db
    .select({ s: schema.productionSteps, p: schema.productions })
    .from(schema.productionSteps)
    .innerJoin(schema.productions, eq(schema.productions.id, schema.productionSteps.productionId))
    .where(and(eq(schema.productions.orgId, orgId), inArray(schema.productionSteps.status, ["running", "queued", "blocked"])))
    .limit(100);
  const rank: Record<string, number> = { running: 4, queued: 3, waiting_team: 2, waiting_approval: 2, blocked: 1 };
  const agents = AGENTS.map((a) => {
    const mine = tasks.filter((t) => t.agentKey === a.key && rank[t.status]);
    mine.sort((x, y) => rank[y.status] - rank[x.status]);
    const t = mine[0];
    const step = steps.find((s) => s.s.agentKey === a.key);
    let status: OfficeStatus = "idle";
    let activity: string | null = null;
    let title: string | null = null;
    let href: string | null = null;
    if (t) {
      status = t.status === "running" ? "working" : t.status === "queued" ? "queued" : t.status === "blocked" ? "blocked" : "waiting";
      activity = [...t.transcript].reverse().find((e) => e.kind !== "result")?.text ?? null;
      if (t.status === "waiting_approval") activity = "Waiting for your decision";
      title = t.title;
      href = `/missions/${t.missionId}`;
    } else if (step) {
      status = step.s.status === "running" ? "working" : step.s.status === "queued" ? "queued" : "blocked";
      activity = step.s.status === "blocked" ? step.s.error : `${step.s.name} · ${step.p.title}`;
      title = step.s.name;
      href = `/productions/${step.p.id}`;
    }
    return { key: a.key, name: a.name, role: a.role, department: a.department, status, activity, title, href };
  });
  const handoffs = tasks.flatMap((t) =>
    t.transcript
      .filter((e) => e.kind === "handoff" && Date.now() - new Date(e.at).getTime() < 45_000)
      .map((e) => ({ id: `${t.id}:${e.at}`, from: t.agentKey, to: (e.data as { to?: string })?.to ?? "", at: e.at, text: e.text })),
  );
  const active = missions.filter((m) => !["completed", "cancelled", "failed"].includes(m.status)).map((m) => ({ id: m.id, goal: m.goal, status: m.status, spentCents: m.spentCents, budgetCents: m.budgetCents }));
  return { agents, handoffs, missions: active, at: new Date().toISOString() };
}

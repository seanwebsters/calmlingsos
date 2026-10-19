import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { listCharacters } from "./brain/characters";
import { urlFor } from "./storage";
import { jobCounts } from "./jobs/queue";
import { getOrgSettings } from "./org";
import { providerStatuses } from "./providers/gateway";

export async function missionControl(orgId: string) {
  const db = await getDb();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [active, approvals, approved, runs, calendar, failedSteps, monthCost, costByProvider, characters, jobs, settings, providers, refCount] = await Promise.all([
    db.select().from(schema.productions).where(and(eq(schema.productions.orgId, orgId), inArray(schema.productions.status, ["planning", "running", "awaiting_input", "blocked", "paused", "failed"]))).orderBy(desc(schema.productions.updatedAt)).limit(12),
    db.select().from(schema.approvals).where(and(eq(schema.approvals.orgId, orgId), eq(schema.approvals.status, "pending"))).orderBy(desc(schema.approvals.createdAt)).limit(8),
    db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.orgId, orgId), inArray(schema.generatedAssets.status, ["approved", "published"]), inArray(schema.generatedAssets.kind, ["image", "video"]))).orderBy(desc(schema.generatedAssets.updatedAt)).limit(8),
    db.select().from(schema.agentRuns).where(eq(schema.agentRuns.orgId, orgId)).orderBy(desc(schema.agentRuns.startedAt)).limit(10),
    db.select().from(schema.calendarItems).where(and(eq(schema.calendarItems.orgId, orgId), gte(schema.calendarItems.date, new Date(Date.now() - 86400_000)))).orderBy(schema.calendarItems.date).limit(8),
    db
      .select({ s: schema.productionSteps, p: schema.productions })
      .from(schema.productionSteps)
      .innerJoin(schema.productions, eq(schema.productions.id, schema.productionSteps.productionId))
      .where(and(eq(schema.productions.orgId, orgId), inArray(schema.productionSteps.status, ["failed", "blocked"]), inArray(schema.productions.status, ["failed", "blocked", "running", "awaiting_input"])))
      .orderBy(desc(schema.productionSteps.updatedAt))
      .limit(8),
    db.select({ n: sql<number>`coalesce(sum(${schema.costRecords.costCents}),0)::float` }).from(schema.costRecords).where(and(eq(schema.costRecords.orgId, orgId), gte(schema.costRecords.createdAt, monthStart))),
    db.select({ provider: schema.costRecords.provider, n: sql<number>`coalesce(sum(${schema.costRecords.costCents}),0)::float`, calls: sql<number>`count(*)::int` }).from(schema.costRecords).where(and(eq(schema.costRecords.orgId, orgId), gte(schema.costRecords.createdAt, monthStart))).groupBy(schema.costRecords.provider),
    listCharacters(orgId),
    jobCounts(orgId),
    getOrgSettings(orgId),
    providerStatuses(orgId),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.referenceAssets).where(eq(schema.referenceAssets.orgId, orgId)),
  ]);
  const heroIds = characters.map((c) => c.heroAssetId).filter((x): x is string => Boolean(x));
  const heroes = heroIds.length ? await db.select({ a: schema.referenceAssets, v: schema.assetVersions }).from(schema.referenceAssets).innerJoin(schema.assetVersions, eq(schema.assetVersions.id, schema.referenceAssets.currentVersionId)).where(inArray(schema.referenceAssets.id, heroIds)) : [];
  return {
    active,
    approvals,
    approved: await Promise.all(approved.map(async (a) => ({ ...a, thumbUrl: await urlFor(a.thumbnailKey ?? (a.kind === "image" ? a.storageKey : null)) }))),
    runs,
    calendar,
    failedSteps,
    monthCostCents: Number(monthCost[0]?.n ?? 0),
    costByProvider,
    monthlyBudgetCents: settings.monthlyBudgetCents,
    characters: await Promise.all(characters.map(async (c) => ({ ...c, heroUrl: await urlFor(heroes.find((h) => h.a.id === c.heroAssetId)?.v.thumbnailKey ?? null) }))),
    jobs,
    providers: providers.map((p) => ({ key: p.key, name: p.name, connected: p.connected, status: p.status })),
    referenceCount: refCount[0]?.n ?? 0,
  };
}

/** Honest, data-driven suggestions (no invented metrics). */
export function suggestions(d: Awaited<ReturnType<typeof missionControl>>): { title: string; href: string; why: string }[] {
  const out: { title: string; href: string; why: string }[] = [];
  if (!d.providers.some((p) => p.connected)) out.push({ title: "Connect your first AI provider", href: "/settings", why: "Agents can't plan or generate until a text provider is connected." });
  if (!d.referenceCount) out.push({ title: "Upload official character references", href: "/references", why: "Uploaded references are the source of truth for every visual generation." });
  for (const c of d.characters.filter((x) => x.readiness.score < 1).slice(0, 3)) {
    const miss = c.readiness.checks.filter((k) => !k.ok).map((k) => k.label.toLowerCase());
    out.push({ title: `Complete ${c.name}'s canon`, href: `/characters/${c.id}`, why: `Missing: ${miss.slice(0, 3).join(", ")}.` });
  }
  if (d.approvals.length) out.push({ title: `${d.approvals.length} decisions waiting on you`, href: "/approvals", why: "Productions pause at human gates until you decide." });
  return out.slice(0, 5);
}

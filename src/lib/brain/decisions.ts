import "server-only";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { assertCan, type Viewer } from "@/lib/auth/session";
import { indexSource } from "./embeddings";

export const decisionInput = z.object({
  kind: z.enum(["selection", "rejection", "correction", "preference", "rule", "pattern", "consistency_issue"]),
  summary: z.string().min(1).max(500),
  detail: z.string().max(4000).default(""),
  department: z.string().max(40).nullable().optional(),
  characterIds: z.array(z.string()).default([]),
  tags: z.array(z.string().max(60)).default([]),
  isRule: z.boolean().default(false),
  sourceType: z.string().max(60).nullable().optional(),
  sourceId: z.string().max(80).nullable().optional(),
});

/** Record structured creative feedback. Rules are injected into every relevant future task. */
export async function recordDecision(orgId: string, actorUserId: string | null, raw: unknown) {
  const input = decisionInput.parse(raw);
  const id = newId("dec");
  const db = await getDb();
  await db.insert(schema.creativeDecisions).values({ id, orgId, ...input, department: input.department ?? null, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, createdBy: actorUserId });
  await indexSource(orgId, "decision", id).catch(() => null);
  return id;
}

export async function createDecision(viewer: Viewer, raw: unknown) {
  assertCan(viewer, "review:comment");
  const parsed = decisionInput.parse(raw);
  if (parsed.isRule) assertCan(viewer, "canon:approve");
  const id = await recordDecision(viewer.orgId, viewer.userId, parsed);
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "decision.recorded", targetType: "decision", targetId: id, data: { kind: parsed.kind, isRule: parsed.isRule } });
  return id;
}

export async function setDecisionActive(viewer: Viewer, id: string, active: boolean) {
  assertCan(viewer, "canon:approve");
  const db = await getDb();
  await db.update(schema.creativeDecisions).set({ active }).where(and(eq(schema.creativeDecisions.orgId, viewer.orgId), eq(schema.creativeDecisions.id, id)));
  await indexSource(viewer.orgId, "decision", id).catch(() => null);
}

export async function listDecisions(orgId: string, q?: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.creativeDecisions)
    .where(and(eq(schema.creativeDecisions.orgId, orgId), q ? or(ilike(schema.creativeDecisions.summary, `%${q}%`), ilike(schema.creativeDecisions.detail, `%${q}%`)) : undefined))
    .orderBy(desc(schema.creativeDecisions.createdAt))
    .limit(500);
}

/**
 * Repeated corrections become visible patterns: the same character and kind
 * recurring ≥3 times is surfaced as a suggested rule for a human to adopt.
 */
export async function suggestedRules(orgId: string) {
  const all = (await listDecisions(orgId)).filter((d) => d.active && !d.isRule && (d.kind === "rejection" || d.kind === "correction" || d.kind === "consistency_issue"));
  const groups = new Map<string, typeof all>();
  for (const d of all) {
    for (const tag of d.tags.length ? d.tags : ["general"]) {
      const key = `${d.characterIds.sort().join(",")}|${tag}`;
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
  }
  return [...groups.entries()].filter(([, ds]) => ds.length >= 3).map(([key, ds]) => ({ key, count: ds.length, examples: ds.slice(0, 5), characterIds: ds[0].characterIds, tag: key.split("|")[1] }));
}

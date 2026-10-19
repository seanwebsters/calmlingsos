import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assertCan, type Viewer } from "@/lib/auth/session";
import { createApproval, closeApprovals } from "@/lib/review/approvals";
import { indexSource } from "./embeddings";

export const CANON_DOMAINS = {
  world: { label: "World", kinds: ["environment", "location", "prop", "world_rule", "palette", "lighting", "mood", "material", "environmental_storytelling"] },
  lore: { label: "Lore", kinds: ["lore", "lore_event", "relationship", "story_arc"] },
  brand: { label: "Brand", kinds: ["mission", "values", "audience", "humour", "tone_of_voice", "visual_language", "brand_guideline", "typography", "logo_usage", "messaging", "brand_safety", "commercial_guideline"] },
  production: { label: "Production", kinds: ["social_format", "animation_reference", "game_spec", "export_format", "naming_convention", "technical_constraint", "creative_template"] },
} as const;
export type CanonDomain = keyof typeof CANON_DOMAINS;

export const canonInput = z.object({
  domain: z.enum(["world", "lore", "brand", "production"]),
  kind: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  body: z.string().max(40000).default(""),
  data: z.record(z.string(), z.unknown()).default({}),
  characterIds: z.array(z.string()).default([]),
  timelineOrder: z.number().int().nullable().optional(),
  canonStatus: z.enum(["draft", "experimental"]).default("draft"),
});

export async function listCanon(orgId: string, filter: { domain?: string; includeSuperseded?: boolean } = {}) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.canonRecords)
    .where(and(eq(schema.canonRecords.orgId, orgId), filter.domain ? eq(schema.canonRecords.domain, filter.domain) : undefined))
    .orderBy(asc(schema.canonRecords.domain), asc(schema.canonRecords.timelineOrder), desc(schema.canonRecords.createdAt));
  return filter.includeSuperseded ? rows : rows.filter((r) => !r.superseded);
}

export async function getCanonRecord(orgId: string, id: string) {
  const db = await getDb();
  const [r] = await db.select().from(schema.canonRecords).where(and(eq(schema.canonRecords.orgId, orgId), eq(schema.canonRecords.id, id)));
  if (!r) throw notFound("Canon record not found.");
  const history = await db.select().from(schema.canonRecords).where(eq(schema.canonRecords.lineageId, r.lineageId)).orderBy(desc(schema.canonRecords.version));
  return { record: r, history, official: history.find((h) => h.canonStatus === "official" && !h.superseded) ?? null };
}

/** Create a new record. Humans create DRAFT canon; agents create AI proposals. Nothing starts official. */
export async function createCanon(viewer: Viewer | { orgId: string; userId: null; agentKey: string }, raw: unknown) {
  const isAgent = "agentKey" in viewer;
  if (!isAgent) assertCan(viewer, "canon:edit");
  const input = canonInput.parse(raw);
  const id = newId("cnr");
  const db = await getDb();
  await db.insert(schema.canonRecords).values({
    id,
    orgId: viewer.orgId,
    lineageId: id,
    version: 1,
    domain: input.domain,
    kind: input.kind,
    title: input.title,
    body: input.body,
    data: input.data,
    characterIds: input.characterIds,
    timelineOrder: input.timelineOrder ?? null,
    canonStatus: isAgent ? "ai_proposal" : input.canonStatus,
    createdBy: isAgent ? null : viewer.userId,
  });
  await audit({ orgId: viewer.orgId, actorUserId: isAgent ? null : viewer.userId, actorAgent: isAgent ? viewer.agentKey : null, action: "canon.created", targetType: "canon_record", targetId: id, data: { domain: input.domain, kind: input.kind, title: input.title } });
  if (isAgent) await createApproval({ orgId: viewer.orgId, kind: "canon_change", targetType: "canon_record", targetId: id, title: `AI-proposed ${input.domain}: ${input.title}`, summary: input.body.slice(0, 300), requestedBy: viewer.agentKey });
  return id;
}

/** Propose a revision. The previous version stays in force until the revision is approved. */
export async function reviseCanon(viewer: Viewer, id: string, raw: unknown) {
  assertCan(viewer, "canon:edit");
  const { record, history } = await getCanonRecord(viewer.orgId, id);
  const input = canonInput.partial().parse(raw);
  const newRecordId = newId("cnr");
  const db = await getDb();
  await db.insert(schema.canonRecords).values({
    id: newRecordId,
    orgId: viewer.orgId,
    lineageId: record.lineageId,
    previousId: record.id,
    version: (history[0]?.version ?? record.version) + 1,
    domain: input.domain ?? record.domain,
    kind: input.kind ?? record.kind,
    title: input.title ?? record.title,
    body: input.body ?? record.body,
    data: input.data ?? record.data,
    characterIds: input.characterIds ?? record.characterIds,
    timelineOrder: input.timelineOrder === undefined ? record.timelineOrder : input.timelineOrder,
    canonStatus: "draft",
    createdBy: viewer.userId,
  });
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "canon.revised", targetType: "canon_record", targetId: newRecordId, data: { previousId: record.id } });
  return newRecordId;
}

export async function submitCanonForApproval(viewer: Viewer, id: string) {
  assertCan(viewer, "canon:edit");
  const { record } = await getCanonRecord(viewer.orgId, id);
  if (record.canonStatus === "official") throw new AppError("Already official.");
  await createApproval({ orgId: viewer.orgId, kind: "canon_change", targetType: "canon_record", targetId: id, title: `${record.domain}: ${record.title} (v${record.version})`, summary: record.body.slice(0, 300), requestedBy: viewer.userId });
}

/** Only an authorised human can make lore/world/brand canon official. */
export async function approveCanon(viewer: Viewer, id: string, note = "") {
  assertCan(viewer, "canon:approve");
  const { record, history } = await getCanonRecord(viewer.orgId, id);
  if (record.canonStatus === "rejected") throw new AppError("A rejected record can't be approved – revise it instead.");
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const h of history) {
      if (h.id !== id && h.canonStatus === "official") await tx.update(schema.canonRecords).set({ superseded: true }).where(eq(schema.canonRecords.id, h.id));
    }
    // Older drafts in the lineage are superseded by this approval too.
    for (const h of history) {
      if (h.id !== id && h.version < record.version && h.canonStatus !== "official") await tx.update(schema.canonRecords).set({ superseded: true }).where(eq(schema.canonRecords.id, h.id));
    }
    await tx.update(schema.canonRecords).set({ canonStatus: "official", superseded: false, approvedBy: viewer.userId, approvedAt: new Date() }).where(eq(schema.canonRecords.id, id));
    await closeApprovals(viewer.orgId, "canon_record", id, "approved", viewer.userId, note, tx);
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "canon.approved", targetType: "canon_record", targetId: id, data: { lineageId: record.lineageId, version: record.version, note } }, tx);
  });
  await indexSource(viewer.orgId, "canon_record", id).catch(() => null);
}

export async function rejectCanon(viewer: Viewer, id: string, note = "") {
  assertCan(viewer, "canon:approve");
  const { record } = await getCanonRecord(viewer.orgId, id);
  if (record.canonStatus === "official") throw new AppError("Official canon can't be rejected; approve a revision to supersede it, or archive it.");
  const db = await getDb();
  await db.update(schema.canonRecords).set({ canonStatus: "rejected" }).where(eq(schema.canonRecords.id, id));
  await closeApprovals(viewer.orgId, "canon_record", id, "rejected", viewer.userId, note);
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "canon.rejected", targetType: "canon_record", targetId: id, data: { note } });
}

export async function archiveCanon(viewer: Viewer, id: string) {
  assertCan(viewer, "canon:approve");
  await getCanonRecord(viewer.orgId, id);
  const db = await getDb();
  await db.update(schema.canonRecords).set({ canonStatus: "archived" }).where(eq(schema.canonRecords.id, id));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "canon.archived", targetType: "canon_record", targetId: id });
}

/** Line-level comparison of a proposal against the official version of the same lineage. */
export function diffLines(a: string, b: string): { type: "same" | "added" | "removed"; text: string }[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const m = x.length;
  const n = y.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { type: "same" | "added" | "removed"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (x[i] === y[j]) {
      out.push({ type: "same", text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "removed", text: x[i++] });
    else out.push({ type: "added", text: y[j++] });
  }
  while (i < m) out.push({ type: "removed", text: x[i++] });
  while (j < n) out.push({ type: "added", text: y[j++] });
  return out;
}

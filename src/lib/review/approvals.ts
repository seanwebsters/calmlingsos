import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import { newId } from "@/lib/ids";

export interface ApprovalInput {
  orgId: string;
  kind: "plan" | "mission" | "step" | "asset" | "character_change" | "canon_change" | "spend" | "outreach" | "publish";
  targetType: string;
  targetId: string;
  title: string;
  summary?: string;
  payload?: Record<string, unknown>;
  requestedBy?: string | null;
}

/** Open a pending human decision. Idempotent per (target, kind) while pending. */
export async function createApproval(input: ApprovalInput, tx?: Tx): Promise<string> {
  const db = tx ?? (await getDb());
  const [existing] = await db
    .select({ id: schema.approvals.id })
    .from(schema.approvals)
    .where(and(eq(schema.approvals.orgId, input.orgId), eq(schema.approvals.targetType, input.targetType), eq(schema.approvals.targetId, input.targetId), eq(schema.approvals.kind, input.kind), eq(schema.approvals.status, "pending")));
  if (existing) return existing.id;
  const id = newId("apr");
  await db.insert(schema.approvals).values({ id, orgId: input.orgId, kind: input.kind, targetType: input.targetType, targetId: input.targetId, title: input.title, summary: input.summary ?? "", payload: input.payload ?? {}, requestedBy: input.requestedBy ?? null });
  return id;
}

export async function closeApprovals(orgId: string, targetType: string, targetId: string, status: "approved" | "rejected" | "withdrawn", decidedBy: string | null, note?: string, tx?: Tx) {
  const db = tx ?? (await getDb());
  await db
    .update(schema.approvals)
    .set({ status, decidedBy, decidedAt: new Date(), decisionNote: note ?? null })
    .where(and(eq(schema.approvals.orgId, orgId), eq(schema.approvals.targetType, targetType), eq(schema.approvals.targetId, targetId), eq(schema.approvals.status, "pending")));
}

export async function listApprovals(orgId: string, status = "pending") {
  const db = await getDb();
  return db.select().from(schema.approvals).where(and(eq(schema.approvals.orgId, orgId), eq(schema.approvals.status, status))).orderBy(desc(schema.approvals.createdAt)).limit(200);
}

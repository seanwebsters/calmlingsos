import "server-only";
import { getDb, schema, type Tx } from "@/db";
import { newId } from "./ids";

export interface AuditInput {
  orgId: string;
  actorUserId?: string | null;
  actorAgent?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  data?: Record<string, unknown>;
}

/** Append-only audit log. Every canon, approval, credential and export action lands here. */
export async function audit(input: AuditInput, tx?: Tx): Promise<void> {
  const db = tx ?? (await getDb());
  await db.insert(schema.auditEvents).values({
    id: newId("aud"),
    orgId: input.orgId,
    actorUserId: input.actorUserId ?? null,
    actorAgent: input.actorAgent ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    data: input.data ?? {},
  });
}

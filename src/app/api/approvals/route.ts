import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { body, route } from "@/lib/http";
import { createApproval, closeApprovals, listApprovals } from "@/lib/review/approvals";
import { notFound } from "@/lib/errors";
import { assertCan } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const GET = route(null, async ({ viewer }) => ({ approvals: await listApprovals(viewer.orgId) }));

/** Outreach and publishing are explicit human permissions. The system records them; it never contacts anyone itself. */
export const POST = route("review:comment", async ({ req, viewer }) => {
  const b = await body(req, z.object({ action: z.enum(["request_outreach", "decide"]), targetType: z.string().optional(), targetId: z.string().optional(), title: z.string().optional(), summary: z.string().optional(), id: z.string().optional(), approve: z.boolean().optional(), note: z.string().optional() }));
  if (b.action === "request_outreach") return { id: await createApproval({ orgId: viewer.orgId, kind: "outreach", targetType: b.targetType ?? "production", targetId: b.targetId ?? "", title: b.title ?? "Partner outreach", summary: b.summary ?? "", requestedBy: viewer.userId }) };
  const db = await getDb();
  const [a] = await db.select().from(schema.approvals).where(and(eq(schema.approvals.id, b.id ?? ""), eq(schema.approvals.orgId, viewer.orgId)));
  if (!a) throw notFound();
  assertCan(viewer, a.kind === "outreach" ? "outreach:approve" : a.kind === "publish" ? "publish:approve" : "review:approve");
  await closeApprovals(viewer.orgId, a.targetType, a.targetId, b.approve ? "approved" : "rejected", viewer.userId, b.note);
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: `approval.${b.approve ? "approved" : "rejected"}`, targetType: "approval", targetId: a.id, data: { kind: a.kind } });
});

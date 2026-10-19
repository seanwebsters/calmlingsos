import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { body, route } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { assertCan } from "@/lib/auth/session";

/** Edit a product concept as a NEW iteration (concepts evolve; history is kept). */
export const PATCH = route<{ id: string }>("production:create", async ({ req, viewer, params }) => {
  const b = await body(req, z.object({ name: z.string().max(200).optional(), description: z.string().max(4000).optional(), materials: z.string().max(2000).optional(), dimensions: z.string().max(200).optional(), packaging: z.string().max(4000).optional(), targetRetailCents: z.number().int().min(0).optional(), estUnitCostCents: z.number().int().min(0).optional(), moqAssumption: z.number().int().min(0).optional(), quoteVerified: z.boolean().optional(), status: z.enum(["draft", "ready_for_review", "changes_requested", "approved", "rejected"]).optional() }));
  if (b.status === "approved" || b.status === "rejected") assertCan(viewer, "review:approve");
  const db = await getDb();
  const [cur] = await db.select().from(schema.productConcepts).where(and(eq(schema.productConcepts.id, params.id), eq(schema.productConcepts.orgId, viewer.orgId)));
  if (!cur) throw notFound();
  if (b.status && Object.keys(b).length === 1) {
    await db.update(schema.productConcepts).set({ status: b.status, updatedAt: new Date() }).where(eq(schema.productConcepts.id, cur.id));
    return { id: cur.id };
  }
  const { id: _old, createdAt: _c, updatedAt: _u, ...rest } = cur;
  const id = newId("pdc");
  const unit = b.estUnitCostCents ?? cur.estUnitCostCents ?? 0;
  const retail = b.targetRetailCents ?? cur.targetRetailCents ?? 0;
  await db.insert(schema.productConcepts).values({ ...rest, ...b, id, iteration: cur.iteration + 1, status: b.status ?? "draft", marginScenarios: cur.marginScenarios.map((m) => ({ ...m, unitCostCents: unit, retailCents: retail, marginPct: m.wholesaleCents ? Math.round(((m.wholesaleCents - unit) / m.wholesaleCents) * 1000) / 10 : 0 })) });
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "product.iterated", targetType: "product_concept", targetId: id, data: { from: cur.id, quoteVerified: b.quoteVerified ?? false } });
  return { id };
});

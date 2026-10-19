import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { body, route } from "@/lib/http";
import { newId } from "@/lib/ids";

export const POST = route("production:create", async ({ req, viewer }) => {
  const b = await body(req, z.object({ title: z.string().min(1).max(200), kind: z.enum(["deadline", "publish", "milestone", "review"]), date: z.string(), platform: z.string().max(40).nullable().optional(), notes: z.string().max(2000).default(""), productionId: z.string().nullable().optional() }));
  const db = await getDb();
  const id = newId("cal");
  await db.insert(schema.calendarItems).values({ id, orgId: viewer.orgId, title: b.title, kind: b.kind, date: new Date(b.date), platform: b.platform ?? null, notes: b.notes, productionId: b.productionId ?? null });
  return { id };
});
export const PATCH = route("production:create", async ({ req, viewer }) => {
  const b = await body(req, z.object({ id: z.string(), status: z.enum(["scheduled", "proposed", "done", "cancelled"]).optional(), date: z.string().optional() }));
  const db = await getDb();
  await db.update(schema.calendarItems).set({ ...(b.status ? { status: b.status } : {}), ...(b.date ? { date: new Date(b.date) } : {}) }).where(and(eq(schema.calendarItems.id, b.id), eq(schema.calendarItems.orgId, viewer.orgId)));
});

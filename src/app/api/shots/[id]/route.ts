import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { body, route } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";

export const PATCH = route<{ id: string }>("production:create", async ({ req, viewer, params }) => {
  const b = await body(req, z.object({ description: z.string().max(4000).optional(), dialogue: z.string().max(2000).optional(), action: z.string().max(2000).optional(), camera: z.string().max(500).optional(), durationSeconds: z.number().min(1).max(15).optional(), locked: z.boolean().optional() }));
  const db = await getDb();
  const [row] = await db.select({ s: schema.shots }).from(schema.shots).innerJoin(schema.socialVideos, eq(schema.socialVideos.id, schema.shots.socialVideoId)).where(and(eq(schema.shots.id, params.id), eq(schema.socialVideos.orgId, viewer.orgId)));
  if (!row) throw notFound("Shot not found.");
  await db.update(schema.shots).set(b).where(eq(schema.shots.id, params.id));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: b.locked === undefined ? "shot.edited" : b.locked ? "shot.locked" : "shot.unlocked", targetType: "shot", targetId: params.id, data: b });
});

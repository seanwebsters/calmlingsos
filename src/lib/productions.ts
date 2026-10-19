import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { loadProduction } from "./workflows/engine";
import { listGeneratedAssets } from "./review/assets";
import { urlFor } from "./storage";

export async function productionView(orgId: string, id: string) {
  const { production, steps } = await loadProduction(orgId, id);
  const db = await getDb();
  const assets = await listGeneratedAssets(orgId, { productionId: id, limit: 1000 });
  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.productionId, id)).orderBy(desc(schema.agentRuns.startedAt)).limit(100);
  const videos = await db.select().from(schema.socialVideos).where(eq(schema.socialVideos.productionId, id)).orderBy(asc(schema.socialVideos.createdAt));
  const boards = videos.length ? await db.select().from(schema.storyboards).where(inArray(schema.storyboards.socialVideoId, videos.map((v) => v.id))).orderBy(desc(schema.storyboards.version)) : [];
  const latestBoards = videos.map((v) => boards.find((b) => b.socialVideoId === v.id)).filter((b): b is (typeof boards)[number] => Boolean(b));
  const shots = latestBoards.length ? await db.select().from(schema.shots).where(inArray(schema.shots.storyboardId, latestBoards.map((b) => b.id))).orderBy(asc(schema.shots.index)) : [];
  const best = (lineageId: string | null) => {
    if (!lineageId) return null;
    const vs = assets.filter((a) => a.lineageId === lineageId).sort((a, b) => b.version - a.version);
    return vs.find((a) => a.locked) ?? vs.find((a) => a.status === "approved" || a.status === "published") ?? vs.find((a) => a.status !== "rejected") ?? vs[0] ?? null;
  };
  const social = videos.map((v) => {
    const board = latestBoards.find((b) => b.socialVideoId === v.id);
    const vShots = shots.filter((s) => s.storyboardId === board?.id).map((s) => ({ ...s, frame: best(s.frameLineageId), video: best(s.videoLineageId), voice: best(s.voiceLineageId), frameVersions: assets.filter((a) => a.lineageId === s.frameLineageId).length }));
    const finals = assets.filter((a) => a.itemKey === `final:${v.id}`).sort((a, b) => b.version - a.version);
    const srt = assets.filter((a) => a.itemKey === `srt:${v.id}`).sort((a, b) => b.version - a.version)[0] ?? null;
    return { video: v, board, shots: vShots, final: finals[0] ?? null, finals, srt };
  });
  const characters = production.characterIds.length ? await db.select({ id: schema.characters.id, name: schema.characters.name, code: schema.characters.code }).from(schema.characters).where(inArray(schema.characters.id, production.characterIds)) : [];
  const approvals = await db.select().from(schema.approvals).where(eq(schema.approvals.orgId, orgId)).then((rows) => rows.filter((a) => a.status === "pending" && (a.targetId === id || (a.payload as Record<string, unknown>).productionId === id || steps.some((s) => s.id === a.targetId))));
  return { production, steps, assets, runs, social, characters, approvals };
}

export async function urlsFor(keys: (string | null | undefined)[]) {
  return Promise.all(keys.map((k) => urlFor(k)));
}

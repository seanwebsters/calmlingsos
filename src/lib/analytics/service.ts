import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assertCan, type Viewer } from "@/lib/auth/session";
import { mapRow, parseCsv } from "./csv";
import { confidenceFor } from "./stats";

export async function importAnalyticsCsv(viewer: Viewer, text: string, defaultPlatform: string) {
  assertCan(viewer, "analytics:import");
  const rows = parseCsv(text);
  if (!rows.length) throw new AppError("The CSV has no data rows.");
  const db = await getDb();
  const chars = await db.select().from(schema.characters).where(eq(schema.characters.orgId, viewer.orgId));
  const batch = newId("imp");
  let imported = 0;
  const skipped: string[] = [];
  for (const [i, raw] of rows.entries()) {
    const m = mapRow(raw);
    if (!m.postId) {
      skipped.push(`row ${i + 2}: no post id`);
      continue;
    }
    const platform = m.platform === "unknown" && defaultPlatform ? defaultPlatform : m.platform;
    const characterIds = m.characters.map((n) => chars.find((c) => c.name.toLowerCase() === n.toLowerCase() || c.code.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => Boolean(x));
    const values = { source: "csv", importBatch: batch, platform, postId: m.postId, postedAt: m.postedAt, title: m.title, characterIds, format: m.format, theme: m.theme, views: m.views, watchTimeSeconds: m.watchTimeSeconds, avgRetentionPct: m.avgRetentionPct, shares: m.shares, saves: m.saves, likes: m.likes, comments: m.comments, followerDelta: m.followerDelta, raw };
    await db
      .insert(schema.analyticsRecords)
      .values({ id: newId("ana"), orgId: viewer.orgId, ...values })
      .onConflictDoUpdate({ target: [schema.analyticsRecords.orgId, schema.analyticsRecords.platform, schema.analyticsRecords.postId], set: values });
    imported++;
  }
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "analytics.imported", targetType: "analytics_batch", targetId: batch, data: { imported, skipped: skipped.length } });
  return { batch, imported, skipped };
}

type Group = { key: string; posts: number; views: number | null; avgViews: number | null; shareRate: number | null; saveRate: number | null; avgRetention: number | null; confidence: string };

function groupBy(rows: (typeof schema.analyticsRecords.$inferSelect)[], keyOf: (r: (typeof rows)[number]) => string[]): Group[] {
  const map = new Map<string, typeof rows>();
  for (const r of rows) for (const k of keyOf(r)) map.set(k, [...(map.get(k) ?? []), r]);
  return [...map.entries()]
    .map(([key, rs]) => {
      const withViews = rs.filter((r) => r.views !== null);
      const views = withViews.length ? withViews.reduce((n, r) => n + (r.views ?? 0), 0) : null;
      const sharesRows = withViews.filter((r) => r.shares !== null);
      const savesRows = withViews.filter((r) => r.saves !== null);
      const ret = rs.filter((r) => r.avgRetentionPct !== null);
      const sv = (xs: typeof rs, f: (r: (typeof rs)[number]) => number) => (xs.length ? xs.reduce((n, r) => n + f(r), 0) : null);
      const shareViews = sv(sharesRows, (r) => r.views ?? 0);
      const saveViews = sv(savesRows, (r) => r.views ?? 0);
      return {
        key,
        posts: rs.length,
        views,
        avgViews: views !== null ? Math.round(views / withViews.length) : null,
        shareRate: shareViews ? sv(sharesRows, (r) => r.shares ?? 0)! / shareViews : null,
        saveRate: saveViews ? sv(savesRows, (r) => r.saves ?? 0)! / saveViews : null,
        avgRetention: ret.length ? ret.reduce((n, r) => n + (r.avgRetentionPct ?? 0), 0) / ret.length : null,
        confidence: confidenceFor(rs.length),
      };
    })
    .sort((a, b) => (b.avgViews ?? -1) - (a.avgViews ?? -1));
}

/** Observed performance + recommendations derived only from imported data. */
export async function analyticsOverview(orgId: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.analyticsRecords).where(eq(schema.analyticsRecords.orgId, orgId));
  const chars = await db.select({ id: schema.characters.id, name: schema.characters.name }).from(schema.characters).where(eq(schema.characters.orgId, orgId));
  const byCharacter = groupBy(rows, (r) => (r.characterIds.length ? r.characterIds.map((c) => chars.find((x) => x.id === c)?.name ?? c) : ["(no character tagged)"]));
  const byFormat = groupBy(rows, (r) => [r.format ?? "(format not supplied)"]);
  const byTheme = groupBy(rows, (r) => [r.theme ?? "(theme not supplied)"]);
  const byPlatform = groupBy(rows, (r) => [r.platform]);
  const recommendations: string[] = [];
  const top = (g: Group[]) => g.filter((x) => x.posts >= 3 && x.avgViews !== null && !x.key.startsWith("("));
  const fc = top(byFormat);
  if (fc.length >= 2) recommendations.push(`“${fc[0].key}” averages ${fc[0].avgViews!.toLocaleString()} views across ${fc[0].posts} posts vs ${fc[fc.length - 1].avgViews!.toLocaleString()} for “${fc[fc.length - 1].key}” (${fc[0].confidence.toLowerCase()} confidence – observational, not causal).`);
  const cc = top(byCharacter);
  if (cc.length >= 2) recommendations.push(`${cc[0].key} leads character performance (${cc[0].avgViews!.toLocaleString()} avg views, n=${cc[0].posts}). Consider testing ${cc[cc.length - 1].key} in ${cc[0].key}'s strongest format before drawing conclusions.`);
  const saves = byTheme.filter((t) => t.saveRate !== null && t.posts >= 3).sort((a, b) => b.saveRate! - a.saveRate!);
  if (saves.length) recommendations.push(`Theme “${saves[0].key}” has the highest save rate (${(saves[0].saveRate! * 100).toFixed(1)}%) – saves often signal content people want to return to.`);
  if (!rows.length) recommendations.push("Import a CSV export from your social platforms to get recommendations. Nothing is estimated without data.");
  else if (rows.length < 30) recommendations.push(`Only ${rows.length} posts imported – treat every pattern as a hypothesis to test.`);
  const missing = ["views", "shares", "saves", "avgRetentionPct", "watchTimeSeconds"].filter((k) => rows.every((r) => (r as Record<string, unknown>)[k] === null));
  return { total: rows.length, byCharacter, byFormat, byTheme, byPlatform, recommendations, missing, recent: rows.sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0)).slice(0, 25) };
}

export async function clearAnalytics(viewer: Viewer, batch: string) {
  assertCan(viewer, "data:delete");
  const db = await getDb();
  await db.delete(schema.analyticsRecords).where(and(eq(schema.analyticsRecords.orgId, viewer.orgId), eq(schema.analyticsRecords.importBatch, batch)));
}

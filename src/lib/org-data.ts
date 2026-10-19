import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "./audit";
import { assertCan, type Viewer } from "./auth/session";
import { getOrgSettings } from "./org";
import { getStorage } from "./storage";

/** Full structured export of the organisation's records (files are referenced by storage key). */
export async function exportOrgData(viewer: Viewer) {
  assertCan(viewer, "org:manage");
  const db = await getDb();
  const o = viewer.orgId;
  const [characters, canon, references, productions, generated, decisions, analytics, approvals] = await Promise.all([
    db.select().from(schema.characters).where(eq(schema.characters.orgId, o)),
    db.select().from(schema.canonRecords).where(eq(schema.canonRecords.orgId, o)),
    db.select().from(schema.referenceAssets).where(eq(schema.referenceAssets.orgId, o)),
    db.select().from(schema.productions).where(eq(schema.productions.orgId, o)),
    db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.orgId, o)),
    db.select().from(schema.creativeDecisions).where(eq(schema.creativeDecisions.orgId, o)),
    db.select().from(schema.analyticsRecords).where(eq(schema.analyticsRecords.orgId, o)),
    db.select().from(schema.approvals).where(eq(schema.approvals.orgId, o)),
  ]);
  const charVersions = characters.length ? await db.select().from(schema.characterVersions).where(inArray(schema.characterVersions.characterId, characters.map((c) => c.id))) : [];
  const assetVersions = references.length ? await db.select().from(schema.assetVersions).where(inArray(schema.assetVersions.assetId, references.map((r) => r.id))) : [];
  await audit({ orgId: o, actorUserId: viewer.userId, action: "org.exported", targetType: "organisation", targetId: o });
  return { exportedAt: new Date().toISOString(), organisation: viewer.orgName, characters, characterVersions: charVersions, canon, references, assetVersions, productions, generatedAssets: generated, decisions, analytics, approvals };
}

/**
 * Retention: purge files of REJECTED generated assets older than the
 * configured retention period. Approved work and references are never purged.
 */
export async function purgeExpired(viewer: Viewer) {
  assertCan(viewer, "data:delete");
  const settings = await getOrgSettings(viewer.orgId);
  if (!settings.retentionDays) return { purged: 0, note: "Retention is set to keep everything." };
  const db = await getDb();
  const cutoff = new Date(Date.now() - settings.retentionDays * 86400_000);
  const rows = await db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.orgId, viewer.orgId), eq(schema.generatedAssets.status, "rejected"), eq(schema.generatedAssets.locked, false), lt(schema.generatedAssets.createdAt, cutoff)));
  for (const r of rows) {
    if (r.storageKey) await getStorage().remove(r.storageKey);
    if (r.thumbnailKey) await getStorage().remove(r.thumbnailKey);
    await db.update(schema.generatedAssets).set({ storageKey: null, thumbnailKey: null, title: `${r.title} (file purged)` }).where(eq(schema.generatedAssets.id, r.id));
  }
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "org.retention_purge", targetType: "organisation", targetId: viewer.orgId, data: { purged: rows.length } });
  return { purged: rows.length };
}

/**
 * Generated assets: versioned lineages with full provenance, review actions,
 * locking, promotion to the reference library and export.
 */
import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { getDb, schema } from "@/db";
import type { Provenance, ReviewStatus } from "@/db/schema";
import { newId } from "@/lib/ids";
import { sha256 } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { AppError, conflict, notFound } from "@/lib/errors";
import { assertCan, type Viewer } from "@/lib/auth/session";
import { getStorage, orgKey, urlFor } from "@/lib/storage";
import { imageInfo, keyframes, thumbnail } from "@/lib/files/media";
import { enqueue } from "@/lib/jobs/queue";
import { recordDecision } from "@/lib/brain/decisions";

export type GeneratedAsset = typeof schema.generatedAssets.$inferSelect;

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "text/markdown": "md", "application/zip": "zip", "application/x-subrip": "srt", "text/vtt": "vtt", "application/json": "json" };

export interface NewAsset {
  orgId: string;
  productionId?: string | null;
  stepId?: string | null;
  itemKey?: string | null;
  kind: "image" | "video" | "audio" | "text" | "document" | "bundle";
  role: string;
  title: string;
  data?: Buffer | null;
  mimeType?: string | null;
  textContent?: string | null;
  characterIds?: string[];
  provenance: Provenance;
  costCents?: number;
  parentId?: string | null;
  status?: ReviewStatus;
  durationSeconds?: number | null;
  createdBy?: string | null;
}

export function emptyProvenance(extra: Partial<Provenance> = {}): Provenance {
  return { referenceAssetVersionIds: [], characterVersionIds: [], canonRecordIds: [], decisionIds: [], provider: null, model: null, promptVersion: null, prompt: null, parameters: {}, generatedAt: new Date().toISOString(), ...extra };
}

/** Store a new asset version. Versions of the same deliverable share a lineage. */
export async function createGeneratedAsset(a: NewAsset): Promise<GeneratedAsset> {
  const db = await getDb();
  let lineageId: string | null = null;
  let version = 1;
  let parentId = a.parentId ?? null;
  if (parentId) {
    const [parent] = await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.id, parentId));
    if (parent) lineageId = parent.lineageId;
  } else if (a.stepId && a.itemKey) {
    const [prev] = await db
      .select()
      .from(schema.generatedAssets)
      .where(and(eq(schema.generatedAssets.stepId, a.stepId), eq(schema.generatedAssets.itemKey, a.itemKey)))
      .orderBy(desc(schema.generatedAssets.version))
      .limit(1);
    if (prev) {
      lineageId = prev.lineageId;
      parentId = prev.id;
    }
  }
  if (lineageId) {
    const [max] = await db.select({ v: sql<number>`max(${schema.generatedAssets.version})::int` }).from(schema.generatedAssets).where(eq(schema.generatedAssets.lineageId, lineageId));
    version = (max?.v ?? 0) + 1;
  }
  const id = newId("gen");
  lineageId ??= id;
  let storageKey: string | null = null;
  let thumbnailKey: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (a.data && a.mimeType) {
    const ext = EXT[a.mimeType] ?? "bin";
    storageKey = orgKey(a.orgId, "generated", lineageId, `v${version}.${ext}`);
    const storage = getStorage();
    await storage.put(storageKey, a.data, a.mimeType);
    try {
      if (a.kind === "image") {
        const info = await imageInfo(a.data);
        width = info.width;
        height = info.height;
        thumbnailKey = orgKey(a.orgId, "generated", lineageId, `v${version}.thumb.webp`);
        await storage.put(thumbnailKey, await thumbnail(a.data), "image/webp");
      } else if (a.kind === "video") {
        const frames = await keyframes(a.data, ext, 1);
        if (frames[0]) {
          thumbnailKey = orgKey(a.orgId, "generated", lineageId, `v${version}.thumb.webp`);
          await storage.put(thumbnailKey, await thumbnail(frames[0].data), "image/webp");
        }
      }
    } catch {
      thumbnailKey = null;
    }
  }
  const [row] = await db
    .insert(schema.generatedAssets)
    .values({
      id,
      orgId: a.orgId,
      productionId: a.productionId ?? null,
      stepId: a.stepId ?? null,
      itemKey: a.itemKey ?? null,
      kind: a.kind,
      role: a.role,
      title: a.title,
      status: a.status ?? "ready_for_review",
      storageKey,
      thumbnailKey,
      mimeType: a.mimeType ?? (a.textContent ? "text/markdown" : null),
      sizeBytes: a.data?.length ?? (a.textContent ? Buffer.byteLength(a.textContent) : null),
      width,
      height,
      durationSeconds: a.durationSeconds ?? null,
      textContent: a.textContent ?? null,
      lineageId,
      version,
      parentId,
      characterIds: a.characterIds ?? [],
      provenance: { ...a.provenance, parameters: { ...a.provenance.parameters, sha256: a.data ? sha256(a.data) : null } },
      costCents: a.costCents ?? 0,
      createdBy: a.createdBy ?? null,
    })
    .returning();
  // A new version supersedes unapproved older versions in review queues.
  if (version > 1) {
    await db
      .update(schema.generatedAssets)
      .set({ status: "draft", updatedAt: new Date() })
      .where(and(eq(schema.generatedAssets.lineageId, lineageId), sql`${schema.generatedAssets.id} <> ${id}`, inArray(schema.generatedAssets.status, ["ready_for_review", "changes_requested"])));
  }
  return row;
}

export async function getAsset(orgId: string, id: string) {
  const db = await getDb();
  const [a] = await db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.orgId, orgId), eq(schema.generatedAssets.id, id)));
  if (!a) throw notFound("Asset not found.");
  return a;
}

/** Everything the review screen needs: versions, provenance resolved to real records, comments, history. */
export async function getAssetDetail(orgId: string, id: string) {
  const asset = await getAsset(orgId, id);
  const db = await getDb();
  const versions = await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.lineageId, asset.lineageId)).orderBy(asc(schema.generatedAssets.version));
  const p = asset.provenance;
  const refVersions = p.referenceAssetVersionIds.length
    ? await db
        .select({ v: schema.assetVersions, a: schema.referenceAssets })
        .from(schema.assetVersions)
        .innerJoin(schema.referenceAssets, eq(schema.referenceAssets.id, schema.assetVersions.assetId))
        .where(and(inArray(schema.assetVersions.id, p.referenceAssetVersionIds), eq(schema.referenceAssets.orgId, orgId)))
    : [];
  const charVersions = p.characterVersionIds.length
    ? await db
        .select({ v: schema.characterVersions, c: schema.characters })
        .from(schema.characterVersions)
        .innerJoin(schema.characters, eq(schema.characters.id, schema.characterVersions.characterId))
        .where(and(inArray(schema.characterVersions.id, p.characterVersionIds), eq(schema.characters.orgId, orgId)))
    : [];
  const canon = p.canonRecordIds.length ? await db.select({ id: schema.canonRecords.id, title: schema.canonRecords.title, version: schema.canonRecords.version, domain: schema.canonRecords.domain }).from(schema.canonRecords).where(and(inArray(schema.canonRecords.id, p.canonRecordIds), eq(schema.canonRecords.orgId, orgId))) : [];
  const comments = await db.select({ c: schema.comments, u: schema.users.name }).from(schema.comments).leftJoin(schema.users, eq(schema.users.id, schema.comments.authorId)).where(and(eq(schema.comments.targetType, "generated_asset"), inArray(schema.comments.targetId, versions.map((v) => v.id)))).orderBy(asc(schema.comments.createdAt));
  const history = await db.select({ r: schema.reviews, u: schema.users.name }).from(schema.reviews).leftJoin(schema.users, eq(schema.users.id, schema.reviews.reviewerId)).where(and(eq(schema.reviews.targetType, "generated_asset"), inArray(schema.reviews.targetId, versions.map((v) => v.id)))).orderBy(desc(schema.reviews.createdAt));
  const production = asset.productionId ? (await db.select({ id: schema.productions.id, title: schema.productions.title }).from(schema.productions).where(eq(schema.productions.id, asset.productionId)))[0] ?? null : null;
  return {
    asset,
    url: await urlFor(asset.storageKey),
    versions: await Promise.all(versions.map(async (v) => ({ ...v, url: await urlFor(v.storageKey), thumbUrl: await urlFor(v.thumbnailKey ?? (v.kind === "image" ? v.storageKey : null)) }))),
    references: await Promise.all(refVersions.map(async (r) => ({ assetId: r.a.id, versionId: r.v.id, version: r.v.version, title: r.a.title, designation: r.a.designation, current: r.a.currentVersionId === r.v.id, url: await urlFor(r.v.thumbnailKey ?? r.v.storageKey), fullUrl: await urlFor(r.v.storageKey), mediaKind: r.a.mediaKind }))),
    characterVersions: charVersions.map((c) => ({ characterId: c.c.id, name: c.c.name, version: c.v.version, status: c.v.status })),
    canon,
    comments: comments.map((c) => ({ ...c.c, author: c.u })),
    history: history.map((h) => ({ ...h.r, reviewer: h.u })),
    production,
  };
}

export interface AssetFilter {
  status?: string;
  productionId?: string;
  role?: string;
  kind?: string;
  latestOnly?: boolean;
  limit?: number;
}

export async function listGeneratedAssets(orgId: string, f: AssetFilter = {}) {
  const db = await getDb();
  const where: (SQL | undefined)[] = [eq(schema.generatedAssets.orgId, orgId)];
  if (f.status) where.push(eq(schema.generatedAssets.status, f.status as ReviewStatus));
  if (f.productionId) where.push(eq(schema.generatedAssets.productionId, f.productionId));
  if (f.role) where.push(eq(schema.generatedAssets.role, f.role));
  if (f.kind) where.push(eq(schema.generatedAssets.kind, f.kind));
  if (f.latestOnly) where.push(sql`${schema.generatedAssets.version} = (select max(g2.version) from generated_assets g2 where g2.lineage_id = ${schema.generatedAssets.lineageId})`);
  const rows = await db.select().from(schema.generatedAssets).where(and(...where)).orderBy(desc(schema.generatedAssets.createdAt)).limit(f.limit ?? 200);
  return Promise.all(rows.map(async (r) => ({ ...r, url: await urlFor(r.storageKey), thumbUrl: await urlFor(r.thumbnailKey ?? (r.kind === "image" ? r.storageKey : null)) })));
}

async function setStatus(viewer: Viewer, asset: GeneratedAsset, to: ReviewStatus, action: string, comment: string) {
  const db = await getDb();
  await db.update(schema.generatedAssets).set({ status: to, updatedAt: new Date() }).where(eq(schema.generatedAssets.id, asset.id));
  await db.insert(schema.reviews).values({ id: newId("rev"), orgId: viewer.orgId, targetType: "generated_asset", targetId: asset.id, action, fromStatus: asset.status, toStatus: to, comment, reviewerId: viewer.userId });
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: `asset.${action}`, targetType: "generated_asset", targetId: asset.id, data: { from: asset.status, to, comment } });
}

export type ReviewAction = "approve" | "reject" | "request_changes" | "comment" | "lock" | "unlock";

export async function reviewAsset(viewer: Viewer, id: string, action: ReviewAction, comment = "", annotation: { x: number; y: number; w: number; h: number; atSeconds?: number } | null = null) {
  const asset = await getAsset(viewer.orgId, id);
  const db = await getDb();
  if (action === "comment") {
    assertCan(viewer, "review:comment");
    if (!comment.trim()) throw new AppError("Write a comment.");
    await db.insert(schema.comments).values({ id: newId("cmt"), orgId: viewer.orgId, targetType: "generated_asset", targetId: id, body: comment, annotation, authorId: viewer.userId });
    return;
  }
  if (action === "lock" || action === "unlock") {
    assertCan(viewer, "review:approve");
    await db.update(schema.generatedAssets).set({ locked: action === "lock", updatedAt: new Date() }).where(eq(schema.generatedAssets.id, id));
    // Locking a shot's approved frame/video also locks the shot against regeneration.
    if (asset.itemKey?.startsWith("shot:")) await db.update(schema.shots).set({ locked: action === "lock" }).where(eq(schema.shots.id, asset.itemKey.slice(5)));
    await db.insert(schema.reviews).values({ id: newId("rev"), orgId: viewer.orgId, targetType: "generated_asset", targetId: id, action, comment, reviewerId: viewer.userId });
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: `asset.${action}`, targetType: "generated_asset", targetId: id });
    return;
  }
  if (asset.locked && action !== "approve") throw conflict("This version is locked. Unlock it first.");
  if (action === "approve") {
    assertCan(viewer, "review:approve");
    await setStatus(viewer, asset, "approved", "approve", comment);
    await recordDecision(viewer.orgId, viewer.userId, { kind: "selection", summary: `Approved ${asset.role.replace(/_/g, " ")} “${asset.title}” v${asset.version}`, detail: comment, characterIds: asset.characterIds, tags: [asset.role], sourceType: "generated_asset", sourceId: id });
  } else if (action === "reject") {
    assertCan(viewer, "review:approve");
    await setStatus(viewer, asset, "rejected", "reject", comment);
    await recordDecision(viewer.orgId, viewer.userId, { kind: "rejection", summary: `Rejected ${asset.role.replace(/_/g, " ")} “${asset.title}” v${asset.version}`, detail: comment, characterIds: asset.characterIds, tags: [asset.role], sourceType: "generated_asset", sourceId: id });
  } else if (action === "request_changes") {
    assertCan(viewer, "review:comment");
    if (!comment.trim()) throw new AppError("Describe the changes you need.");
    await setStatus(viewer, asset, "changes_requested", "request_changes", comment);
    await recordDecision(viewer.orgId, viewer.userId, { kind: "correction", summary: `Changes requested on “${asset.title}”`, detail: comment, characterIds: asset.characterIds, tags: [asset.role], sourceType: "generated_asset", sourceId: id });
  }
}

/** Queue a regeneration of one asset with the reviewer's notes (selective regeneration). */
export async function requestRegeneration(viewer: Viewer, id: string, notes: string) {
  assertCan(viewer, "production:run");
  const asset = await getAsset(viewer.orgId, id);
  if (asset.locked) throw conflict("This version is locked. Unlock it to regenerate.");
  if (!["image", "video", "audio"].includes(asset.kind)) throw new AppError("Only media assets can be regenerated individually – re-run the step instead.");
  if (asset.status !== "changes_requested") await reviewAsset(viewer, id, "request_changes", notes || "Regenerate");
  const jobId = await enqueue({ orgId: viewer.orgId, type: "regenerate_asset", payload: { assetId: id, notes, requestedBy: viewer.userId, productionId: asset.productionId }, idempotencyKey: `regen:${id}:${Date.now()}` });
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "asset.regeneration_requested", targetType: "generated_asset", targetId: id, data: { notes } });
  return jobId;
}

/** Promote an approved asset into the reference library (as an approved supporting reference). */
export async function promoteToReference(viewer: Viewer, id: string) {
  assertCan(viewer, "canon:approve");
  const asset = await getAsset(viewer.orgId, id);
  if (asset.status !== "approved" && asset.status !== "published") throw conflict("Only approved assets can be promoted to the reference library.");
  if (asset.kind !== "image" && asset.kind !== "video") throw new AppError("Only images and video can become references.");
  if (asset.promotedReferenceId) return asset.promotedReferenceId;
  const data = asset.storageKey ? await getStorage().get(asset.storageKey) : null;
  if (!data) throw notFound("The asset file is missing from storage.");
  const refId = newId("ref");
  const versionId = newId("rfv");
  const ext = asset.storageKey!.split(".").pop()!;
  const key = orgKey(viewer.orgId, "references", refId, `v1.${ext}`);
  await getStorage().put(key, data, asset.mimeType ?? "application/octet-stream");
  let thumbKey: string | null = null;
  if (asset.thumbnailKey) {
    const t = await getStorage().get(asset.thumbnailKey);
    if (t) {
      thumbKey = orgKey(viewer.orgId, "references", refId, "v1.thumb.webp");
      await getStorage().put(thumbKey, t, "image/webp");
    }
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(schema.referenceAssets).values({
      id: refId,
      orgId: viewer.orgId,
      title: `${asset.title} (promoted v${asset.version})`,
      assetType: asset.kind === "image" ? "character_render" : "animation_clip",
      mediaKind: asset.kind,
      designation: "approved_supporting",
      approvalState: "approved",
      source: `generated:${asset.id}`,
      rightsStatus: "owned",
      currentVersionId: versionId,
      technical: { width: asset.width ?? undefined, height: asset.height ?? undefined },
      promotedFromId: asset.id,
      notes: `Promoted from generated asset ${asset.id}. Provider: ${asset.provenance.provider ?? "n/a"} / ${asset.provenance.model ?? "n/a"}.`,
      createdBy: viewer.userId,
    });
    await tx.insert(schema.assetVersions).values({ id: versionId, assetId: refId, version: 1, storageKey: key, thumbnailKey: thumbKey, originalName: `${asset.title}.${ext}`, mimeType: asset.mimeType ?? "application/octet-stream", sizeBytes: data.length, sha256: sha256(data), createdBy: viewer.userId });
    for (const c of asset.characterIds) await tx.insert(schema.assetCharacters).values({ assetId: refId, characterId: c }).onConflictDoNothing();
    await tx.update(schema.generatedAssets).set({ promotedReferenceId: refId }).where(eq(schema.generatedAssets.id, id));
    await tx.insert(schema.reviews).values({ id: newId("rev"), orgId: viewer.orgId, targetType: "generated_asset", targetId: id, action: "promote", reviewerId: viewer.userId, comment: refId });
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "asset.promoted", targetType: "generated_asset", targetId: id, data: { referenceId: refId } }, tx);
  });
  return refId;
}

/** Export one asset as a ZIP with its provenance. Only approved (or already published) assets export. */
export async function exportAsset(viewer: Viewer, id: string): Promise<{ filename: string; data: Buffer }> {
  assertCan(viewer, "export:create");
  const detail = await getAssetDetail(viewer.orgId, id);
  const a = detail.asset;
  if (a.status !== "approved" && a.status !== "published") throw conflict("Approve this version before exporting it.");
  const files: Record<string, Uint8Array> = {};
  const base = `${a.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "_") || "asset"}_v${a.version}`;
  if (a.storageKey) {
    const data = await getStorage().get(a.storageKey);
    if (!data) throw notFound("The asset file is missing from storage.");
    files[`${base}.${a.storageKey.split(".").pop()}`] = new Uint8Array(data);
  }
  if (a.textContent) files[`${base}.md`] = strToU8(a.textContent);
  files[`${base}.provenance.json`] = strToU8(JSON.stringify({ id: a.id, title: a.title, version: a.version, lineageId: a.lineageId, status: a.status, provenance: a.provenance, sourceReferences: detail.references.map((r) => ({ assetId: r.assetId, versionId: r.versionId, title: r.title, version: r.version })), characterVersions: detail.characterVersions, canon: detail.canon, consistencyScoreAdvisory: a.consistencyScore, exportedAt: new Date().toISOString(), exportedBy: viewer.email }, null, 2));
  const db = await getDb();
  if (a.status === "approved") {
    await db.update(schema.generatedAssets).set({ status: "published", updatedAt: new Date() }).where(eq(schema.generatedAssets.id, id));
    await db.insert(schema.reviews).values({ id: newId("rev"), orgId: viewer.orgId, targetType: "generated_asset", targetId: id, action: "export", fromStatus: a.status, toStatus: "published", reviewerId: viewer.userId });
  }
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "asset.exported", targetType: "generated_asset", targetId: id });
  return { filename: `${base}.zip`, data: Buffer.from(zipSync(files)) };
}

export { zipSync, strToU8 };

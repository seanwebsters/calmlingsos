/**
 * Reference Upload Engine. Uploaded material is the source of truth for
 * what Calmlings look like; nothing here infers or invents designs.
 *
 *  - Content-sniffed validation, size limits, optional malware scan.
 *  - Immutable versions: a new file is always a new version.
 *  - Official master references can be versioned but never overwritten or deleted.
 *  - Machine analysis is stored separately and flagged until a human reviews it.
 */
import "server-only";
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { unzipSync } from "fflate";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { MachineAnalysis, ReferenceDesignation, TechnicalMetadata } from "@/db/schema";
import { newId } from "@/lib/ids";
import { sha256 } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { assertCan, type Viewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getStorage, orgKey, urlFor } from "@/lib/storage";
import { guessAssetType, sniff, type Sniffed } from "@/lib/files/sniff";
import { aspectRatio, dominantColours, imageInfo, keyframes, probeBuffer, thumbnail } from "@/lib/files/media";
import { extractText, inspectGltf } from "@/lib/files/documents";
import { scanBuffer } from "@/lib/files/scan";
import { enqueue } from "@/lib/jobs/queue";
import { getOrgSettings } from "@/lib/org";
import { indexSource } from "./embeddings";

export const DESIGNATIONS: { value: ReferenceDesignation; label: string; canon: boolean }[] = [
  { value: "official_master", label: "Official master reference", canon: true },
  { value: "approved_supporting", label: "Approved supporting reference", canon: true },
  { value: "style_inspiration", label: "Style inspiration only", canon: false },
  { value: "experimental", label: "Experimental", canon: false },
  { value: "rejected", label: "Rejected", canon: false },
  { value: "archived", label: "Archived", canon: false },
  { value: "unclassified", label: "Unclassified", canon: false },
];

export const uploadMeta = z.object({
  title: z.string().max(200).optional(),
  assetType: z.string().max(60).optional(),
  characterIds: z.array(z.string()).default([]),
  projectId: z.string().nullable().optional(),
  designation: z.enum(["official_master", "approved_supporting", "style_inspiration", "experimental", "rejected", "archived", "unclassified"]).default("unclassified"),
  viewAngle: z.string().max(40).nullable().optional(),
  source: z.string().max(200).default("upload"),
  rightsStatus: z.enum(["owned", "licensed", "restricted", "unknown"]).default("unknown"),
  usageNotes: z.string().max(4000).default(""),
  notes: z.string().max(4000).default(""),
  tags: z.array(z.string().max(60)).max(50).default([]),
  /** Voice recordings require recorded consent before they can be used for synthesis. */
  voiceConsent: z.boolean().optional(),
});
export type UploadMeta = z.infer<typeof uploadMeta>;

export interface IncomingFile {
  name: string;
  data: Buffer;
}

export interface UploadResult {
  created: { id: string; title: string; mediaKind: string }[];
  rejected: { name: string; reason: string }[];
}

async function technicalFor(data: Buffer, s: Sniffed): Promise<{ technical: TechnicalMetadata; thumb: Buffer | null; frames: { atSeconds: number; data: Buffer }[]; text: string | null }> {
  const technical: TechnicalMetadata = { format: s.ext };
  let thumb: Buffer | null = null;
  let frames: { atSeconds: number; data: Buffer }[] = [];
  let text: string | null = null;
  if (s.mediaKind === "image") {
    const info = await imageInfo(data);
    Object.assign(technical, { width: info.width, height: info.height, hasAlpha: info.hasAlpha, colourSpace: info.colourSpace, aspectRatio: aspectRatio(info.width, info.height) });
    technical.dominantColours = await dominantColours(data);
    thumb = await thumbnail(data);
  } else if (s.mediaKind === "video" || s.mediaKind === "audio") {
    const p = await probeBuffer(data, s.ext);
    Object.assign(technical, { durationSeconds: Math.round(p.durationSeconds * 100) / 100, width: p.width, height: p.height, fps: p.fps, videoCodec: p.videoCodec, audioCodec: p.audioCodec, aspectRatio: aspectRatio(p.width, p.height) });
    if (s.mediaKind === "video") {
      frames = await keyframes(data, s.ext, 6);
      if (frames[0]) thumb = await thumbnail(frames[Math.floor(frames.length / 2)].data);
    }
  } else if (s.mediaKind === "document" || s.mediaKind === "data") {
    const t = await extractText(data, s.mimeType).catch(() => null);
    if (t) {
      text = t.text;
      technical.wordCount = t.text.split(/\s+/).filter(Boolean).length;
      if (t.pages) technical.pages = t.pages;
    }
  } else if (s.mediaKind === "model3d") {
    try {
      Object.assign(technical, inspectGltf(data, s.mimeType));
    } catch {
      throw new AppError("The 3D file couldn't be parsed as glTF.");
    }
  }
  return { technical, thumb, frames, text };
}

async function validateCharacters(orgId: string, ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  const rows = await db.select({ id: schema.characters.id }).from(schema.characters).where(and(eq(schema.characters.orgId, orgId), inArray(schema.characters.id, ids)));
  if (rows.length !== new Set(ids).size) throw new AppError("One or more characters don't exist in this workspace.");
}

function requireClassifyPermission(viewer: Viewer, designation: ReferenceDesignation) {
  if ((designation === "official_master" || designation === "approved_supporting") && !can(viewer.role, "canon:approve")) {
    throw forbidden("Only a creative director or owner can designate official or approved references.");
  }
}

/** Upload one or more files (ZIP collections are expanded). */
export async function uploadReferences(viewer: Viewer, files: IncomingFile[], rawMeta: unknown): Promise<UploadResult> {
  assertCan(viewer, "reference:upload");
  const meta = uploadMeta.parse(rawMeta);
  requireClassifyPermission(viewer, meta.designation);
  await validateCharacters(viewer.orgId, meta.characterIds);
  const settings = await getOrgSettings(viewer.orgId);
  const maxBytes = settings.maxUploadMb * 1024 * 1024;
  const result: UploadResult = { created: [], rejected: [] };

  for (const file of files) {
    if (file.data.length > maxBytes) {
      result.rejected.push({ name: file.name, reason: `Larger than the ${settings.maxUploadMb} MB upload limit.` });
      continue;
    }
    const s = sniff(file.data, file.name);
    if (!s) {
      result.rejected.push({ name: file.name, reason: "Unsupported or unrecognised file type (contents don't match an allowed format)." });
      continue;
    }
    if (s.mediaKind === "archive") {
      const collectionId = newId("col");
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(new Uint8Array(file.data), { filter: (f) => !f.name.endsWith("/") && !f.name.includes("__MACOSX") && !f.name.split("/").pop()!.startsWith(".") && f.originalSize <= maxBytes });
      } catch {
        result.rejected.push({ name: file.name, reason: "The ZIP file couldn't be read." });
        continue;
      }
      const names = Object.keys(entries);
      if (names.length > 500) {
        result.rejected.push({ name: file.name, reason: "ZIP collections are limited to 500 files." });
        continue;
      }
      for (const name of names) {
        const inner = Buffer.from(entries[name]);
        const innerSniff = sniff(inner, name);
        if (!innerSniff || innerSniff.mediaKind === "archive") {
          result.rejected.push({ name: `${file.name}/${name}`, reason: "Unsupported type inside ZIP." });
          continue;
        }
        try {
          result.created.push(await createOne(viewer, { name: name.split("/").pop()!, data: inner }, innerSniff, meta, collectionId, [...meta.tags, `collection:${file.name.replace(/\.zip$/i, "")}`]));
        } catch (e) {
          result.rejected.push({ name: `${file.name}/${name}`, reason: (e as Error).message });
        }
      }
      continue;
    }
    try {
      result.created.push(await createOne(viewer, file, s, meta, null, meta.tags));
    } catch (e) {
      result.rejected.push({ name: file.name, reason: (e as Error).message });
    }
  }
  return result;
}

async function createOne(viewer: Viewer, file: IncomingFile, s: Sniffed, meta: UploadMeta, collectionId: string | null, tags: string[]) {
  const scan = await scanBuffer(file.data);
  if (scan.scanned && !scan.clean) throw new AppError(`Malware scan rejected the file: ${scan.detail}`);
  if (!scan.clean) throw new AppError(scan.detail);
  if (meta.assetType === "voice_recording" && !meta.voiceConsent && meta.rightsStatus !== "owned") {
    throw new AppError("Voice recordings need documented consent from the voice owner (tick the consent box) before upload.");
  }
  const { technical, thumb, frames, text } = await technicalFor(file.data, s);
  const id = newId("ref");
  const versionId = newId("rfv");
  const storage = getStorage();
  const key = orgKey(viewer.orgId, "references", id, `v1.${s.ext}`);
  await storage.put(key, file.data, s.mimeType);
  let thumbKey: string | null = null;
  if (thumb) {
    thumbKey = orgKey(viewer.orgId, "references", id, "v1.thumb.webp");
    await storage.put(thumbKey, thumb, "image/webp");
  }
  if (frames.length) {
    technical.keyframeKeys = [];
    for (const [i, f] of frames.entries()) {
      const k = orgKey(viewer.orgId, "references", id, `v1.keyframe-${i}.jpg`);
      await storage.put(k, f.data, "image/jpeg");
      technical.keyframeKeys.push(k);
    }
    (technical as Record<string, unknown>).keyframeTimes = frames.map((f) => f.atSeconds);
  }
  const designation = meta.designation;
  const approved = designation === "official_master" || designation === "approved_supporting";
  const title = meta.title && meta.title.trim() ? (collectionId ? `${meta.title} – ${file.name}` : meta.title) : file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(schema.referenceAssets).values({
      id,
      orgId: viewer.orgId,
      title,
      assetType: meta.assetType || guessAssetType(s.mediaKind, file.name),
      mediaKind: s.mediaKind,
      designation,
      approvalState: approved ? "approved" : designation === "rejected" ? "rejected" : "pending",
      viewAngle: meta.viewAngle ?? null,
      source: meta.source,
      rightsStatus: meta.rightsStatus,
      usageNotes: meta.voiceConsent ? `${meta.usageNotes}\nVoice-owner consent recorded by ${viewer.name} on ${new Date().toISOString().slice(0, 10)}.`.trim() : meta.usageNotes,
      notes: meta.notes,
      currentVersionId: versionId,
      technical,
      analysis: text ? { provider: null, model: null, analysedAt: new Date().toISOString(), machineGenerated: true, extractedText: text.slice(0, 100_000) } : null,
      collectionId,
      immutable: designation === "official_master",
      createdBy: viewer.userId,
    });
    await tx.insert(schema.assetVersions).values({ id: versionId, assetId: id, version: 1, storageKey: key, thumbnailKey: thumbKey, originalName: file.name, mimeType: s.mimeType, sizeBytes: file.data.length, sha256: sha256(file.data), createdBy: viewer.userId });
    for (const c of new Set(meta.characterIds)) await tx.insert(schema.assetCharacters).values({ assetId: id, characterId: c });
    if (meta.projectId) await tx.insert(schema.assetProjects).values({ assetId: id, projectId: meta.projectId }).onConflictDoNothing();
    for (const t of new Set(tags.map((x) => x.trim().toLowerCase()).filter(Boolean))) await tx.insert(schema.assetTags).values({ assetId: id, tag: t }).onConflictDoNothing();
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "reference.uploaded", targetType: "reference_asset", targetId: id, data: { name: file.name, sha256: sha256(file.data), designation, scan: scan.detail } }, tx);
  });
  if (["image", "video", "audio", "document"].includes(s.mediaKind)) await queueAnalysis(viewer.orgId, id, versionId);
  return { id, title, mediaKind: s.mediaKind };
}

export async function queueAnalysis(orgId: string, assetId: string, versionId: string, attempt = 0) {
  const db = await getDb();
  await db.update(schema.referenceAssets).set({ analysisStatus: "queued", analysisError: null }).where(eq(schema.referenceAssets.id, assetId));
  await enqueue({ orgId, type: "analyze_reference", payload: { assetId, versionId }, idempotencyKey: `analyze:${versionId}:${attempt}` });
}

/** Add a new file version. Old versions are kept forever (immutable history). */
export async function addVersion(viewer: Viewer, assetId: string, file: IncomingFile, note: string) {
  assertCan(viewer, "reference:upload");
  const { asset, versions } = await getReference(viewer.orgId, assetId);
  if (asset.immutable) assertCan(viewer, "canon:approve");
  const s = sniff(file.data, file.name);
  if (!s || s.mediaKind === "archive") throw new AppError("Unsupported file type.");
  if (s.mediaKind !== asset.mediaKind) throw new AppError(`A new version must be the same kind of file (${asset.mediaKind}).`);
  const settings = await getOrgSettings(viewer.orgId);
  if (file.data.length > settings.maxUploadMb * 1024 * 1024) throw new AppError(`Larger than the ${settings.maxUploadMb} MB upload limit.`);
  const scan = await scanBuffer(file.data);
  if (!scan.clean) throw new AppError(scan.detail);
  const { technical, thumb } = await technicalFor(file.data, s);
  const version = (versions[0]?.version ?? 0) + 1;
  const versionId = newId("rfv");
  const storage = getStorage();
  const key = orgKey(viewer.orgId, "references", assetId, `v${version}.${s.ext}`);
  await storage.put(key, file.data, s.mimeType);
  let thumbKey: string | null = null;
  if (thumb) {
    thumbKey = orgKey(viewer.orgId, "references", assetId, `v${version}.thumb.webp`);
    await storage.put(thumbKey, thumb, "image/webp");
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.insert(schema.assetVersions).values({ id: versionId, assetId, version, storageKey: key, thumbnailKey: thumbKey, originalName: file.name, mimeType: s.mimeType, sizeBytes: file.data.length, sha256: sha256(file.data), note, createdBy: viewer.userId });
    // A new master file must be re-approved before agents use it.
    const reapprove = asset.designation === "official_master" || asset.designation === "approved_supporting";
    await tx
      .update(schema.referenceAssets)
      .set({ currentVersionId: versionId, technical, analysisReviewed: false, approvalState: reapprove ? "pending" : asset.approvalState, updatedAt: new Date() })
      .where(eq(schema.referenceAssets.id, assetId));
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "reference.version_added", targetType: "reference_asset", targetId: assetId, data: { version, note } }, tx);
  });
  await queueAnalysis(viewer.orgId, assetId, versionId);
  return { versionId, version };
}

export async function classifyReference(viewer: Viewer, assetId: string, designation: ReferenceDesignation, note = "") {
  assertCan(viewer, "reference:classify");
  requireClassifyPermission(viewer, designation);
  const { asset } = await getReference(viewer.orgId, assetId);
  if (asset.immutable && designation !== "official_master") assertCan(viewer, "canon:approve");
  const approved = designation === "official_master" || designation === "approved_supporting";
  const db = await getDb();
  await db
    .update(schema.referenceAssets)
    .set({
      designation,
      approvalState: approved ? "approved" : designation === "rejected" ? "rejected" : "pending",
      immutable: asset.immutable || designation === "official_master",
      updatedAt: new Date(),
    })
    .where(eq(schema.referenceAssets.id, assetId));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "reference.classified", targetType: "reference_asset", targetId: assetId, data: { from: asset.designation, to: designation, note } });
  await indexSource(viewer.orgId, "reference_asset", assetId).catch(() => null);
}

export const metaPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  assetType: z.string().max(60).optional(),
  viewAngle: z.string().max(40).nullable().optional(),
  rightsStatus: z.enum(["owned", "licensed", "restricted", "unknown"]).optional(),
  usageNotes: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
  source: z.string().max(200).optional(),
  characterIds: z.array(z.string()).optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
});

export async function updateReference(viewer: Viewer, assetId: string, raw: unknown) {
  assertCan(viewer, "reference:upload");
  const patch = metaPatch.parse(raw);
  const { asset } = await getReference(viewer.orgId, assetId);
  if (patch.characterIds) await validateCharacters(viewer.orgId, patch.characterIds);
  if (asset.immutable && patch.characterIds) assertCan(viewer, "canon:approve");
  const db = await getDb();
  const { characterIds, tags, ...cols } = patch;
  await db.transaction(async (tx) => {
    if (Object.keys(cols).length) await tx.update(schema.referenceAssets).set({ ...cols, updatedAt: new Date() }).where(eq(schema.referenceAssets.id, assetId));
    if (characterIds) {
      await tx.delete(schema.assetCharacters).where(eq(schema.assetCharacters.assetId, assetId));
      for (const c of new Set(characterIds)) await tx.insert(schema.assetCharacters).values({ assetId, characterId: c });
    }
    if (tags) {
      await tx.delete(schema.assetTags).where(eq(schema.assetTags.assetId, assetId));
      for (const t of new Set(tags.map((x) => x.trim().toLowerCase()).filter(Boolean))) await tx.insert(schema.assetTags).values({ assetId, tag: t });
    }
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "reference.updated", targetType: "reference_asset", targetId: assetId, data: patch }, tx);
  });
}

/** A human reviews (and may correct) the machine analysis. */
export async function reviewAnalysis(viewer: Viewer, assetId: string, edited: Partial<MachineAnalysis>) {
  assertCan(viewer, "reference:classify");
  const { asset } = await getReference(viewer.orgId, assetId);
  const db = await getDb();
  const merged: MachineAnalysis = { ...(asset.analysis ?? { provider: null, model: null, analysedAt: new Date().toISOString(), machineGenerated: true }), ...edited, machineGenerated: true };
  await db.update(schema.referenceAssets).set({ analysis: merged, analysisReviewed: true, updatedAt: new Date() }).where(eq(schema.referenceAssets.id, assetId));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "reference.analysis_reviewed", targetType: "reference_asset", targetId: assetId });
  await indexSource(viewer.orgId, "reference_asset", assetId).catch(() => null);
}

export async function deleteReference(viewer: Viewer, assetId: string) {
  assertCan(viewer, "data:delete");
  const { asset } = await getReference(viewer.orgId, assetId);
  if (asset.immutable) throw new AppError("Official master references can't be deleted. Archive it instead – its history is kept permanently.");
  const db = await getDb();
  await db.update(schema.referenceAssets).set({ deletedAt: new Date(), designation: "archived" }).where(eq(schema.referenceAssets.id, assetId));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "reference.deleted", targetType: "reference_asset", targetId: assetId });
}

export async function getReference(orgId: string, id: string) {
  const db = await getDb();
  const [asset] = await db.select().from(schema.referenceAssets).where(and(eq(schema.referenceAssets.orgId, orgId), eq(schema.referenceAssets.id, id)));
  if (!asset) throw notFound("Reference not found.");
  const versions = await db.select().from(schema.assetVersions).where(eq(schema.assetVersions.assetId, id)).orderBy(desc(schema.assetVersions.version));
  const chars = await db.select({ id: schema.characters.id, name: schema.characters.name, code: schema.characters.code }).from(schema.assetCharacters).innerJoin(schema.characters, eq(schema.characters.id, schema.assetCharacters.characterId)).where(eq(schema.assetCharacters.assetId, id));
  const tags = (await db.select({ tag: schema.assetTags.tag }).from(schema.assetTags).where(eq(schema.assetTags.assetId, id))).map((t) => t.tag);
  return { asset, versions, current: versions.find((v) => v.id === asset.currentVersionId) ?? versions[0] ?? null, characters: chars, tags };
}

export interface ReferenceFilter {
  q?: string;
  characterId?: string;
  designation?: string;
  mediaKind?: string;
  assetType?: string;
  tag?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export async function listReferences(orgId: string, f: ReferenceFilter = {}) {
  const db = await getDb();
  const where: (SQL | undefined)[] = [eq(schema.referenceAssets.orgId, orgId)];
  if (!f.includeDeleted) where.push(isNull(schema.referenceAssets.deletedAt));
  if (f.designation) where.push(eq(schema.referenceAssets.designation, f.designation as ReferenceDesignation));
  if (f.mediaKind) where.push(eq(schema.referenceAssets.mediaKind, f.mediaKind));
  if (f.assetType) where.push(eq(schema.referenceAssets.assetType, f.assetType));
  if (f.q) where.push(or(ilike(schema.referenceAssets.title, `%${f.q}%`), ilike(schema.referenceAssets.notes, `%${f.q}%`)));
  if (f.characterId) where.push(sql`exists (select 1 from asset_characters ac where ac.asset_id = ${schema.referenceAssets.id} and ac.character_id = ${f.characterId})`);
  if (f.tag) where.push(sql`exists (select 1 from asset_tags t where t.asset_id = ${schema.referenceAssets.id} and t.tag = ${f.tag})`);
  const rows = await db
    .select({ a: schema.referenceAssets, v: schema.assetVersions })
    .from(schema.referenceAssets)
    .leftJoin(schema.assetVersions, eq(schema.assetVersions.id, schema.referenceAssets.currentVersionId))
    .where(and(...where))
    .orderBy(desc(schema.referenceAssets.createdAt))
    .limit(f.limit ?? 300);
  const ids = rows.map((r) => r.a.id);
  const links = ids.length
    ? await db.select({ assetId: schema.assetCharacters.assetId, id: schema.characters.id, name: schema.characters.name }).from(schema.assetCharacters).innerJoin(schema.characters, eq(schema.characters.id, schema.assetCharacters.characterId)).where(inArray(schema.assetCharacters.assetId, ids))
    : [];
  return Promise.all(
    rows.map(async (r) => ({
      ...r.a,
      version: r.v,
      thumbUrl: await urlFor(r.v?.thumbnailKey ?? (r.a.mediaKind === "image" ? r.v?.storageKey : null)),
      characters: links.filter((l) => l.assetId === r.a.id).map((l) => ({ id: l.id, name: l.name })),
    })),
  );
}

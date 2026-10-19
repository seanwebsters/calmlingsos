import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CharacterProfile } from "@/db/schema";
import { characterCode, newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { AppError, CanonGuardError, conflict, notFound } from "@/lib/errors";
import { assertCan, type Viewer } from "@/lib/auth/session";
import { changedFields, emptyProfile, PROFILE_FIELDS, profileSchema } from "./profile";
import { createApproval } from "@/lib/review/approvals";
import { indexSource } from "./embeddings";

export async function listCharacters(orgId: string) {
  const db = await getDb();
  const chars = await db.select().from(schema.characters).where(eq(schema.characters.orgId, orgId)).orderBy(asc(schema.characters.name));
  if (!chars.length) return [];
  const ids = chars.map((c) => c.id);
  const refCounts = await db
    .select({ characterId: schema.assetCharacters.characterId, designation: schema.referenceAssets.designation, n: sql<number>`count(*)::int` })
    .from(schema.assetCharacters)
    .innerJoin(schema.referenceAssets, eq(schema.referenceAssets.id, schema.assetCharacters.assetId))
    .where(and(inArray(schema.assetCharacters.characterId, ids), sql`${schema.referenceAssets.deletedAt} is null`))
    .groupBy(schema.assetCharacters.characterId, schema.referenceAssets.designation);
  const versions = await db.select().from(schema.characterVersions).where(inArray(schema.characterVersions.characterId, ids));
  return chars.map((c) => {
    const counts = refCounts.filter((r) => r.characterId === c.id);
    const total = counts.reduce((n, r) => n + r.n, 0);
    const masters = counts.find((r) => r.designation === "official_master")?.n ?? 0;
    const supporting = counts.find((r) => r.designation === "approved_supporting")?.n ?? 0;
    const approved = versions.find((v) => v.id === c.approvedVersionId) ?? null;
    const pending = versions.filter((v) => v.characterId === c.id && v.status === "pending_approval").length;
    return { ...c, referenceCount: total, masterCount: masters, supportingCount: supporting, approvedVersion: approved, pendingVersions: pending, readiness: readiness(approved?.profile ?? null, masters, supporting) };
  });
}

/** Production readiness: a transparent score of what canon exists, not a quality judgement. */
export function readiness(profile: CharacterProfile | null, masters: number, supporting: number) {
  const checks = [
    { label: "Approved profile", ok: Boolean(profile) },
    { label: "Official master reference", ok: masters > 0 },
    { label: "3+ approved references", ok: masters + supporting >= 3 },
    { label: "Colours defined", ok: Boolean(profile?.colours.length) },
    { label: "Personality defined", ok: Boolean(profile?.personality.trim()) },
    { label: "Animation rules defined", ok: Boolean(profile?.animationRules.trim()) },
    { label: "Consistency rules defined", ok: Boolean(profile?.consistencyChecklist.some((c) => c.rule.trim())) },
  ];
  return { score: checks.filter((c) => c.ok).length / checks.length, checks };
}

export async function getCharacter(orgId: string, id: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.characters).where(and(eq(schema.characters.orgId, orgId), eq(schema.characters.id, id)));
  if (!c) throw notFound("Character not found.");
  const versions = await db.select().from(schema.characterVersions).where(eq(schema.characterVersions.characterId, id)).orderBy(desc(schema.characterVersions.version));
  const approved = versions.find((v) => v.id === c.approvedVersionId) ?? null;
  const latest = versions[0] ?? null;
  return { character: c, versions, approved, latest };
}

export async function createCharacter(viewer: Viewer, input: { name: string; summary?: string; canonStatus?: "draft" | "experimental" }) {
  assertCan(viewer, "canon:edit");
  const name = input.name.trim();
  if (!name) throw new AppError("A character needs a name.");
  const db = await getDb();
  const code = characterCode(name);
  const [dupe] = await db.select({ id: schema.characters.id }).from(schema.characters).where(and(eq(schema.characters.orgId, viewer.orgId), eq(schema.characters.code, code)));
  if (dupe) throw conflict(`A character with ID ${code} already exists.`);
  const id = newId("chr");
  await db.transaction(async (tx) => {
    await tx.insert(schema.characters).values({ id, orgId: viewer.orgId, code, name, summary: input.summary ?? "", canonStatus: input.canonStatus ?? "draft" });
    await tx.insert(schema.characterVersions).values({ id: newId("chv"), characterId: id, version: 1, profile: emptyProfile(name), status: "draft", source: "human", changeNote: "Created", createdBy: viewer.userId });
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "character.created", targetType: "character", targetId: id, data: { name, code } }, tx);
  });
  return id;
}

/**
 * Save a new profile version. Never overwrites: every save is a new version.
 * With Character Lock on, touching a locked field turns the version into a
 * pending change request that a canon authority must approve.
 */
export async function saveProfile(
  viewer: Viewer | { orgId: string; userId: null; agentKey: string },
  characterId: string,
  profileInput: unknown,
  changeNote: string,
): Promise<{ versionId: string; version: number; status: string; lockedFieldsTouched: string[] }> {
  const isAgent = "agentKey" in viewer;
  if (!isAgent) assertCan(viewer, "canon:edit");
  const profile = profileSchema.parse(profileInput) as CharacterProfile;
  const { character, approved, latest } = await getCharacter(viewer.orgId, characterId);
  const base = approved?.profile ?? null;
  const touched = changedFields(base, profile);
  const lockedTouched = character.locked && base ? touched.filter((f) => character.lockedFields.includes(f)) : [];
  const status = isAgent || lockedTouched.length ? "pending_approval" : "draft";
  const db = await getDb();
  const version = (latest?.version ?? 0) + 1;
  const versionId = newId("chv");
  await db.transaction(async (tx) => {
    await tx.insert(schema.characterVersions).values({
      id: versionId,
      characterId,
      version,
      profile,
      status,
      source: isAgent ? "ai_proposal" : "human",
      changeNote,
      createdBy: isAgent ? null : viewer.userId,
    });
    await audit({ orgId: viewer.orgId, actorUserId: isAgent ? null : viewer.userId, actorAgent: isAgent ? viewer.agentKey : null, action: "character.version_saved", targetType: "character", targetId: characterId, data: { version, status, touched, lockedTouched } }, tx);
  });
  if (status === "pending_approval") {
    await createApproval({
      orgId: viewer.orgId,
      kind: "character_change",
      targetType: "character_version",
      targetId: versionId,
      title: `${character.name}: ${isAgent ? "AI-proposed" : "locked"} profile change (v${version})`,
      summary: lockedTouched.length ? `Touches locked fields: ${lockedTouched.map((f) => PROFILE_FIELDS.find((p) => p.key === f)?.label ?? f).join(", ")}` : `Changes: ${touched.join(", ") || "none"}`,
      payload: { characterId, version, touched, lockedTouched },
      requestedBy: isAgent ? viewer.agentKey : viewer.userId,
    });
  }
  return { versionId, version, status, lockedFieldsTouched: lockedTouched };
}

/** Make a profile version the approved canon. Only canon authorities may do this. */
export async function approveVersion(viewer: Viewer, versionId: string, note = "") {
  assertCan(viewer, "canon:approve");
  const db = await getDb();
  const [v] = await db.select().from(schema.characterVersions).where(eq(schema.characterVersions.id, versionId));
  if (!v) throw notFound("Version not found.");
  const { character } = await getCharacter(viewer.orgId, v.characterId);
  if (v.status === "approved") return;
  if (v.status === "rejected") throw new AppError("A rejected version can't be approved – save a new version instead.");
  await db.transaction(async (tx) => {
    if (character.approvedVersionId) await tx.update(schema.characterVersions).set({ status: "superseded" }).where(eq(schema.characterVersions.id, character.approvedVersionId));
    await tx.update(schema.characterVersions).set({ status: "approved", approvedBy: viewer.userId, approvedAt: new Date() }).where(eq(schema.characterVersions.id, versionId));
    await tx.update(schema.characters).set({ approvedVersionId: versionId, canonStatus: "official", name: v.profile.officialName, updatedAt: new Date() }).where(eq(schema.characters.id, character.id));
    await tx
      .update(schema.approvals)
      .set({ status: "approved", decidedBy: viewer.userId, decidedAt: new Date(), decisionNote: note })
      .where(and(eq(schema.approvals.targetType, "character_version"), eq(schema.approvals.targetId, versionId), eq(schema.approvals.status, "pending")));
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "character.version_approved", targetType: "character", targetId: character.id, data: { versionId, version: v.version, note } }, tx);
  });
  await indexSource(viewer.orgId, "character_version", versionId).catch(() => null);
}

export async function rejectVersion(viewer: Viewer, versionId: string, note = "") {
  assertCan(viewer, "canon:approve");
  const db = await getDb();
  const [v] = await db.select().from(schema.characterVersions).where(eq(schema.characterVersions.id, versionId));
  if (!v) throw notFound("Version not found.");
  await getCharacter(viewer.orgId, v.characterId);
  if (v.status === "approved") throw new AppError("The approved version can't be rejected. Approve a different version to supersede it.");
  await db.update(schema.characterVersions).set({ status: "rejected" }).where(eq(schema.characterVersions.id, versionId));
  await db
    .update(schema.approvals)
    .set({ status: "rejected", decidedBy: viewer.userId, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(schema.approvals.targetType, "character_version"), eq(schema.approvals.targetId, versionId), eq(schema.approvals.status, "pending")));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "character.version_rejected", targetType: "character", targetId: v.characterId, data: { versionId, note } });
}

export async function setCharacterLock(viewer: Viewer, characterId: string, locked: boolean, fields: string[]) {
  assertCan(viewer, "character:lock");
  await getCharacter(viewer.orgId, characterId);
  const valid = fields.filter((f) => PROFILE_FIELDS.some((p) => p.key === f));
  const db = await getDb();
  await db.update(schema.characters).set({ locked, lockedFields: valid, updatedAt: new Date() }).where(eq(schema.characters.id, characterId));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: locked ? "character.locked" : "character.unlocked", targetType: "character", targetId: characterId, data: { fields: valid } });
}

/** Guard used by agents and services before altering identity – throws when a locked field would change. */
export async function assertNotLocked(orgId: string, characterId: string, fields: string[]) {
  const { character } = await getCharacter(orgId, characterId);
  const hit = character.locked ? fields.filter((f) => character.lockedFields.includes(f)) : [];
  if (hit.length) throw new CanonGuardError(`${character.name} is under Character Lock (${hit.join(", ")}). Submit a change request for approval instead.`, hit);
}

export async function setHeroAsset(viewer: Viewer, characterId: string, assetId: string | null) {
  assertCan(viewer, "canon:edit");
  await getCharacter(viewer.orgId, characterId);
  const db = await getDb();
  await db.update(schema.characters).set({ heroAssetId: assetId, updatedAt: new Date() }).where(eq(schema.characters.id, characterId));
}

export async function updateCharacterMeta(viewer: Viewer, characterId: string, patch: { summary?: string; canonStatus?: "draft" | "experimental" | "archived" }) {
  assertCan(viewer, "canon:edit");
  const { character } = await getCharacter(viewer.orgId, characterId);
  if (patch.canonStatus && character.canonStatus === "official") assertCan(viewer, "canon:approve");
  const db = await getDb();
  await db.update(schema.characters).set({ ...patch, updatedAt: new Date() }).where(eq(schema.characters.id, characterId));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "character.updated", targetType: "character", targetId: characterId, data: patch });
}

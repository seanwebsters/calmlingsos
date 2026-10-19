/**
 * Canon retrieval – the context pack every agent receives before work.
 *
 * Structured canon is queried first (approved character versions, official
 * canon records, approved references, active rules). Semantic or lexical
 * search only adds supporting material. Isolation: a reference is included
 * only when ALL of its linked characters are in the requested cast, so one
 * character's material can't leak into another character's generation.
 */
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { profileToText } from "./profile";
import { semanticSearch } from "./embeddings";

export interface PackReference {
  assetId: string;
  versionId: string;
  title: string;
  designation: string;
  assetType: string;
  mediaKind: string;
  viewAngle: string | null;
  characterIds: string[];
  storageKey: string;
  thumbnailKey: string | null;
  mimeType: string;
  analysisSummary: string | null;
}

export interface ContextPack {
  builtAt: string;
  characters: { id: string; code: string; name: string; versionId: string; version: number; locked: boolean; lockedFields: string[]; text: string; colours: string[] }[];
  missingCanon: { id: string; name: string; reason: string }[];
  references: PackReference[];
  styleInspiration: PackReference[];
  canon: { id: string; domain: string; kind: string; title: string; version: number; body: string }[];
  rules: { id: string; summary: string; detail: string }[];
  decisions: { id: string; kind: string; summary: string }[];
  semantic: { mode: "semantic" | "lexical" | "unavailable"; hits: { sourceType: string; sourceId: string; text: string; score: number }[] };
  warnings: string[];
}

const GLOBAL_REFERENCE_TYPES = ["background_environment", "brand_guidelines", "logo", "game_screenshot", "storyboard"];

export async function buildContextPack(orgId: string, opts: { characterIds: string[]; department?: string; query?: string; includeStyleInspiration?: boolean }): Promise<ContextPack> {
  const db = await getDb();
  const want = [...new Set(opts.characterIds)];
  const warnings: string[] = [];

  // 1. Characters – approved versions only.
  const chars = want.length ? await db.select().from(schema.characters).where(and(eq(schema.characters.orgId, orgId), inArray(schema.characters.id, want))) : [];
  const versionIds = chars.map((c) => c.approvedVersionId).filter((x): x is string => Boolean(x));
  const versions = versionIds.length ? await db.select().from(schema.characterVersions).where(inArray(schema.characterVersions.id, versionIds)) : [];
  const characters: ContextPack["characters"] = [];
  const missingCanon: ContextPack["missingCanon"] = [];
  for (const c of chars) {
    const v = versions.find((x) => x.id === c.approvedVersionId);
    if (!v) {
      missingCanon.push({ id: c.id, name: c.name, reason: "No approved profile – agents must not invent this character's canon." });
      continue;
    }
    characters.push({ id: c.id, code: c.code, name: v.profile.officialName, versionId: v.id, version: v.version, locked: c.locked, lockedFields: c.lockedFields, text: profileToText(c.code, v.profile, v.version), colours: v.profile.colours.map((x) => `${x.name} ${x.hex}`) });
  }
  for (const id of want) if (!chars.some((c) => c.id === id)) missingCanon.push({ id, name: id, reason: "Character not found in this workspace." });
  if (missingCanon.length) warnings.push(`Missing approved canon for: ${missingCanon.map((m) => m.name).join(", ")}.`);

  // 2. References – approved, current version, isolated by cast.
  const refRows = await db
    .select({ a: schema.referenceAssets, v: schema.assetVersions })
    .from(schema.referenceAssets)
    .innerJoin(schema.assetVersions, eq(schema.assetVersions.id, schema.referenceAssets.currentVersionId))
    .where(and(eq(schema.referenceAssets.orgId, orgId), isNull(schema.referenceAssets.deletedAt), inArray(schema.referenceAssets.designation, opts.includeStyleInspiration ? ["official_master", "approved_supporting", "style_inspiration"] : ["official_master", "approved_supporting"])));
  const links = refRows.length ? await db.select().from(schema.assetCharacters).where(inArray(schema.assetCharacters.assetId, refRows.map((r) => r.a.id))) : [];
  const references: PackReference[] = [];
  const styleInspiration: PackReference[] = [];
  for (const r of refRows) {
    const linked = links.filter((l) => l.assetId === r.a.id).map((l) => l.characterId);
    const isolatedOk = linked.length ? linked.every((c) => want.includes(c)) : GLOBAL_REFERENCE_TYPES.includes(r.a.assetType);
    if (!isolatedOk) continue;
    const ref: PackReference = {
      assetId: r.a.id,
      versionId: r.v.id,
      title: r.a.title,
      designation: r.a.designation,
      assetType: r.a.assetType,
      mediaKind: r.a.mediaKind,
      viewAngle: r.a.viewAngle,
      characterIds: linked,
      storageKey: r.v.storageKey,
      thumbnailKey: r.v.thumbnailKey,
      mimeType: r.v.mimeType,
      analysisSummary: r.a.analysisReviewed ? (r.a.analysis?.description ?? null) : null,
    };
    if (r.a.designation === "style_inspiration") styleInspiration.push(ref);
    else if (r.a.approvalState === "approved") references.push(ref);
  }
  // Masters first, then by view angle so the most identity-defining images lead.
  const angleRank = (a: string | null) => ["front", "three_quarter", "side", "face_closeup", "rear", "expression", "pose"].indexOf(a ?? "") + 1 || 99;
  references.sort((a, b) => (a.designation === b.designation ? angleRank(a.viewAngle) - angleRank(b.viewAngle) : a.designation === "official_master" ? -1 : 1));
  for (const c of characters) {
    if (!references.some((r) => r.characterIds.includes(c.id) && r.mediaKind === "image")) warnings.push(`${c.name} has no approved image reference – visual generation will be blocked for them.`);
  }

  // 3. Official canon records (global, or about this cast).
  const canonRows = await db
    .select()
    .from(schema.canonRecords)
    .where(and(eq(schema.canonRecords.orgId, orgId), eq(schema.canonRecords.canonStatus, "official"), eq(schema.canonRecords.superseded, false)));
  const canon = canonRows
    .filter((r) => !r.characterIds.length || r.characterIds.some((c) => want.includes(c)))
    .map((r) => ({ id: r.id, domain: r.domain, kind: r.kind, title: r.title, version: r.version, body: r.body }));
  if (!canon.some((c) => c.domain === "brand")) warnings.push("No official brand canon (tone, values, safety) has been approved yet.");

  // 4. Creative rules and relevant decisions.
  const decisionRows = await db
    .select()
    .from(schema.creativeDecisions)
    .where(and(eq(schema.creativeDecisions.orgId, orgId), eq(schema.creativeDecisions.active, true)))
    .orderBy(sql`${schema.creativeDecisions.createdAt} desc`)
    .limit(400);
  const relevant = decisionRows.filter((d) => (!d.characterIds.length || d.characterIds.some((c) => want.includes(c))) && (!d.department || !opts.department || d.department === opts.department));
  const rules = relevant.filter((d) => d.isRule).map((d) => ({ id: d.id, summary: d.summary, detail: d.detail }));
  const decisions = relevant.filter((d) => !d.isRule).slice(0, 25).map((d) => ({ id: d.id, kind: d.kind, summary: d.summary }));

  // 5. Supporting semantic retrieval (approved sources only), lexical fallback.
  let semantic: ContextPack["semantic"] = { mode: "unavailable", hits: [] };
  if (opts.query) {
    try {
      semantic = await semanticSearch(orgId, opts.query, 6);
    } catch {
      semantic = { mode: "unavailable", hits: [] };
    }
    if (semantic.mode === "unavailable") {
      const terms = opts.query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
      const hits = canonRows
        .map((r) => ({ sourceType: "canon_record", sourceId: r.id, text: `${r.title}: ${r.body.slice(0, 400)}`, score: terms.filter((t) => `${r.title} ${r.body}`.toLowerCase().includes(t)).length / Math.max(1, terms.length) }))
        .filter((h) => h.score > 0 && !canon.some((c) => c.id === h.sourceId))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);
      semantic = { mode: "lexical", hits };
    }
  }

  return { builtAt: new Date().toISOString(), characters, missingCanon, references, styleInspiration, canon, rules, decisions, semantic, warnings };
}

/** Render the pack as the stable canon block given to text agents. */
export function packToPrompt(pack: ContextPack): string {
  const parts: string[] = ["=== CALMLINGS APPROVED CANON (source of truth – do not contradict, do not invent beyond it) ==="];
  if (pack.characters.length) parts.push(pack.characters.map((c) => c.text + (c.locked ? `\n[CHARACTER LOCK ON: ${c.lockedFields.join(", ") || "all listed"} must not change]` : "")).join("\n\n"));
  if (pack.missingCanon.length) parts.push(`CHARACTERS WITHOUT APPROVED CANON: ${pack.missingCanon.map((m) => m.name).join(", ")}. Do not describe their appearance or personality; mark anything about them as a PROPOSAL needing approval.`);
  for (const domain of ["brand", "world", "lore", "production"]) {
    const rows = pack.canon.filter((c) => c.domain === domain);
    if (rows.length) parts.push(`${domain.toUpperCase()} CANON:\n${rows.map((r) => `- ${r.title} (${r.kind}, v${r.version}): ${r.body}`).join("\n")}`);
  }
  if (pack.references.length) parts.push(`APPROVED REFERENCES AVAILABLE: ${pack.references.map((r) => `${r.title} [${r.designation}${r.viewAngle ? `, ${r.viewAngle}` : ""}]${r.analysisSummary ? ` – ${r.analysisSummary}` : ""}`).join("; ")}`);
  if (pack.styleInspiration.length) parts.push(`STYLE INSPIRATION ONLY (not canon – never copy identity from these): ${pack.styleInspiration.map((r) => r.title).join("; ")}`);
  if (pack.rules.length) parts.push(`CREATIVE DIRECTOR RULES (always follow):\n${pack.rules.map((r) => `- ${r.summary}${r.detail ? ` – ${r.detail}` : ""}`).join("\n")}`);
  if (pack.decisions.length) parts.push(`RECENT CREATIVE DECISIONS (learn from these):\n${pack.decisions.map((d) => `- [${d.kind}] ${d.summary}`).join("\n")}`);
  if (pack.semantic.hits.length) parts.push(`RELATED APPROVED MATERIAL (${pack.semantic.mode} retrieval):\n${pack.semantic.hits.map((h) => `- ${h.text.slice(0, 400)}`).join("\n")}`);
  if (pack.warnings.length) parts.push(`GAPS: ${pack.warnings.join(" ")}`);
  parts.push("=== END CANON ===");
  return parts.join("\n\n");
}

export function packProvenance(pack: ContextPack) {
  return {
    referenceAssetVersionIds: pack.references.map((r) => r.versionId),
    characterVersionIds: pack.characters.map((c) => c.versionId),
    canonRecordIds: pack.canon.map((c) => c.id),
    decisionIds: [...pack.rules.map((r) => r.id), ...pack.decisions.map((d) => d.id)],
  };
}

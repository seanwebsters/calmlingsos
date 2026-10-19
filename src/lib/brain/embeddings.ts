import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { newId } from "@/lib/ids";
import { capabilityAvailable, embed } from "@/lib/providers/gateway";
import { profileToText } from "./profile";

/** Text for an approved knowledge source, or null if it isn't approved canon. */
async function sourceText(orgId: string, type: string, id: string): Promise<string | null> {
  const db = await getDb();
  if (type === "canon_record") {
    const [r] = await db.select().from(schema.canonRecords).where(and(eq(schema.canonRecords.orgId, orgId), eq(schema.canonRecords.id, id)));
    return r && r.canonStatus === "official" ? `${r.domain}/${r.kind}: ${r.title}\n${r.body}` : null;
  }
  if (type === "character_version") {
    const [v] = await db
      .select({ v: schema.characterVersions, c: schema.characters })
      .from(schema.characterVersions)
      .innerJoin(schema.characters, eq(schema.characters.id, schema.characterVersions.characterId))
      .where(and(eq(schema.characters.orgId, orgId), eq(schema.characterVersions.id, id)));
    return v && v.v.status === "approved" ? profileToText(v.c.code, v.v.profile, v.v.version) : null;
  }
  if (type === "reference_asset") {
    const [a] = await db.select().from(schema.referenceAssets).where(and(eq(schema.referenceAssets.orgId, orgId), eq(schema.referenceAssets.id, id)));
    if (!a || a.approvalState !== "approved" || !a.analysisReviewed) return null;
    return [a.title, a.notes, a.analysis?.description, ...(a.analysis?.consistencyRules ?? [])].filter(Boolean).join("\n");
  }
  if (type === "decision") {
    const [d] = await db.select().from(schema.creativeDecisions).where(and(eq(schema.creativeDecisions.orgId, orgId), eq(schema.creativeDecisions.id, id)));
    return d && d.active ? `${d.kind}: ${d.summary}\n${d.detail}` : null;
  }
  return null;
}

function chunk(text: string, size = 1200): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

/**
 * (Re)index one approved source. Without an embeddings provider this is a
 * no-op and retrieval falls back to lexical matching – reported in the UI.
 */
export async function indexSource(orgId: string, type: string, id: string): Promise<"indexed" | "skipped" | "removed"> {
  const db = await getDb();
  await db.delete(schema.embeddings).where(and(eq(schema.embeddings.orgId, orgId), eq(schema.embeddings.sourceType, type), eq(schema.embeddings.sourceId, id)));
  const text = await sourceText(orgId, type, id);
  if (!text) return "removed";
  const avail = await capabilityAvailable(orgId, "embeddings");
  if (!avail.ok) return "skipped";
  const chunks = chunk(text);
  const res = await embed({ orgId }, { texts: chunks });
  await db.insert(schema.embeddings).values(chunks.map((t, i) => ({ id: newId("emb"), orgId, sourceType: type, sourceId: id, text: t, vector: res.vectors[i], model: res.model })));
  return "indexed";
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function semanticSearch(orgId: string, query: string, limit = 8): Promise<{ mode: "semantic" | "unavailable"; hits: { sourceType: string; sourceId: string; text: string; score: number }[] }> {
  const avail = await capabilityAvailable(orgId, "embeddings");
  if (!avail.ok || !query.trim()) return { mode: "unavailable", hits: [] };
  const db = await getDb();
  const rows = await db.select().from(schema.embeddings).where(eq(schema.embeddings.orgId, orgId));
  if (!rows.length) return { mode: "semantic", hits: [] };
  const { vectors } = await embed({ orgId }, { texts: [query] });
  const q = vectors[0];
  const best = new Map<string, { sourceType: string; sourceId: string; text: string; score: number }>();
  for (const r of rows) {
    const score = cosine(q, r.vector);
    const k = `${r.sourceType}:${r.sourceId}`;
    if (!best.has(k) || best.get(k)!.score < score) best.set(k, { sourceType: r.sourceType, sourceId: r.sourceId, text: r.text, score });
  }
  return { mode: "semantic", hits: [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit) };
}

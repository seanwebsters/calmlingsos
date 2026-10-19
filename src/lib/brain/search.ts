import "server-only";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { semanticSearch } from "./embeddings";

export async function searchAll(orgId: string, q: string) {
  if (q.trim().length < 2) return { hits: [], semantic: "off" };
  const db = await getDb();
  const like = `%${q.trim()}%`;
  const [chars, refs, canon, prods, decisions] = await Promise.all([
    db.select().from(schema.characters).where(and(eq(schema.characters.orgId, orgId), or(ilike(schema.characters.name, like), ilike(schema.characters.code, like), ilike(schema.characters.summary, like)))).limit(6),
    db.select().from(schema.referenceAssets).where(and(eq(schema.referenceAssets.orgId, orgId), isNull(schema.referenceAssets.deletedAt), or(ilike(schema.referenceAssets.title, like), ilike(schema.referenceAssets.notes, like)))).limit(6),
    db.select().from(schema.canonRecords).where(and(eq(schema.canonRecords.orgId, orgId), eq(schema.canonRecords.superseded, false), or(ilike(schema.canonRecords.title, like), ilike(schema.canonRecords.body, like)))).limit(6),
    db.select().from(schema.productions).where(and(eq(schema.productions.orgId, orgId), ilike(schema.productions.title, like))).limit(6),
    db.select().from(schema.creativeDecisions).where(and(eq(schema.creativeDecisions.orgId, orgId), or(ilike(schema.creativeDecisions.summary, like), ilike(schema.creativeDecisions.detail, like)))).limit(4),
  ]);
  const hits = [
    ...chars.map((c) => ({ type: "character", id: c.id, title: c.name, sub: `${c.code} · ${c.canonStatus}`, href: `/characters/${c.id}` })),
    ...refs.map((r) => ({ type: "reference", id: r.id, title: r.title, sub: `${r.designation.replace(/_/g, " ")} · ${r.assetType.replace(/_/g, " ")}`, href: `/references/${r.id}` })),
    ...canon.map((c) => ({ type: c.domain, id: c.id, title: c.title, sub: `${c.kind} · ${c.canonStatus} v${c.version}`, href: `/canon?record=${c.id}` })),
    ...prods.map((p) => ({ type: "production", id: p.id, title: p.title, sub: `${p.department} · ${p.status}`, href: `/productions/${p.id}` })),
    ...decisions.map((d) => ({ type: "decision", id: d.id, title: d.summary, sub: d.kind, href: `/analytics?tab=decisions&q=${encodeURIComponent(q)}` })),
  ];
  let semantic = "off";
  try {
    const s = await semanticSearch(orgId, q, 5);
    if (s.mode === "semantic") {
      semantic = "semantic";
      for (const h of s.hits) if (!hits.some((x) => x.id === h.sourceId)) hits.push({ type: h.sourceType.replace("_", " "), id: h.sourceId, title: h.text.split("\n")[0].slice(0, 80), sub: `semantic match ${(h.score * 100).toFixed(0)}%`, href: h.sourceType === "canon_record" ? `/canon?record=${h.sourceId}` : h.sourceType === "reference_asset" ? `/references/${h.sourceId}` : "/characters" });
    }
  } catch {
    semantic = "off";
  }
  return { hits: hits.slice(0, 16), semantic };
}

import "server-only";
import type { ContextPack, PackReference } from "@/lib/brain/context";
import { packProvenance } from "@/lib/brain/context";
import { getStorage } from "@/lib/storage";
import { visionCopy } from "@/lib/files/media";
import { IntegrationRequiredError } from "@/lib/errors";
import type { Provenance } from "@/db/schema";
import type { BinaryInput } from "@/lib/providers/types";
import { PROMPT_VERSION } from "@/lib/agents/run";
import type { StepCtx } from "../runtime";

/** Map agent-supplied character codes/names to cast ids. Unknown names are dropped (never invented). */
export function resolveCharacters(pack: ContextPack, names: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    const k = n.trim().toLowerCase();
    const c = pack.characters.find((x) => x.code.toLowerCase() === k || x.name.toLowerCase() === k || x.id === n);
    if (c) out.add(c.id);
  }
  return [...out];
}

export function castLine(pack: ContextPack): string {
  if (!pack.characters.length) return "Cast: none specified (do not feature existing Calmlings characters unless named in canon).";
  return `Cast (use ONLY these, by code): ${pack.characters.map((c) => `${c.code} = ${c.name}`).join("; ")}`;
}

export function revisionBlock(ctx: StepCtx): string {
  if (!ctx.notes) return "";
  const prev = ctx.step.output ? JSON.stringify(stripInternal(ctx.step.output)).slice(0, 12000) : "";
  return `\n\nREVISION NOTES FROM THE CREATIVE DIRECTOR (address every point):\n${ctx.notes}${prev ? `\n\nYOUR PREVIOUS OUTPUT (revise it, keep what wasn't criticised):\n${prev}` : ""}`;
}

export function stripInternal(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_") && k !== "pack"));
}

export function briefLines(brief: Record<string, unknown>): string {
  return Object.entries(brief)
    .filter(([, v]) => v !== "" && v !== null && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}

/** Approved image references for exactly these characters (isolation enforced by the pack). */
export function imageRefsFor(pack: ContextPack, characterIds: string[], max = 4): PackReference[] {
  const refs: PackReference[] = [];
  for (const cid of characterIds) {
    const mine = pack.references.filter((r) => r.mediaKind === "image" && r.characterIds.includes(cid) && r.characterIds.every((c) => characterIds.includes(c)));
    refs.push(...mine.slice(0, Math.max(1, Math.floor(max / Math.max(1, characterIds.length)))));
  }
  return refs.slice(0, max);
}

export async function loadRefs(refs: PackReference[], pack: ContextPack): Promise<BinaryInput[]> {
  const out: BinaryInput[] = [];
  for (const r of refs) {
    const buf = await getStorage().get(r.storageKey);
    if (!buf) continue;
    const copy = r.mimeType === "image/svg+xml" || r.mimeType === "image/gif" || buf.length > 3_500_000 ? await visionCopy(buf) : { data: buf, mimeType: r.mimeType };
    const names = r.characterIds.map((id) => pack.characters.find((c) => c.id === id)?.name ?? id).join(" & ");
    out.push({ ...copy, label: `${r.designation === "official_master" ? "OFFICIAL MASTER" : "approved"} reference of ${names || "the world"}${r.viewAngle ? ` (${r.viewAngle})` : ""}` });
  }
  return out;
}

/** Require approved image references for every character that appears. */
export function requireRefs(pack: ContextPack, characterIds: string[]) {
  for (const cid of characterIds) {
    if (!pack.references.some((r) => r.mediaKind === "image" && r.characterIds.includes(cid))) {
      const name = pack.characters.find((c) => c.id === cid)?.name ?? cid;
      throw new IntegrationRequiredError(`reference:${cid}`, `${name} has no approved image reference. Upload one in the Reference Library and mark it as an Official Master or Approved Supporting reference, then retry.`, `/characters/${cid}`);
    }
  }
  for (const m of pack.missingCanon) {
    if (characterIds.includes(m.id)) throw new IntegrationRequiredError(`canon:${m.id}`, `${m.name} has no approved profile. Approve a profile version in Character Universe before generating them.`, `/characters/${m.id}`);
  }
}

export function identityPrompt(pack: ContextPack, characterIds: string[]): string {
  const cs = pack.characters.filter((c) => characterIds.includes(c.id));
  if (!cs.length) return "";
  return `\nCHARACTER IDENTITY: match the attached reference images exactly – same silhouette, proportions, colours, facial features, eye placement, mouth treatment and surface finish. Do not redesign or restyle them. ${cs.map((c) => `${c.name}: colours ${c.colours.join(", ") || "as in references"}.`).join(" ")}`;
}

export function provenanceFor(ctx: StepCtx, refs: PackReference[], extra: Partial<Provenance>): Provenance {
  const p = packProvenance(ctx.pack);
  return {
    referenceAssetVersionIds: refs.map((r) => r.versionId),
    characterVersionIds: p.characterVersionIds,
    canonRecordIds: p.canonRecordIds,
    decisionIds: p.decisionIds,
    provider: null,
    model: null,
    promptVersion: PROMPT_VERSION,
    prompt: null,
    parameters: {},
    generatedAt: new Date().toISOString(),
    ...extra,
  };
}

export function docToMarkdown(d: { title: string; summary: string; sections: { heading: string; body: string }[]; assumptions?: string[]; openQuestions?: string[] }): string {
  return [
    `# ${d.title}`,
    d.summary,
    ...d.sections.map((s) => `## ${s.heading}\n\n${s.body}`),
    d.assumptions?.length ? `## Assumptions (estimates – verify)\n\n${d.assumptions.map((a) => `- ${a}`).join("\n")}` : "",
    d.openQuestions?.length ? `## Open questions\n\n${d.openQuestions.map((a) => `- ${a}`).join("\n")}` : "",
    "\n---\n_Draft generated by CALMLINGS OS agents. Not approved canon until a human approves it._",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function deckToMarkdown(d: { title: string; slides: { title: string; bullets: string[]; visualNote: string; speakerNotes: string }[]; assumptions: string[] }): string {
  return [
    `# ${d.title}`,
    ...d.slides.map((s, i) => `## ${i + 1}. ${s.title}\n\n${s.bullets.map((b) => `- ${b}`).join("\n")}\n\n_Visual:_ ${s.visualNote}\n\n> Speaker notes: ${s.speakerNotes}`),
    d.assumptions.length ? `## Assumptions (estimates – verify)\n\n${d.assumptions.map((a) => `- ${a}`).join("\n")}` : "",
    "\n---\n_Internal draft. Do not share externally without approval._",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export const ASPECT_FOR_PLATFORM: Record<string, "9:16" | "16:9" | "1:1"> = { tiktok: "9:16", instagram_reels: "9:16", youtube_shorts: "9:16", youtube: "16:9", square: "1:1" };

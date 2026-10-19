import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { GameAssetSpec } from "@/db/schema";
import { newId, characterCode } from "@/lib/ids";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { buildContextPack } from "@/lib/brain/context";
import { createCanon } from "@/lib/brain/canon";
import { saveProfile } from "@/lib/brain/characters";
import { emptyProfile } from "@/lib/brain/profile";
import { getStorage, orgKey } from "@/lib/storage";
import { sha256 } from "@/lib/crypto";
import { createGeneratedAsset, emptyProvenance, strToU8, zipSync } from "@/lib/review/assets";
import { expectedName, processToSpec, spriteSheet, validateGameAsset } from "@/lib/game/validate";
import type { Out } from "../schemas";
import type { StepCtx, StepResult } from "../runtime";
import { agentTask } from "./agent";
import { resolveCharacters } from "./common";

export async function canonRetrieval(ctx: StepCtx): Promise<StepResult> {
  const query = [ctx.brief.theme, ctx.brief.request, ctx.brief.emotionalMessage, ctx.brief.notes].filter(Boolean).join(" ");
  const pack = await buildContextPack(ctx.orgId, { characterIds: ctx.production.characterIds, department: ctx.production.department, query, includeStyleInspiration: Boolean(ctx.step.config.includeStyleInspiration) });
  const db = await getDb();
  const summary = { characters: pack.characters.map((c) => ({ id: c.id, name: c.name, version: c.version })), references: pack.references.length, styleInspiration: pack.styleInspiration.length, canonRecords: pack.canon.length, rules: pack.rules.length, retrieval: pack.semantic.mode, warnings: pack.warnings };
  await db.update(schema.productions).set({ contextSnapshot: { ...summary, builtAt: pack.builtAt, characterVersionIds: pack.characters.map((c) => c.versionId), referenceVersionIds: pack.references.map((r) => r.versionId), canonRecordIds: pack.canon.map((c) => c.id) } }).where(eq(schema.productions.id, ctx.production.id));
  return { output: { pack, summary } };
}

export async function gameValidate(ctx: StepCtx): Promise<StepResult> {
  const db = await getDb();
  const render = ctx.steps.find((s) => s.key === "render");
  if (!render) throw new AppError("No render step.");
  const b = ctx.brief;
  const spec: GameAssetSpec = {
    targetEngine: String(b.targetEngine),
    category: String(b.category),
    width: Number(b.width),
    height: Number(b.height),
    aspectRatio: `${b.width}:${b.height}`,
    transparency: Boolean(b.transparency),
    fileFormat: b.fileFormat as GameAssetSpec["fileFormat"],
    animation: { frames: Number(b.frames), fps: Number(b.fps), layout: Number(b.frames) > 1 ? "horizontal" : "none" },
    colourSpace: "srgb",
    namingPattern: String(b.namingPattern),
    targetPlatform: String(b.targetPlatform),
    maxFileKb: Number(b.maxFileKb),
  };
  const sources = (await db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.stepId, render.id), eq(schema.generatedAssets.kind, "image")))).filter((a) => a.provenance.parameters?.generation === render.generation && a.status !== "rejected");
  const items = ((ctx.outputs.concepts as Out<"visualItems"> | undefined)?.items ?? []).map((i) => ({ ...i, characterIds: resolveCharacters(ctx.pack, i.characters) }));
  const results = [];
  const groups = spec.animation.frames > 1 ? [sources] : sources.map((s) => [s]);
  for (const group of groups) {
    const first = group[0];
    if (!first) continue;
    const item = items.find((i) => `item:${i.id}` === first.itemKey);
    const name = spec.animation.frames > 1 ? `${ctx.production.title} sheet` : (item?.name ?? first.title);
    const buffers = await Promise.all(group.map(async (g) => (await getStorage().get(g.storageKey!))!));
    const processed = spec.animation.frames > 1 ? (await spriteSheet(await Promise.all(buffers.map((x) => processToSpec(x, { ...spec, animation: { ...spec.animation, frames: 1, layout: "none" } }))), spec)).data : await processToSpec(buffers[0], spec);
    const fileName = `${expectedName(spec, name)}.${spec.fileFormat === "jpeg" ? "jpg" : spec.fileFormat}`;
    const validation = await validateGameAsset(processed, spec, fileName, { name, category: spec.category, frames: group.length });
    const id = newId("gam");
    const key = orgKey(ctx.orgId, "game", id, fileName);
    await getStorage().put(key, processed, spec.fileFormat === "png" ? "image/png" : spec.fileFormat === "webp" ? "image/webp" : "image/jpeg");
    await db.insert(schema.gameAssets).values({ id, orgId: ctx.orgId, productionId: ctx.production.id, name: fileName, collection: String(b.collection ?? "Unsorted"), spec, status: validation.passed ? "technically_validated" : "validation_failed", sourceGeneratedAssetId: first.id, storageKey: key, validation: { checkedAt: new Date().toISOString(), ...validation }, characterIds: item?.characterIds ?? first.characterIds });
    await createGeneratedAsset({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id, itemKey: `game:${first.itemKey}`, kind: "image", role: "game_asset", title: `${fileName}${validation.passed ? "" : " (FAILED technical validation)"}`, data: processed, mimeType: spec.fileFormat === "png" ? "image/png" : spec.fileFormat === "webp" ? "image/webp" : "image/jpeg", characterIds: first.characterIds, parentId: null, provenance: { ...first.provenance, provider: "local-validator", generatedAt: new Date().toISOString(), parameters: { ...first.provenance.parameters, generation: ctx.step.generation, gameAssetId: id, spec, validation, sourceAssetIds: group.map((g) => g.id) } } });
    results.push({ gameAssetId: id, fileName, passed: validation.passed, failed: validation.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`) });
  }
  return { output: { results, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, note: "Only technically validated assets are game-ready. Concepts that fail stay concept art." } };
}

export async function productCosts(ctx: StepCtx): Promise<StepResult> {
  const res = await agentTask(ctx);
  const model = res.output as unknown as Out<"costModel">;
  const products = (ctx.outputs.concepts as Out<"products"> | undefined)?.products ?? [];
  const packaging = (ctx.outputs.packaging as Out<"packaging"> | undefined)?.concepts ?? [];
  const feasibility = (ctx.outputs.feasibility as Out<"feasibility"> | undefined)?.products ?? [];
  const db = await getDb();
  const persisted: string[] = [];
  for (const p of products) {
    const c = model.products.find((x) => x.productId === p.id);
    const unit = Math.round((c?.estUnitCostUsd ?? 0) * 100);
    const retail = Math.round((c?.targetRetailUsd ?? 0) * 100);
    const wholesale = Math.round((c?.wholesaleUsd ?? 0) * 100);
    const scenarios = [
      { label: "Estimate – direct-to-consumer", unitCostCents: unit, retailCents: retail, wholesaleCents: retail, marginPct: retail ? Math.round(((retail - unit) / retail) * 1000) / 10 : 0 },
      { label: "Estimate – wholesale", unitCostCents: unit, retailCents: retail, wholesaleCents: wholesale, marginPct: wholesale ? Math.round(((wholesale - unit) / wholesale) * 1000) / 10 : 0 },
      { label: "Estimate – unit cost +20% (risk)", unitCostCents: Math.round(unit * 1.2), retailCents: retail, wholesaleCents: wholesale, marginPct: wholesale ? Math.round(((wholesale - unit * 1.2) / wholesale) * 1000) / 10 : 0 },
    ];
    const lineageKey = `${ctx.production.id}:${p.id}`;
    const [prev] = await db.select().from(schema.productConcepts).where(and(eq(schema.productConcepts.orgId, ctx.orgId), eq(schema.productConcepts.lineageId, lineageKey))).orderBy(desc(schema.productConcepts.iteration)).limit(1);
    const id = newId("pdc");
    await db.insert(schema.productConcepts).values({
      id,
      orgId: ctx.orgId,
      productionId: ctx.production.id,
      lineageId: lineageKey,
      iteration: (prev?.iteration ?? 0) + 1,
      rangeName: (ctx.outputs.concepts as Out<"products"> | undefined)?.rangeName ?? (String(ctx.brief.rangeName ?? "") || null),
      name: p.name,
      category: p.category,
      characterIds: resolveCharacters(ctx.pack, p.characters),
      description: p.description,
      materials: p.materials,
      dimensions: p.dimensions,
      packaging: packaging.find((x) => x.productId === p.id)?.concept ?? "",
      targetAudience: p.targetAudience,
      targetRetailCents: retail || null,
      estUnitCostCents: unit || null,
      moqAssumption: c?.moqAssumption ?? null,
      marginScenarios: scenarios,
      feasibilityRisks: feasibility.find((x) => x.productId === p.id)?.risks ?? [],
      licensingOpportunities: [],
      quoteVerified: false,
      status: "ready_for_review",
    });
    persisted.push(id);
  }
  return { output: { ...res.output, productConceptIds: persisted, estimatesNote: "All commercial figures are ESTIMATES until backed by supplier quotes." } };
}

export async function loreProposals(ctx: StepCtx): Promise<StepResult> {
  const res = await agentTask(ctx);
  const data = res.output as unknown as Out<"loreProposals">;
  const ids: string[] = [];
  for (const p of data.proposals) {
    ids.push(await createCanon({ orgId: ctx.orgId, userId: null, agentKey: ctx.step.agentKey ?? "worldbuilding_director" }, { domain: p.domain, kind: p.kind, title: p.title, body: p.body, characterIds: resolveCharacters(ctx.pack, p.characters), timelineOrder: p.timelineOrder, data: { productionId: ctx.production.id } }));
  }
  return { output: { ...res.output, canonRecordIds: ids, note: "Saved as DRAFT CANON (AI proposals). Only an authorised human can approve them." } };
}

export async function campaignSchedule(ctx: StepCtx): Promise<StepResult> {
  const c = ctx.outputs.strategy as Out<"campaign"> | undefined;
  if (!c) throw new AppError("No campaign strategy.");
  const db = await getDb();
  const existing = await db.select().from(schema.campaigns).where(eq(schema.campaigns.productionId, ctx.production.id));
  if (existing.length) return { output: { campaignId: existing[0].id, reused: true } };
  const start = ctx.production.dueDate ?? new Date(Date.now() + 7 * 86400_000);
  const campaignId = newId("cmp");
  await db.insert(schema.campaigns).values({ id: campaignId, orgId: ctx.orgId, productionId: ctx.production.id, name: c.name, objective: c.objective, status: "proposed", startsOn: start, endsOn: new Date(start.getTime() + Math.max(0, ...c.schedule.map((s) => s.dayOffset)) * 86400_000), data: c as unknown as Record<string, unknown> });
  for (const s of c.schedule) await db.insert(schema.calendarItems).values({ id: newId("cal"), orgId: ctx.orgId, title: `${c.name}: ${s.title}`, kind: "publish", date: new Date(start.getTime() + s.dayOffset * 86400_000), productionId: ctx.production.id, platform: s.channel, status: "proposed", notes: "Proposed by Marketing Campaign Planner. Nothing is published automatically." });
  return { output: { campaignId, scheduled: c.schedule.length } };
}

/** Add an approved new-character package to the library as a DRAFT with a pending AI-proposal profile. */
export async function characterPromote(ctx: StepCtx): Promise<StepResult> {
  if (ctx.outputs.promote_done) return { output: ctx.outputs.promote_done };
  const concept = ctx.outputs.concept as Out<"characterConcept"> | undefined;
  if (!concept) throw new AppError("No concept.");
  const db = await getDb();
  const name = concept.name.trim();
  let code = characterCode(name);
  const [clash] = await db.select().from(schema.characters).where(and(eq(schema.characters.orgId, ctx.orgId), eq(schema.characters.code, code)));
  if (clash) code = `${code}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const id = newId("chr");
  await db.insert(schema.characters).values({ id, orgId: ctx.orgId, code, name, canonStatus: "ai_proposal", summary: concept.oneLiner });
  await db.insert(schema.characterVersions).values({ id: newId("chv"), characterId: id, version: 1, profile: emptyProfile(name), status: "draft", source: "human", changeNote: "Created from New Character pipeline" });
  const profile = { ...emptyProfile(name), approvedDescription: concept.oneLiner, personality: concept.personality, emotionalPurpose: concept.emotionalPurpose, appearance: concept.appearance, colours: concept.colours.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex)), silhouette: concept.silhouette, backstory: concept.backstory, relationships: concept.relationships.map((r) => ({ characterId: resolveCharacters(ctx.pack, [r.character])[0] ?? r.character, nature: r.nature })) };
  await saveProfile({ orgId: ctx.orgId, userId: null, agentKey: "character_writer" }, id, profile, `AI proposal from production ${ctx.production.title}`);
  // Approved design images become EXPERIMENTAL references – never canon until a human designates them.
  const designSteps = ctx.steps.filter((s) => ["turnaround", "expressions", "explorations"].includes(s.key)).map((s) => s.id);
  const images = (await db.select().from(schema.generatedAssets).where(inArray(schema.generatedAssets.stepId, designSteps))).filter((a) => a.status === "approved" && a.storageKey);
  const refIds: string[] = [];
  for (const img of images) {
    const data = await getStorage().get(img.storageKey!);
    if (!data) continue;
    const refId = newId("ref");
    const vId = newId("rfv");
    const key = orgKey(ctx.orgId, "references", refId, `v1.${img.storageKey!.split(".").pop()}`);
    await getStorage().put(key, data, img.mimeType ?? "image/png");
    await db.insert(schema.referenceAssets).values({ id: refId, orgId: ctx.orgId, title: img.title, assetType: img.role === "expression_sheet" ? "expression_sheet" : img.role === "turnaround" ? "turnaround" : "character_render", mediaKind: "image", designation: "experimental", approvalState: "pending", source: `generated:${img.id}`, rightsStatus: "owned", currentVersionId: vId, promotedFromId: img.id, notes: "AI-generated design proposal. Designate as Official Master only after creative director approval." });
    await db.insert(schema.assetVersions).values({ id: vId, assetId: refId, version: 1, storageKey: key, thumbnailKey: img.thumbnailKey, originalName: img.title, mimeType: img.mimeType ?? "image/png", sizeBytes: data.length, sha256: sha256(data) });
    await db.insert(schema.assetCharacters).values({ assetId: refId, characterId: id });
    refIds.push(refId);
  }
  await audit({ orgId: ctx.orgId, actorAgent: "studio_director", action: "character.proposed", targetType: "character", targetId: id, data: { productionId: ctx.production.id } });
  return { output: { characterId: id, code, referenceIds: refIds, note: "Created as an AI proposal. Approve the profile in Character Universe to make it canon." } };
}

export async function exportBundle(ctx: StepCtx): Promise<StepResult> {
  const db = await getDb();
  const roles = (ctx.step.config.roles as string[] | undefined) ?? [];
  const all = await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.productionId, ctx.production.id));
  const latestByLineage = new Map<string, (typeof all)[number]>();
  for (const a of all.filter((x) => x.status === "approved" || x.status === "published")) {
    if (roles.length && !roles.includes(a.role)) continue;
    const cur = latestByLineage.get(a.lineageId);
    if (!cur || a.version > cur.version) latestByLineage.set(a.lineageId, a);
  }
  // Caption sidecars travel with their approved final cut.
  for (const a of all.filter((x) => x.role === "captions_srt")) if ([...latestByLineage.values()].some((f) => f.role === "final_cut" && f.itemKey?.slice(6) === a.itemKey?.slice(4))) latestByLineage.set(a.lineageId, a);
  const chosen = [...latestByLineage.values()];
  if (!chosen.length) throw new AppError("No approved deliverables to export. Approve them in Approvals (or the review gate) first.");
  const files: Record<string, Uint8Array> = {};
  const manifest: Record<string, unknown>[] = [];
  for (const a of chosen) {
    const safe = `${a.role}/${a.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || a.id}_v${a.version}`;
    if (a.storageKey) {
      const data = await getStorage().get(a.storageKey);
      if (data) files[`${safe}.${a.storageKey.split(".").pop()}`] = new Uint8Array(data);
    }
    if (a.textContent) files[`${safe}.${a.role === "captions_srt" ? "srt" : "md"}`] = strToU8(a.textContent);
    manifest.push({ id: a.id, title: a.title, role: a.role, version: a.version, lineageId: a.lineageId, characterIds: a.characterIds, provenance: a.provenance, consistencyScoreAdvisory: a.consistencyScore });
  }
  if (ctx.step.config.gameAssets) {
    const game = await db.select().from(schema.gameAssets).where(eq(schema.gameAssets.productionId, ctx.production.id));
    for (const g of game.filter((x) => x.status === "technically_validated" || x.status === "approved")) {
      const data = g.storageKey ? await getStorage().get(g.storageKey) : null;
      if (data) files[`game_ready/${g.name}`] = new Uint8Array(data);
      manifest.push({ gameAsset: g.name, spec: g.spec, validation: g.validation });
    }
  }
  const social = await db.select().from(schema.socialVideos).where(eq(schema.socialVideos.productionId, ctx.production.id));
  for (const v of social) if (v.captions) files[`metadata/${v.conceptId}_${v.platform}.json`] = strToU8(JSON.stringify({ title: v.title, platform: v.platform, durationSeconds: v.durationSeconds, ...v.captions }, null, 2));
  files["manifest.json"] = strToU8(JSON.stringify({ production: { id: ctx.production.id, title: ctx.production.title, template: ctx.production.templateKey, brief: ctx.brief }, canonSnapshot: ctx.production.contextSnapshot, exportedAt: new Date().toISOString(), assets: manifest }, null, 2));
  files["README.md"] = strToU8(`# ${ctx.production.title}\n\nExported from CALMLINGS OS on ${new Date().toISOString()}.\n\n- ${chosen.length} approved deliverable(s)\n- manifest.json lists provenance for every file (source references, canon versions, provider, model, prompt version, cost).\n- Commercial figures in documents are estimates unless stated otherwise.\n`);
  const zip = Buffer.from(zipSync(files));
  const bundle = await createGeneratedAsset({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id, itemKey: "bundle", kind: "bundle", role: "export_bundle", title: `${ctx.production.title} – export bundle`, data: zip, mimeType: "application/zip", status: "approved", provenance: emptyProvenance({ provider: "local", parameters: { generation: ctx.step.generation, assetIds: chosen.map((c) => c.id) } }) });
  await db.update(schema.generatedAssets).set({ status: "published", updatedAt: new Date() }).where(inArray(schema.generatedAssets.id, chosen.map((c) => c.id)));
  return { output: { bundleAssetId: bundle.id, files: Object.keys(files).length, assets: chosen.length } };
}

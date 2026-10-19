/**
 * Media generation steps. Every item is generated independently and is
 * idempotent within a step generation, so a stopped/resumed step never
 * duplicates finished items. Locked items are never regenerated. Approved
 * references for exactly the characters in frame are always attached.
 */
import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { AppError, IntegrationRequiredError, ProviderError } from "@/lib/errors";
import { generateImage, generateMusic, generateSpeech, generateText, generateVideo, capabilityAvailable } from "@/lib/providers/gateway";
import { createGeneratedAsset, type GeneratedAsset } from "@/lib/review/assets";
import { getStorage } from "@/lib/storage";
import { visionCopy } from "@/lib/files/media";
import { recordRun, getAgentConfig } from "@/lib/agents/run";
import { toProviderSchema } from "@/lib/agents/jsonschema";
import { S, type Out } from "../schemas";
import type { StepCtx, StepResult } from "../runtime";
import { ASPECT_FOR_PLATFORM, getPath, identityPrompt, imageRefsFor, loadRefs, provenanceFor, requireRefs, resolveCharacters } from "./common";
import type { ImageRequest } from "@/lib/providers/types";
import type { CharacterProfile } from "@/db/schema";

async function existingForGeneration(stepId: string, itemKey: string, generation: number): Promise<GeneratedAsset | null> {
  const db = await getDb();
  const rows = await db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.stepId, stepId), eq(schema.generatedAssets.itemKey, itemKey))).orderBy(desc(schema.generatedAssets.version));
  return rows.find((r) => r.provenance.parameters?.generation === generation) ?? null;
}

async function latestUsable(lineageId: string | null): Promise<GeneratedAsset | null> {
  if (!lineageId) return null;
  const db = await getDb();
  const rows = await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.lineageId, lineageId)).orderBy(desc(schema.generatedAssets.version));
  return rows.find((r) => r.locked) ?? rows.find((r) => r.status === "approved" || r.status === "published") ?? rows.find((r) => r.status !== "rejected") ?? null;
}

async function lockedInLineage(lineageId: string | null): Promise<GeneratedAsset | null> {
  if (!lineageId) return null;
  const db = await getDb();
  const [row] = await db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.lineageId, lineageId), eq(schema.generatedAssets.locked, true))).limit(1);
  return row ?? null;
}

async function currentShots(ctx: StepCtx) {
  const db = await getDb();
  const videos = await db.select().from(schema.socialVideos).where(eq(schema.socialVideos.productionId, ctx.production.id)).orderBy(asc(schema.socialVideos.createdAt));
  const out: { video: typeof schema.socialVideos.$inferSelect; shots: (typeof schema.shots.$inferSelect)[] }[] = [];
  for (const v of videos) {
    const [board] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.socialVideoId, v.id)).orderBy(desc(schema.storyboards.version)).limit(1);
    if (!board) continue;
    out.push({ video: v, shots: await db.select().from(schema.shots).where(eq(schema.shots.storyboardId, board.id)).orderBy(asc(schema.shots.index)) });
  }
  if (!out.length) throw new AppError("No storyboard shots exist yet – the storyboard step must complete first.");
  return out;
}

export interface ImageJob {
  itemKey: string;
  title: string;
  role: string;
  prompt: string;
  characterIds: string[];
  aspectRatio: ImageRequest["aspectRatio"];
  transparent?: boolean;
  extraRefs?: { mimeType: string; data: Buffer; label?: string }[];
  extraRefVersionIds?: string[];
  parentId?: string | null;
  allowNoRefs?: boolean;
}

/** Generate one image deliverable with identity references and full provenance. */
export async function generateImageItem(ctx: StepCtx, job: ImageJob): Promise<GeneratedAsset> {
  if (!job.allowNoRefs) requireRefs(ctx.pack, job.characterIds);
  const refs = imageRefsFor(ctx.pack, job.characterIds);
  const binaries = [...(await loadRefs(refs, ctx.pack)), ...(job.extraRefs ?? [])];
  const prompt = `${job.prompt}${identityPrompt(ctx.pack, job.characterIds)}${ctx.notes ? `\nREVISION NOTES: ${ctx.notes}` : ""}`;
  await ctx.ensureBudget(6);
  const res = await generateImage({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id }, { prompt, references: binaries, aspectRatio: job.aspectRatio, transparent: job.transparent }, ctx.route(binaries.length ? "image_edit" : "image_generation", { quality: "best" }));
  if (binaries.length && !res.supportsReferences) throw new ProviderError(res.provider, "The routed model ignores reference images, so identity can't be preserved.", false);
  return createGeneratedAsset({
    orgId: ctx.orgId,
    productionId: ctx.production.id,
    stepId: ctx.step.id,
    itemKey: job.itemKey,
    kind: "image",
    role: job.role,
    title: job.title,
    data: res.data,
    mimeType: res.mimeType,
    characterIds: job.characterIds,
    parentId: job.parentId ?? null,
    costCents: res.costCents,
    provenance: provenanceFor(ctx, refs, {
      referenceAssetVersionIds: [...refs.map((r) => r.versionId), ...(job.extraRefVersionIds ?? [])],
      provider: res.provider,
      model: res.model,
      prompt,
      parameters: { generation: ctx.step.generation, aspectRatio: job.aspectRatio, transparent: Boolean(job.transparent), regen: { kind: "image", prompt: job.prompt, characterIds: job.characterIds, aspectRatio: job.aspectRatio, transparent: Boolean(job.transparent), role: job.role } },
    }),
  });
}

/* ------------------------------------------------------------------ */

export async function shotFrames(ctx: StepCtx): Promise<StepResult> {
  const aspect = ASPECT_FOR_PLATFORM[String(ctx.brief.platform)] ?? "9:16";
  const groups = await currentShots(ctx);
  const db = await getDb();
  const made: string[] = [];
  const kept: string[] = [];
  for (const g of groups) {
    for (const shot of g.shots) {
      const itemKey = `shot:${shot.id}`;
      const locked = shot.locked ? await latestUsable(shot.frameLineageId) : await lockedInLineage(shot.frameLineageId);
      if (locked) {
        kept.push(locked.id);
        continue;
      }
      const existing = await existingForGeneration(ctx.step.id, itemKey, ctx.step.generation);
      if (existing) {
        kept.push(existing.id);
        continue;
      }
      const prev = await latestUsable(shot.frameLineageId);
      const framePrompt = shot.continuity.split("[frame]")[1]?.split("[motion]")[0]?.trim() || shot.description;
      const asset = await generateImageItem(ctx, {
        itemKey,
        title: `${g.video.title} · shot ${shot.index}`,
        role: "reference_frame",
        prompt: `Reference frame for a ${String(ctx.brief.platform)} video (${aspect}). ${framePrompt}\nCamera: ${shot.camera}. Action: ${shot.action}. Visual style: ${ctx.brief.visualStyle}. Continuity: ${shot.continuity.split("[frame]")[0]}`,
        characterIds: shot.characterIds,
        aspectRatio: aspect,
        parentId: prev?.id ?? null,
      });
      await db.update(schema.shots).set({ frameLineageId: asset.lineageId }).where(eq(schema.shots.id, shot.id));
      made.push(asset.id);
      await ctx.progress(`${made.length + kept.length} frames ready`);
    }
  }
  return { output: { generated: made, kept, count: made.length + kept.length } };
}

/** Advisory visual consistency scoring against master references. */
export async function consistencyReview(ctx: StepCtx): Promise<StepResult> {
  const avail = await capabilityAvailable(ctx.orgId, "vision", ctx.route("vision", { sendsProprietaryFiles: true }));
  if (!avail.ok) throw new IntegrationRequiredError("capability:vision", `Automated consistency review needs a vision model approved for proprietary references. ${avail.reason} You can skip this step and rely on human review.`);
  const db = await getDb();
  const src = ctx.steps.find((s) => s.key === (ctx.step.config.fromStep as string));
  if (!src) throw new AppError("No source step to review.");
  const assets = (await db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.stepId, src.id), eq(schema.generatedAssets.kind, "image")))).filter((a) => a.provenance.parameters?.generation === src.generation && a.characterIds.length);
  const db2 = await getDb();
  const versions = ctx.pack.characters.length ? await db2.select().from(schema.characterVersions).where(inArray(schema.characterVersions.id, ctx.pack.characters.map((c) => c.versionId))) : [];
  const results: { assetId: string; score: number; drift: boolean }[] = [];
  const cfg = await getAgentConfig(ctx.orgId, "visual_consistency_reviewer");
  for (const a of assets) {
    if (a.consistencyReport && a.consistencyReport.generation === src.generation) {
      results.push({ assetId: a.id, score: a.consistencyScore ?? 0, drift: Boolean(a.consistencyReport.identityDrift) });
      continue;
    }
    const refs = imageRefsFor(ctx.pack, a.characterIds, 3);
    const refBins = await loadRefs(refs, ctx.pack);
    const file = a.storageKey ? await getStorage().get(a.storageKey) : null;
    if (!file || !refBins.length) continue;
    const gen = await visionCopy(file);
    const checklist = versions
      .filter((v) => a.characterIds.includes(v.characterId))
      .flatMap((v) => (v.profile as CharacterProfile).consistencyChecklist.map((c) => `${(v.profile as CharacterProfile).officialName} – ${c.item}${c.rule ? `: ${c.rule}` : ""}`));
    await ctx.ensureBudget(3);
    const res = await generateText(
      { orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id },
      "vision",
      {
        system: cfg.instructions,
        prompt: `Compare the GENERATED image (last) with the approved references (first). Score each checklist item 0–1 and overall. identityDrift=true if any character is off-model. This is advisory only.\nChecklist:\n${checklist.join("\n") || "Silhouette, Colours, Facial geometry, Eye placement, Mouth treatment, Proportions, Surface finish, Accessory rules, Personality consistency"}`,
        images: [...refBins, { ...gen, label: "GENERATED image under review" }],
        jsonSchema: toProviderSchema(S.consistency),
        schemaName: "consistency",
        effort: "medium",
      },
      ctx.route("vision"),
    );
    let report: Out<"consistency">;
    try {
      report = S.consistency.parse(JSON.parse(res.text));
    } catch {
      throw new ProviderError(res.provider, "The consistency reviewer returned an invalid report.", true);
    }
    await db.update(schema.generatedAssets).set({ consistencyScore: report.overallScore, consistencyReport: { ...report, advisory: true, generation: src.generation, provider: res.provider, model: res.model, referenceVersionIds: refs.map((r) => r.versionId) }, updatedAt: new Date() }).where(eq(schema.generatedAssets.id, a.id));
    await recordRun({ orgId: ctx.orgId, agentKey: "visual_consistency_reviewer", task: `Consistency: ${a.title}`, productionId: ctx.production.id, stepId: ctx.step.id, output: report, status: "succeeded", provider: res.provider, model: res.model, costCents: res.costCents, referencesUsed: { assetVersionIds: refs.map((r) => r.versionId), characterVersionIds: ctx.pack.characters.map((c) => c.versionId), canonRecordIds: [], decisionIds: [] } });
    results.push({ assetId: a.id, score: report.overallScore, drift: report.identityDrift });
  }
  return { output: { reviewed: results, advisory: true, note: "Automated scores are advisory and never proof of identity consistency. Human review decides." } };
}

export async function shotVideos(ctx: StepCtx): Promise<StepResult> {
  const groups = await currentShots(ctx);
  const aspect = (ASPECT_FOR_PLATFORM[String(ctx.brief.platform)] ?? "9:16") as "9:16" | "16:9" | "1:1";
  const db = await getDb();
  const made: string[] = [];
  const kept: string[] = [];
  for (const g of groups) {
    for (const shot of g.shots) {
      const itemKey = `shot:${shot.id}`;
      const locked = shot.locked ? await latestUsable(shot.videoLineageId) : await lockedInLineage(shot.videoLineageId);
      if (locked) {
        kept.push(locked.id);
        continue;
      }
      const existing = await existingForGeneration(ctx.step.id, itemKey, ctx.step.generation);
      if (existing) {
        kept.push(existing.id);
        continue;
      }
      const frame = await latestUsable(shot.frameLineageId);
      if (!frame?.storageKey) throw new AppError(`Shot ${shot.index} of “${g.video.title}” has no reference frame. Generate and approve frames first.`);
      if (frame.status === "rejected") throw new AppError(`Shot ${shot.index}'s frame was rejected – regenerate it first.`);
      const frameData = await getStorage().get(frame.storageKey);
      if (!frameData) throw new AppError("Frame file missing from storage.");
      const motion = shot.continuity.split("[motion]")[1]?.trim() || shot.action;
      const prompt = `${motion}. ${shot.camera}. Keep every character exactly on-model as in the start frame; no redesign. ${ctx.notes ? `Revision notes: ${ctx.notes}` : ""}`;
      await ctx.ensureBudget(Math.ceil(shot.durationSeconds) * 8);
      const res = await generateVideo({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id }, { prompt, startFrame: { mimeType: frame.mimeType ?? "image/png", data: frameData, label: "approved start frame" }, durationSeconds: shot.durationSeconds, aspectRatio: aspect }, ctx.route("video_generation"));
      const prev = await latestUsable(shot.videoLineageId);
      const asset = await createGeneratedAsset({
        orgId: ctx.orgId,
        productionId: ctx.production.id,
        stepId: ctx.step.id,
        itemKey,
        kind: "video",
        role: "shot_video",
        title: `${g.video.title} · shot ${shot.index} (generated video)`,
        data: res.data,
        mimeType: res.mimeType,
        characterIds: shot.characterIds,
        parentId: prev?.id ?? null,
        durationSeconds: Number(res.units.seconds ?? shot.durationSeconds),
        costCents: res.costCents,
        provenance: provenanceFor(ctx, [], { provider: res.provider, model: res.model, prompt, parameters: { generation: ctx.step.generation, startFrameAssetId: frame.id, startFrameApproved: frame.status === "approved", aspectRatio: aspect, regen: { kind: "video", prompt, startFrameAssetId: frame.id, durationSeconds: shot.durationSeconds, aspectRatio: aspect, role: "shot_video" } }, referenceAssetVersionIds: frame.provenance.referenceAssetVersionIds }),
      });
      await db.update(schema.shots).set({ videoLineageId: asset.lineageId }).where(eq(schema.shots.id, shot.id));
      made.push(asset.id);
      await ctx.progress(`${made.length + kept.length} clips ready`);
    }
  }
  return { output: { generated: made, kept, note: "Generated video clips – not rigged or editable animation." } };
}

export async function shotVoice(ctx: StepCtx): Promise<StepResult> {
  const groups = await currentShots(ctx);
  const db = await getDb();
  const versions = ctx.pack.characters.length ? await db.select().from(schema.characterVersions).where(inArray(schema.characterVersions.id, ctx.pack.characters.map((c) => c.versionId))) : [];
  const made: string[] = [];
  const warnings: string[] = [];
  for (const g of groups) {
    for (const shot of g.shots) {
      if (!shot.dialogue.trim()) continue;
      const itemKey = `voice:${shot.id}`;
      if (shot.locked && (await latestUsable(shot.voiceLineageId))) continue;
      if (await existingForGeneration(ctx.step.id, itemKey, ctx.step.generation)) continue;
      const v = versions.find((x) => x.characterId === shot.speakerCharacterId);
      const assignment = (v?.profile as CharacterProfile | undefined)?.voiceAssignment;
      if (!shot.speakerCharacterId || !assignment) {
        warnings.push(`Shot ${shot.index} of “${g.video.title}”: ${shot.speakerCharacterId ? "speaker has no approved voice assignment" : "no speaking character"} – line not voiced.`);
        continue;
      }
      await ctx.ensureBudget(3);
      const res = await generateSpeech({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id }, { text: shot.dialogue, voiceId: assignment.voiceId, direction: (v!.profile as CharacterProfile).voice }, ctx.route("speech", { override: assignment.provider }));
      const prev = await latestUsable(shot.voiceLineageId);
      const asset = await createGeneratedAsset({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id, itemKey, kind: "audio", role: "voice_line", title: `${g.video.title} · shot ${shot.index} voice`, data: res.data, mimeType: res.mimeType, characterIds: [shot.speakerCharacterId], parentId: prev?.id ?? null, costCents: res.costCents, provenance: provenanceFor(ctx, [], { provider: res.provider, model: res.model, prompt: shot.dialogue, parameters: { generation: ctx.step.generation, voiceId: assignment.voiceId, consent: assignment.consentNote } }) });
      await db.update(schema.shots).set({ voiceLineageId: asset.lineageId }).where(eq(schema.shots.id, shot.id));
      made.push(asset.id);
    }
  }
  return { output: { generated: made, warnings } };
}

export async function musicBed(ctx: StepCtx): Promise<StepResult> {
  const itemKey = `music:${ctx.step.key}`;
  const existing = await existingForGeneration(ctx.step.id, itemKey, ctx.step.generation);
  if (existing) return { output: { assetId: existing.id } };
  const song = ctx.outputs[String(ctx.step.config.fromStep ?? "song")] as Out<"song"> | undefined;
  const seconds = song ? Math.min(120, song.structure.reduce((n, s) => n + s.seconds, 0) || 60) : Math.min(120, Number(ctx.brief.durationSeconds ?? 30));
  const prompt = song?.musicPrompt ?? `Gentle, warm, uplifting instrumental bed for a Calmlings short about "${ctx.brief.theme}". Calm, playful, no vocals.`;
  await ctx.ensureBudget(Math.ceil(seconds / 60) * 50);
  const res = await generateMusic({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id }, { prompt: prompt + (ctx.notes ? `\n${ctx.notes}` : ""), seconds }, ctx.route("music"));
  const asset = await createGeneratedAsset({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id, itemKey, kind: "audio", role: "music", title: song?.title ? `${song.title} (instrumental demo)` : `${ctx.production.title} music bed`, data: res.data, mimeType: res.mimeType, durationSeconds: seconds, costCents: res.costCents, provenance: provenanceFor(ctx, [], { provider: res.provider, model: res.model, prompt, parameters: { generation: ctx.step.generation, seconds, rights: "Generated via provider – confirm the provider's commercial licence terms before release." } }) });
  return { output: { assetId: asset.id } };
}

/** Images for a list of items (game assets, products, mockups, key visuals, poses). */
export async function itemImages(ctx: StepCtx): Promise<StepResult> {
  const from = String(ctx.step.config.fromStep);
  const src = ctx.outputs[from];
  if (!src) throw new AppError(`Step “${from}” has no output.`);
  const path = String(ctx.step.config.path ?? (Array.isArray((src as Record<string, unknown>).items) ? "items" : Array.isArray((src as Record<string, unknown>).products) ? "products" : "concepts"));
  const items = (getPath(src, path) as Record<string, unknown>[] | undefined) ?? [];
  const promptField = String(ctx.step.config.promptField ?? (path === "products" ? "renderPrompt" : "prompt"));
  const transparent = ctx.step.config.transparentFromBrief ? Boolean(ctx.brief[String(ctx.step.config.transparentFromBrief)]) : false;
  const aspect: ImageRequest["aspectRatio"] = ctx.production.templateKey === "game_asset" ? nearestAspect(Number(ctx.brief.width), Number(ctx.brief.height)) : ((ctx.brief.aspect as ImageRequest["aspectRatio"]) ?? "1:1");
  const made: string[] = [];
  const kept: string[] = [];
  for (const it of items) {
    const itemKey = `item:${String(it.id)}`;
    const existing = await existingForGeneration(ctx.step.id, itemKey, ctx.step.generation);
    if (existing) {
      kept.push(existing.id);
      continue;
    }
    const db = await getDb();
    const [prevLocked] = await db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.stepId, ctx.step.id), eq(schema.generatedAssets.itemKey, itemKey), eq(schema.generatedAssets.locked, true))).limit(1);
    if (prevLocked) {
      kept.push(prevLocked.id);
      continue;
    }
    const characterIds = resolveCharacters(ctx.pack, (it.characters as string[] | undefined) ?? []);
    const asset = await generateImageItem(ctx, {
      itemKey,
      title: String(it.name ?? it.title ?? it.id),
      role: String(ctx.step.config.role ?? "concept_image"),
      prompt: `${String(it[promptField] ?? it.description ?? it.name)}${it.description && promptField !== "description" ? `\nDescription: ${String(it.description)}` : ""}${transparent ? "\nSingle isolated subject, centred, no background scenery, transparent background." : ""}`,
      characterIds,
      aspectRatio: aspect,
      transparent,
    });
    made.push(asset.id);
    await ctx.progress(`${made.length + kept.length}/${items.length} images`);
  }
  return { output: { generated: made, kept, count: items.length } };
}

function nearestAspect(w: number, h: number): ImageRequest["aspectRatio"] {
  const r = w / h;
  const opts: [ImageRequest["aspectRatio"], number][] = [["1:1", 1], ["9:16", 9 / 16], ["16:9", 16 / 9], ["4:5", 0.8], ["3:4", 0.75], ["4:3", 4 / 3], ["2:3", 2 / 3], ["3:2", 1.5]];
  return opts.sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0][0];
}

export async function itemVideos(ctx: StepCtx): Promise<StepResult> {
  const db = await getDb();
  const src = ctx.steps.find((s) => s.key === String(ctx.step.config.fromStep));
  if (!src) throw new AppError("No frames step.");
  const frames = (await db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.stepId, src.id), eq(schema.generatedAssets.kind, "image")))).filter((a) => a.status === "approved" || a.locked);
  if (!frames.length) throw new AppError("Approve at least one frame before generating clips.");
  const made: string[] = [];
  for (const f of frames) {
    const itemKey = `clip:${f.itemKey}`;
    if (await existingForGeneration(ctx.step.id, itemKey, ctx.step.generation)) continue;
    const data = f.storageKey ? await getStorage().get(f.storageKey) : null;
    if (!data) continue;
    await ctx.ensureBudget(40);
    const prompt = `${f.title}: subtle character animation as directed; keep the character exactly on-model. ${ctx.notes ?? ""}`;
    const res = await generateVideo({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id }, { prompt, startFrame: { mimeType: f.mimeType ?? "image/png", data }, durationSeconds: 5, aspectRatio: (ctx.brief.aspect as "1:1" | "9:16" | "16:9") ?? "1:1" }, ctx.route("video_generation"));
    const a = await createGeneratedAsset({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id, itemKey, kind: "video", role: "concept_clip", title: `${f.title} (concept clip – generated video, not rigged animation)`, data: res.data, mimeType: res.mimeType, characterIds: f.characterIds, durationSeconds: 5, costCents: res.costCents, provenance: provenanceFor(ctx, [], { provider: res.provider, model: res.model, prompt, parameters: { generation: ctx.step.generation, startFrameAssetId: f.id, regen: { kind: "video", prompt, startFrameAssetId: f.id, durationSeconds: 5, aspectRatio: ctx.brief.aspect ?? "1:1", role: "concept_clip" } }, referenceAssetVersionIds: f.provenance.referenceAssetVersionIds }) });
    made.push(a.id);
  }
  return { output: { generated: made } };
}

/** New-character design work: explorations from inspiration only, then turnaround/expressions from the chosen design. */
export async function characterImages(ctx: StepCtx): Promise<StepResult> {
  const mode = String(ctx.step.config.mode);
  const concept = ctx.outputs.concept as Out<"characterConcept"> | undefined;
  if (!concept) throw new AppError("The character concept step must complete first.");
  const db = await getDb();
  if (mode === "explorations") {
    const inspirationIds = (ctx.brief.inspirationReferenceIds as string[] | undefined) ?? [];
    const inspo = [...ctx.pack.styleInspiration.filter((r) => r.mediaKind === "image"), ...(inspirationIds.length ? await refsByIds(ctx.orgId, inspirationIds) : [])].slice(0, 3);
    const extra = (await loadRefs(inspo, ctx.pack)).map((b) => ({ ...b, label: "STYLE INSPIRATION ONLY – do not copy any character identity from this image" }));
    const prompts = concept.designPrompts.slice(0, Number(ctx.brief.explorations ?? 3));
    const items: { id: string; name: string; assetId: string }[] = [];
    for (const [i, p] of prompts.entries()) {
      const itemKey = `exploration:${i}`;
      const existing = await existingForGeneration(ctx.step.id, itemKey, ctx.step.generation);
      const asset =
        existing ??
        (await generateImageItem(ctx, {
          itemKey,
          title: `${concept.name} – exploration ${i + 1}`,
          role: "character_exploration",
          prompt: `Character design exploration for a NEW, original character "${concept.name}" (proposal, not canon). ${p}\nAppearance notes: ${concept.appearance}. Silhouette: ${concept.silhouette}. Colours: ${concept.colours.map((c) => `${c.name} ${c.hex}`).join(", ")}. Full body, neutral pose, plain background.`,
          characterIds: [],
          aspectRatio: "1:1",
          extraRefs: extra,
          extraRefVersionIds: inspo.map((r) => r.versionId),
          allowNoRefs: true,
        }));
      items.push({ id: `e${i + 1}`, name: asset.title, assetId: asset.id });
    }
    return { output: { items } };
  }
  const picked = (ctx.outputs.pick?.selected as string[] | undefined)?.[0];
  const explorations = (ctx.outputs.explorations?.items as { id: string; assetId: string }[] | undefined) ?? [];
  const chosen = explorations.find((e) => e.id === picked);
  if (!chosen) throw new AppError("Select a design exploration first.");
  const [base] = await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.id, chosen.assetId));
  const data = base?.storageKey ? await getStorage().get(base.storageKey) : null;
  if (!data || !base) throw new AppError("The selected exploration file is missing.");
  const itemKey = `${mode}:0`;
  const existing = await existingForGeneration(ctx.step.id, itemKey, ctx.step.generation);
  if (existing) return { output: { assetId: existing.id } };
  const prompt =
    mode === "turnaround"
      ? `Character turnaround sheet of exactly this design (the attached selected exploration): front, three-quarter, side and back views in a row, same scale, neutral pose, plain background. Keep every design detail identical.`
      : `Expression sheet of exactly this design (the attached selected exploration): 8 expressions in a grid (calm, happy, curious, worried, sad, surprised, proud, sleepy), head and shoulders, plain background. Keep every design detail identical.`;
  const asset = await generateImageItem(ctx, { itemKey, title: `${concept.name} – ${mode}`, role: mode === "turnaround" ? "turnaround" : "expression_sheet", prompt, characterIds: [], aspectRatio: mode === "turnaround" ? "16:9" : "1:1", extraRefs: [{ mimeType: base.mimeType ?? "image/png", data, label: "SELECTED DESIGN (match exactly)" }], allowNoRefs: true });
  return { output: { assetId: asset.id, basedOn: base.id } };
}

async function refsByIds(orgId: string, ids: string[]) {
  const db = await getDb();
  const rows = await db
    .select({ a: schema.referenceAssets, v: schema.assetVersions })
    .from(schema.referenceAssets)
    .innerJoin(schema.assetVersions, eq(schema.assetVersions.id, schema.referenceAssets.currentVersionId))
    .where(and(eq(schema.referenceAssets.orgId, orgId), inArray(schema.referenceAssets.id, ids)));
  return rows
    .filter((r) => r.a.mediaKind === "image" && r.a.designation !== "rejected")
    .map((r) => ({ assetId: r.a.id, versionId: r.v.id, title: r.a.title, designation: r.a.designation, assetType: r.a.assetType, mediaKind: r.a.mediaKind, viewAngle: r.a.viewAngle, characterIds: [], storageKey: r.v.storageKey, thumbnailKey: r.v.thumbnailKey, mimeType: r.v.mimeType, analysisSummary: null }));
}

/* ------------------------------------------------------------------ */
/* Selective regeneration of a single asset (from review)              */
/* ------------------------------------------------------------------ */

export async function regenerateAssetJob(payload: { assetId: string; notes: string; requestedBy: string }) {
  const db = await getDb();
  const [asset] = await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.id, payload.assetId));
  if (!asset) return;
  const regen = asset.provenance.parameters?.regen as Record<string, unknown> | undefined;
  if (!regen) throw new AppError("This asset has no regeneration recipe.");
  const ctxCall = { orgId: asset.orgId, productionId: asset.productionId, stepId: asset.stepId };
  const [production] = asset.productionId ? await db.select().from(schema.productions).where(eq(schema.productions.id, asset.productionId)) : [];
  const override = (cap: string) => production?.providerOverrides?.[cap] ?? null;
  // Same reference versions as the original, so the comparison is fair.
  const refRows = asset.provenance.referenceAssetVersionIds.length ? await db.select().from(schema.assetVersions).where(inArray(schema.assetVersions.id, asset.provenance.referenceAssetVersionIds)) : [];
  if (regen.kind === "image") {
    const refs = [];
    for (const r of refRows.filter((x) => x.mimeType.startsWith("image/"))) {
      const b = await getStorage().get(r.storageKey);
      if (b) refs.push({ ...(b.length > 3_500_000 || r.mimeType === "image/svg+xml" ? await visionCopy(b) : { data: b, mimeType: r.mimeType }), label: "approved reference" });
    }
    const prompt = `${asset.provenance.prompt ?? regen.prompt}\nREVISION NOTES: ${payload.notes}`;
    const res = await generateImage(ctxCall, { prompt, references: refs, aspectRatio: regen.aspectRatio as ImageRequest["aspectRatio"], transparent: Boolean(regen.transparent) }, { override: override(refs.length ? "image_edit" : "image_generation"), quality: "best" });
    const next = await createGeneratedAsset({ orgId: asset.orgId, productionId: asset.productionId, stepId: asset.stepId, itemKey: asset.itemKey, kind: "image", role: asset.role, title: asset.title, data: res.data, mimeType: res.mimeType, characterIds: asset.characterIds, parentId: asset.id, costCents: res.costCents, createdBy: payload.requestedBy, provenance: { ...asset.provenance, provider: res.provider, model: res.model, prompt, generatedAt: new Date().toISOString(), parameters: { ...asset.provenance.parameters, regeneratedFrom: asset.id, notes: payload.notes } } });
    return next.id;
  }
  if (regen.kind === "video") {
    const [frame] = await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.id, String(regen.startFrameAssetId)));
    const data = frame?.storageKey ? await getStorage().get(frame.storageKey) : null;
    if (!data || !frame) throw new AppError("Start frame missing.");
    const prompt = `${regen.prompt}\nREVISION NOTES: ${payload.notes}`;
    const res = await generateVideo(ctxCall, { prompt, startFrame: { mimeType: frame.mimeType ?? "image/png", data }, durationSeconds: Number(regen.durationSeconds ?? 5), aspectRatio: regen.aspectRatio as "9:16" }, { override: override("video_generation") });
    const next = await createGeneratedAsset({ orgId: asset.orgId, productionId: asset.productionId, stepId: asset.stepId, itemKey: asset.itemKey, kind: "video", role: asset.role, title: asset.title, data: res.data, mimeType: res.mimeType, characterIds: asset.characterIds, parentId: asset.id, costCents: res.costCents, createdBy: payload.requestedBy, durationSeconds: Number(regen.durationSeconds ?? 5), provenance: { ...asset.provenance, provider: res.provider, model: res.model, prompt, generatedAt: new Date().toISOString(), parameters: { ...asset.provenance.parameters, regeneratedFrom: asset.id, notes: payload.notes } } });
    return next.id;
  }
  throw new AppError("Unsupported regeneration kind.");
}

import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { newId } from "@/lib/ids";
import { AppError } from "@/lib/errors";
import { getStorage } from "@/lib/storage";
import { keyframes, visionCopy, withTempDir } from "@/lib/files/media";
import { assemble, technicalQa, type Cue } from "@/lib/media/assemble";
import { createGeneratedAsset, type GeneratedAsset } from "@/lib/review/assets";
import { capabilityAvailable } from "@/lib/providers/gateway";
import { runAgent } from "@/lib/agents/run";
import { PLATFORMS, S, type Out } from "../schemas";
import type { StepCtx, StepResult } from "../runtime";
import { ASPECT_FOR_PLATFORM, provenanceFor } from "./common";

async function bestInLineage(lineageId: string | null): Promise<GeneratedAsset | null> {
  if (!lineageId) return null;
  const db = await getDb();
  const rows = await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.lineageId, lineageId)).orderBy(desc(schema.generatedAssets.version));
  return rows.find((r) => r.locked) ?? rows.find((r) => r.status === "approved" || r.status === "published") ?? rows.find((r) => r.status !== "rejected") ?? null;
}

export async function assembleTimeline(ctx: StepCtx): Promise<StepResult> {
  const db = await getDb();
  const aspect = ASPECT_FOR_PLATFORM[String(ctx.brief.platform)] ?? "9:16";
  const videos = await db.select().from(schema.socialVideos).where(eq(schema.socialVideos.productionId, ctx.production.id)).orderBy(asc(schema.socialVideos.createdAt));
  if (!videos.length) throw new AppError("Nothing to assemble – no storyboarded videos.");
  const musicAsset = ctx.outputs.music?.assetId ? (await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.id, String(ctx.outputs.music.assetId))))[0] : null;
  const results: { socialVideoId: string; assetId: string; mode: string; durationSec: number }[] = [];
  for (const v of videos) {
    const itemKey = `final:${v.id}`;
    const [board] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.socialVideoId, v.id)).orderBy(desc(schema.storyboards.version)).limit(1);
    const shots = board ? await db.select().from(schema.shots).where(eq(schema.shots.storyboardId, board.id)).orderBy(asc(schema.shots.index)) : [];
    if (!shots.length) continue;
    const already = (await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.stepId, ctx.step.id))).find((a) => a.itemKey === itemKey && a.provenance.parameters?.generation === ctx.step.generation);
    if (already) {
      results.push({ socialVideoId: v.id, assetId: already.id, mode: String(already.provenance.parameters.mode), durationSec: already.durationSeconds ?? 0 });
      continue;
    }
    const clips = await Promise.all(shots.map((s) => bestInLineage(s.videoLineageId)));
    const frames = await Promise.all(shots.map((s) => bestInLineage(s.frameLineageId)));
    const mode: "cut" | "animatic" = clips.every((c) => c?.storageKey) ? "cut" : "animatic";
    if (mode === "animatic" && !frames.every((f) => f?.storageKey)) throw new AppError(`“${v.title}” is missing ${frames.filter((f) => !f).length} frame(s) and ${clips.filter((c) => !c).length} clip(s). Generate them before assembly.`);
    const voices = await Promise.all(shots.map((s) => bestInLineage(s.voiceLineageId)));
    const captionsPack = v.captions as Out<"captions">["packs"][number] | null;
    const out = await withTempDir(async (dir) => {
      const items: { file: string; durationSec: number }[] = [];
      for (const [i, s] of shots.entries()) {
        const a = mode === "cut" ? clips[i]! : frames[i]!;
        const file = path.join(dir, `item${i}.${a.storageKey!.split(".").pop()}`);
        await fs.writeFile(file, (await getStorage().get(a.storageKey!))!);
        items.push({ file, durationSec: mode === "cut" ? Math.min(s.durationSeconds, a.durationSeconds ?? s.durationSeconds) : s.durationSeconds });
      }
      const starts: number[] = [];
      let t = 0;
      for (const it of items) {
        starts.push(t);
        t += it.durationSec - (items.length > 1 ? 0.4 : 0);
      }
      const voice: { file: string; start: number }[] = [];
      for (const [i, va] of voices.entries()) {
        if (!va?.storageKey) continue;
        const file = path.join(dir, `vo${i}.mp3`);
        await fs.writeFile(file, (await getStorage().get(va.storageKey))!);
        voice.push({ file, start: starts[i] + 0.2 });
      }
      let music: string | null = null;
      if (musicAsset?.storageKey) {
        music = path.join(dir, "music.mp3");
        await fs.writeFile(music, (await getStorage().get(musicAsset.storageKey))!);
      }
      const cues: Cue[] = captionsPack?.onScreenCaptions?.length
        ? captionsPack.onScreenCaptions.map((c) => ({ start: c.startSeconds, end: c.endSeconds, text: c.text }))
        : shots.flatMap((s, i) => (s.dialogue.trim() ? [{ start: starts[i] + 0.2, end: starts[i] + items[i].durationSec - 0.2, text: s.dialogue }] : []));
      const r = await assemble({ dir, mode, aspect, items, voice, music, cues, burnCaptions: Boolean(ctx.brief.burnCaptions) });
      return { video: await fs.readFile(r.video), srt: await fs.readFile(r.srt, "utf8"), vtt: await fs.readFile(r.vtt, "utf8"), durationSec: r.durationSec, meanVolumeDb: r.meanVolumeDb, cues };
    });
    const sources = [...clips, ...frames, ...voices, musicAsset].filter((x): x is GeneratedAsset => Boolean(x));
    const title = `${v.title}${mode === "animatic" ? " — ANIMATIC (storyboard frames, not generated video)" : " — final cut"}`;
    const prev = (await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.itemKey, itemKey)).orderBy(desc(schema.generatedAssets.version)))[0];
    const asset = await createGeneratedAsset({
      orgId: ctx.orgId,
      productionId: ctx.production.id,
      stepId: ctx.step.id,
      itemKey,
      kind: "video",
      role: "final_cut",
      title,
      data: out.video,
      mimeType: "video/mp4",
      durationSeconds: out.durationSec,
      characterIds: [...new Set(shots.flatMap((s) => s.characterIds))],
      parentId: prev?.id ?? null,
      provenance: provenanceFor(ctx, [], { provider: "local-ffmpeg", model: mode, prompt: null, referenceAssetVersionIds: [...new Set(sources.flatMap((s) => s.provenance.referenceAssetVersionIds))], parameters: { generation: ctx.step.generation, mode, aspect, sourceAssetIds: sources.map((s) => s.id), meanVolumeDb: out.meanVolumeDb, captionsBurned: Boolean(ctx.brief.burnCaptions) } }),
    });
    await createGeneratedAsset({ orgId: ctx.orgId, productionId: ctx.production.id, stepId: ctx.step.id, itemKey: `srt:${v.id}`, kind: "document", role: "captions_srt", title: `${v.title} captions (SRT)`, textContent: out.srt, provenance: provenanceFor(ctx, [], { provider: "local", parameters: { generation: ctx.step.generation, vtt: out.vtt } }) });
    const timelineId = newId("tml");
    await db.insert(schema.timelines).values({ id: timelineId, socialVideoId: v.id, data: { clips: shots.map((s, i) => ({ shotId: s.id, generatedAssetId: (mode === "cut" ? clips[i] : frames[i])!.id, inSeconds: 0, outSeconds: s.durationSeconds })), audio: voices.flatMap((va, i) => (va ? [{ generatedAssetId: va.id, startSeconds: i, gainDb: 0, kind: "voice" as const }] : [])), captions: out.cues.map((c) => ({ startSeconds: c.start, endSeconds: c.end, text: c.text })) }, renderAssetId: asset.id, status: "rendered" });
    await db.update(schema.socialVideos).set({ status: mode === "cut" ? "cut" : "animatic", updatedAt: new Date() }).where(eq(schema.socialVideos.id, v.id));
    results.push({ socialVideoId: v.id, assetId: asset.id, mode, durationSec: out.durationSec });
  }
  return { output: { renders: results } };
}

export async function socialQa(ctx: StepCtx): Promise<StepResult> {
  const db = await getDb();
  const renders = (ctx.outputs.assemble?.renders as { socialVideoId: string; assetId: string; mode: string }[] | undefined) ?? [];
  if (!renders.length) throw new AppError("Nothing to QA – assemble the timeline first.");
  const platform = PLATFORMS[ctx.brief.platform as keyof typeof PLATFORMS];
  const vision = await capabilityAvailable(ctx.orgId, "vision", ctx.route("vision", { sendsProprietaryFiles: true }));
  const reports = [];
  for (const r of renders) {
    const [asset] = await db.select().from(schema.generatedAssets).where(eq(schema.generatedAssets.id, r.assetId));
    if (!asset?.storageKey) continue;
    const data = (await getStorage().get(asset.storageKey))!;
    const tech = await withTempDir(async (dir) => {
      const f = path.join(dir, "final.mp4");
      await fs.writeFile(f, data);
      return technicalQa(f, { aspect: platform?.aspect ?? "9:16", maxDurationSec: platform?.maxSeconds ?? 600 });
    });
    let creative: Out<"brandCheck"> | null = null;
    let creativeNote = "";
    if (vision.ok) {
      const frames = await keyframes(data, "mp4", 3);
      const images = await Promise.all(frames.map(async (f, i) => ({ ...(await visionCopy(f.data)), label: `Keyframe ${i + 1} at ${f.atSeconds}s` })));
      const res = await runAgent({ orgId: ctx.orgId, agentKey: "qa_agent", task: `QA: ${asset.title}`, prompt: `Creative QA of this ${r.mode} for ${platform?.label}. Check brand safety, on-model characters (vs canon), readability of captions and whether it delivers the brief. Issues need concrete locations.\nBrief:\n${JSON.stringify(ctx.brief)}`, schema: S.brandCheck, pack: ctx.pack, productionId: ctx.production.id, stepId: ctx.step.id, images, capability: "vision", route: ctx.route("vision") });
      creative = res.data;
    } else creativeNote = `Creative QA by model skipped: ${vision.reason} Human review is required.`;
    await db.update(schema.generatedAssets).set({ consistencyReport: { ...(asset.consistencyReport ?? {}), qa: { technical: tech, creative, creativeNote, checkedAt: new Date().toISOString() } } }).where(eq(schema.generatedAssets.id, asset.id));
    reports.push({ assetId: asset.id, title: asset.title, mode: r.mode, technical: tech, creative, creativeNote });
  }
  return { output: { reports, passed: reports.every((r) => r.technical.passed && (r.creative?.passed ?? true)) } };
}

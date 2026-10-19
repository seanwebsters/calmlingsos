/**
 * Machine analysis of uploaded references. Results are stored separately
 * from human-entered metadata and flagged machine-generated until a human
 * reviews them. Files are only sent to providers approved for proprietary
 * references; otherwise analysis is BLOCKED with a clear reason.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MachineAnalysis } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { extractAudio, visionCopy } from "@/lib/files/media";
import { capabilityAvailable, transcribe } from "@/lib/providers/gateway";
import { IntegrationRequiredError } from "@/lib/errors";
import { runAgent } from "@/lib/agents/run";
import { S } from "@/lib/workflows/schemas";

export async function analyzeReference({ assetId, versionId }: { assetId: string; versionId: string }) {
  const db = await getDb();
  const [asset] = await db.select().from(schema.referenceAssets).where(eq(schema.referenceAssets.id, assetId));
  const [version] = await db.select().from(schema.assetVersions).where(eq(schema.assetVersions.id, versionId));
  if (!asset || !version) return;
  const set = (patch: Partial<typeof schema.referenceAssets.$inferInsert>) => db.update(schema.referenceAssets).set({ ...patch, updatedAt: new Date() }).where(eq(schema.referenceAssets.id, assetId));
  try {
    const chars = await db.select({ id: schema.characters.id, name: schema.characters.name, code: schema.characters.code }).from(schema.characters).where(and(eq(schema.characters.orgId, asset.orgId), eq(schema.characters.canonStatus, "official")));
    const known = chars.length ? `Known official Calmlings characters (only suggest these names; otherwise say "unknown"): ${chars.map((c) => `${c.name} (${c.code})`).join(", ")}` : "No official characters exist yet – use descriptive names like \"unknown character 1\".";
    const base: MachineAnalysis = { ...(asset.analysis ?? {}), provider: null, model: null, analysedAt: new Date().toISOString(), machineGenerated: true };
    const mapCandidates = (cs: { name: string; confidence: number; reason: string }[]) => cs.map((c) => ({ ...c, characterId: chars.find((x) => x.name.toLowerCase() === c.name.toLowerCase() || x.code.toLowerCase() === c.name.toLowerCase())?.id ?? null }));

    if (asset.mediaKind === "image") {
      const avail = await capabilityAvailable(asset.orgId, "vision", { sendsProprietaryFiles: true });
      if (!avail.ok) throw new IntegrationRequiredError("capability:vision", avail.reason);
      const data = await getStorage().get(version.storageKey);
      if (!data) throw new Error("File missing from storage.");
      const img = await visionCopy(data);
      const res = await runAgent({ orgId: asset.orgId, agentKey: "brand_guardian", task: `Analyse reference: ${asset.title}`, prompt: `Describe this uploaded reference factually for the Calmlings reference library. Do not invent lore. ${known}\nObserve composition, style and visual traits that could become consistency rules (they are candidates for a human to adopt, not canon).`, schema: S.referenceAnalysis, pack: null, images: [{ ...img, label: asset.title }], capability: "vision" });
      await set({ analysis: { ...base, provider: res.provider, model: res.model, description: res.data.description, characterCandidates: mapCandidates(res.data.characterCandidates), composition: res.data.composition, styleObservations: res.data.styleObservations, consistencyRules: res.data.consistencyRules }, analysisStatus: "done", analysisError: null, analysisReviewed: false });
      return;
    }
    if (asset.mediaKind === "video") {
      const avail = await capabilityAvailable(asset.orgId, "vision", { sendsProprietaryFiles: true });
      if (!avail.ok) throw new IntegrationRequiredError("capability:vision", avail.reason);
      const keys = asset.technical.keyframeKeys ?? [];
      const times = ((asset.technical as Record<string, unknown>).keyframeTimes as number[] | undefined) ?? [];
      const images = [];
      for (const [i, k] of keys.entries()) {
        const d = await getStorage().get(k);
        if (d) images.push({ mimeType: "image/jpeg", data: d, label: `Keyframe at ${times[i] ?? i}s` });
      }
      let transcript: string | undefined;
      const t = await capabilityAvailable(asset.orgId, "transcription", { sendsProprietaryFiles: true });
      if (t.ok) {
        const file = await getStorage().get(version.storageKey);
        const audio = file ? await extractAudio(file, version.storageKey.split(".").pop()!) : null;
        if (audio) transcript = (await transcribe({ orgId: asset.orgId }, { audio: { mimeType: "audio/mpeg", data: audio } })).text;
      }
      const res = await runAgent({ orgId: asset.orgId, agentKey: "animation_director", task: `Analyse video reference: ${asset.title}`, prompt: `Analyse these sampled keyframes from a ${asset.technical.durationSeconds ?? "?"}s video (${asset.technical.aspectRatio ?? "?"}). Describe scenes with timings, movement, and editing rhythm. ${known}${transcript ? `\nTranscript:\n${transcript.slice(0, 6000)}` : "\n(No transcript – transcription provider not available.)"}`, schema: S.videoAnalysis, pack: null, images, capability: "vision" });
      await set({ analysis: { ...base, provider: res.provider, model: res.model, description: res.data.description, sceneDescriptions: res.data.sceneDescriptions, movement: res.data.movement, editingRhythm: res.data.editingRhythm, characterCandidates: mapCandidates(res.data.characterCandidates), styleObservations: res.data.styleObservations, transcript, notes: t.ok ? undefined : `Transcript unavailable: ${t.reason}` }, analysisStatus: "done", analysisError: null, analysisReviewed: false });
      return;
    }
    if (asset.mediaKind === "audio") {
      const t = await capabilityAvailable(asset.orgId, "transcription", { sendsProprietaryFiles: true });
      if (!t.ok) throw new IntegrationRequiredError("capability:transcription", t.reason);
      const file = await getStorage().get(version.storageKey);
      const res = await transcribe({ orgId: asset.orgId }, { audio: { mimeType: version.mimeType, data: file! } });
      await set({ analysis: { ...base, provider: res.provider, model: res.model, transcript: res.text }, analysisStatus: "done", analysisError: null, analysisReviewed: false });
      return;
    }
    if (asset.mediaKind === "document") {
      const text = asset.analysis?.extractedText;
      if (!text) {
        await set({ analysisStatus: "done", analysis: { ...base, notes: "No extractable text." } });
        return;
      }
      const avail = await capabilityAvailable(asset.orgId, "structured");
      if (!avail.ok) {
        await set({ analysisStatus: "blocked", analysisError: `Text extracted locally; AI summary needs a text provider. ${avail.reason}` });
        return;
      }
      const res = await runAgent({ orgId: asset.orgId, agentKey: "lore_continuity_editor", task: `Analyse document: ${asset.title}`, prompt: `Summarise this uploaded document for the Calmlings knowledge base. Extract key facts and statements a human might adopt as canon (they are candidates only).\n\n${text.slice(0, 60000)}`, schema: S.documentAnalysis, pack: null });
      await set({ analysis: { ...base, extractedText: text, provider: res.provider, model: res.model, description: res.data.description, notes: JSON.stringify({ keyFacts: res.data.keyFacts, candidateCanon: res.data.candidateCanon }) }, analysisStatus: "done", analysisError: null, analysisReviewed: false });
    }
  } catch (err) {
    const blocked = err instanceof IntegrationRequiredError;
    await set({ analysisStatus: blocked ? "blocked" : "failed", analysisError: (err as Error).message });
    if (!blocked) throw err;
  }
}

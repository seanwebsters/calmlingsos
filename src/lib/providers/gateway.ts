/**
 * Provider-agnostic AI gateway: credentials, live status, capability
 * discovery, the model router and metered invocation.
 *
 * Invariants
 *  - API keys never leave the server; stored keys are AES-256-GCM encrypted.
 *  - An unavailable capability throws IntegrationRequiredError. Nothing is
 *    ever substituted with placeholder output.
 *  - A manual provider override is honoured or fails loudly – never swapped.
 *  - Proprietary reference files only go to providers a human has approved.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { IntegrationRequiredError, ProviderError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { DEFAULT_ROUTE_ORDER, PROVIDER_BY_KEY, PROVIDERS } from "./definitions";
import type {
  AudioGenRequest,
  Capability,
  EmbeddingRequest,
  EmbeddingResult,
  ImageRequest,
  MediaResult,
  ProviderAdapter,
  ProviderDefinition,
  Quality,
  SpeechRequest,
  TextRequest,
  TextResult,
  TranscriptionRequest,
  TranscriptionResult,
  VideoRequest,
} from "./types";
import { anthropicAdapter } from "./adapters/anthropic";
import { openaiAdapter } from "./adapters/openai";
import { googleAdapter } from "./adapters/google";
import { falAdapter } from "./adapters/fal";
import { elevenlabsAdapter } from "./adapters/elevenlabs";

const ADAPTERS: Record<string, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
  fal: falAdapter,
  elevenlabs: elevenlabsAdapter,
};

const METHOD: Record<Capability, keyof ProviderAdapter> = {
  text: "text",
  vision: "text",
  structured: "text",
  search: "text",
  image_generation: "image",
  image_edit: "image",
  video_generation: "video",
  speech: "speech",
  transcription: "transcribe",
  music: "music",
  sound_effects: "soundEffect",
  embeddings: "embed",
};

/* ------------------------------------------------------------------ */
/* Test doubles (automated tests only – never reachable from the app)  */
/* ------------------------------------------------------------------ */

const testState = globalThis as unknown as { __calmlingsTestAdapters?: Record<string, ProviderAdapter> };
export function setTestAdapters(adapters: Record<string, ProviderAdapter> | null) {
  if (!env.isTest) throw new Error("Test adapters can only be installed by the automated test suite.");
  testState.__calmlingsTestAdapters = adapters ?? undefined;
}
function testAdapters(): Record<string, ProviderAdapter> | null {
  return env.isTest ? (testState.__calmlingsTestAdapters ?? null) : null;
}
function adapterFor(key: string): ProviderAdapter | undefined {
  return testAdapters()?.[key] ?? ADAPTERS[key];
}

/* ------------------------------------------------------------------ */
/* Credentials & settings                                              */
/* ------------------------------------------------------------------ */

export type CredentialSource = "environment" | "stored" | "test" | "none";

async function providerRow(orgId: string, key: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.providers).where(and(eq(schema.providers.orgId, orgId), eq(schema.providers.providerKey, key)));
  return row ?? null;
}

export async function getCredential(orgId: string, key: string): Promise<{ apiKey: string; source: CredentialSource; hint: string } | null> {
  if (testAdapters()?.[key]) return { apiKey: "test-key", source: "test", hint: "test" };
  const fromEnv = env.providerEnv[key];
  if (fromEnv) return { apiKey: fromEnv, source: "environment", hint: `…${fromEnv.slice(-4)}` };
  const db = await getDb();
  const [cred] = await db.select().from(schema.providerCredentials).where(and(eq(schema.providerCredentials.orgId, orgId), eq(schema.providerCredentials.providerKey, key)));
  if (!cred) return null;
  try {
    return { apiKey: decryptSecret(cred.ciphertext), source: "stored", hint: cred.hint };
  } catch {
    return null;
  }
}

export async function saveCredential(orgId: string, userId: string, key: string, apiKey: string) {
  if (!PROVIDER_BY_KEY[key]) throw new IntegrationRequiredError(`provider:${key}`, `Unknown provider “${key}”.`);
  const ciphertext = encryptSecret(apiKey.trim());
  const db = await getDb();
  await db.delete(schema.providerCredentials).where(and(eq(schema.providerCredentials.orgId, orgId), eq(schema.providerCredentials.providerKey, key)));
  await db.insert(schema.providerCredentials).values({ id: newId("cred"), orgId, providerKey: key, ciphertext, hint: `…${apiKey.trim().slice(-4)}`, createdBy: userId });
  await ensureProviderRow(orgId, key);
  await audit({ orgId, actorUserId: userId, action: "provider.credential_saved", targetType: "provider", targetId: key });
}

export async function deleteCredential(orgId: string, userId: string, key: string) {
  const db = await getDb();
  await db.delete(schema.providerCredentials).where(and(eq(schema.providerCredentials.orgId, orgId), eq(schema.providerCredentials.providerKey, key)));
  await db.update(schema.providers).set({ status: "disconnected", updatedAt: new Date() }).where(and(eq(schema.providers.orgId, orgId), eq(schema.providers.providerKey, key)));
  await audit({ orgId, actorUserId: userId, action: "provider.credential_removed", targetType: "provider", targetId: key });
}

async function ensureProviderRow(orgId: string, key: string) {
  const existing = await providerRow(orgId, key);
  if (existing) return existing;
  const db = await getDb();
  const row = { id: newId("prv"), orgId, providerKey: key, enabled: true, allowProprietaryReferences: false, models: {}, status: "unknown" };
  await db.insert(schema.providers).values(row).onConflictDoNothing();
  return (await providerRow(orgId, key))!;
}

export async function updateProviderSettings(
  orgId: string,
  userId: string,
  key: string,
  patch: { enabled?: boolean; allowProprietaryReferences?: boolean; models?: Record<string, string> },
) {
  await ensureProviderRow(orgId, key);
  const db = await getDb();
  await db
    .update(schema.providers)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.providers.orgId, orgId), eq(schema.providers.providerKey, key)));
  await audit({ orgId, actorUserId: userId, action: "provider.settings_updated", targetType: "provider", targetId: key, data: patch });
}

export interface ProviderStatus {
  key: string;
  name: string;
  definition: ProviderDefinition;
  connected: boolean;
  credentialSource: CredentialSource;
  keyHint: string | null;
  enabled: boolean;
  allowProprietaryReferences: boolean;
  models: Record<string, string>;
  status: string;
  lastCheckedAt: Date | null;
  lastError: string | null;
  implemented: Capability[];
}

export async function providerStatuses(orgId: string): Promise<ProviderStatus[]> {
  const out: ProviderStatus[] = [];
  for (const def of PROVIDERS) {
    const row = await providerRow(orgId, def.key);
    const cred = await getCredential(orgId, def.key);
    const adapter = adapterFor(def.key);
    out.push({
      key: def.key,
      name: def.name,
      definition: def,
      connected: Boolean(cred) && (row?.enabled ?? true) && row?.status !== "error",
      credentialSource: cred?.source ?? "none",
      keyHint: cred?.hint ?? null,
      enabled: row?.enabled ?? true,
      allowProprietaryReferences: row?.allowProprietaryReferences ?? false,
      models: { ...def.defaultModels, ...(row?.models ?? {}) } as Record<string, string>,
      status: !cred ? "disconnected" : (row?.status ?? "unknown"),
      lastCheckedAt: row?.lastCheckedAt ?? null,
      lastError: row?.lastError ?? null,
      implemented: def.capabilities.filter((c) => adapter && typeof adapter[METHOD[c]] === "function"),
    });
  }
  return out;
}

export async function testProvider(orgId: string, key: string) {
  const adapter = adapterFor(key);
  const cred = await getCredential(orgId, key);
  await ensureProviderRow(orgId, key);
  const db = await getDb();
  if (!adapter || !cred) {
    await db.update(schema.providers).set({ status: "disconnected", lastCheckedAt: new Date(), lastError: "No API key configured." }).where(and(eq(schema.providers.orgId, orgId), eq(schema.providers.providerKey, key)));
    return { ok: false, detail: `No API key configured. Set ${PROVIDER_BY_KEY[key]?.envVar ?? "the key"} on the server or save one in Settings.`, availableModels: [] as string[], missingModels: [] as string[] };
  }
  const result = await adapter.test(cred.apiKey);
  const def = PROVIDER_BY_KEY[key];
  const missingModels = result.availableModels ? def.models.map((m) => m.id).filter((id) => !result.availableModels!.some((a) => a === id || a.startsWith(id))) : [];
  await db
    .update(schema.providers)
    .set({ status: result.ok ? "connected" : "error", lastCheckedAt: new Date(), lastError: result.ok ? (missingModels.length ? `Not visible on this account: ${missingModels.join(", ")}` : null) : result.detail })
    .where(and(eq(schema.providers.orgId, orgId), eq(schema.providers.providerKey, key)));
  return { ...result, availableModels: result.availableModels ?? [], missingModels };
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export interface RouteOptions {
  /** Manual provider override for this task – honoured or fails. */
  override?: string | null;
  /** Proprietary reference files will be sent with the request. */
  sendsProprietaryFiles?: boolean;
  /** Prefer models that accept reference images. */
  wantsReferences?: boolean;
  wantsTransparency?: boolean;
  quality?: Quality;
}

export interface ResolvedRoute {
  provider: string;
  model: string;
  apiKey: string;
  adapter: ProviderAdapter;
  supportsReferences: boolean;
  transparentBackground: boolean;
}

export async function resolveRoute(orgId: string, capability: Capability, opts: RouteOptions = {}): Promise<ResolvedRoute> {
  const order = opts.override ? [opts.override] : (DEFAULT_ROUTE_ORDER[capability] ?? []);
  const reasons: string[] = [];
  const candidates: (ResolvedRoute & { score: number })[] = [];
  for (const key of order) {
    const def = PROVIDER_BY_KEY[key];
    const adapter = adapterFor(key);
    if (!def || !def.capabilities.includes(capability)) {
      reasons.push(`${def?.name ?? key} doesn't offer ${capability.replace("_", " ")}`);
      continue;
    }
    if (!adapter || typeof adapter[METHOD[capability]] !== "function") {
      reasons.push(`${def.name}: ${capability} adapter not implemented`);
      continue;
    }
    const row = await providerRow(orgId, key);
    if (row && !row.enabled) {
      reasons.push(`${def.name} is switched off`);
      continue;
    }
    const cred = await getCredential(orgId, key);
    if (!cred) {
      reasons.push(`${def.name} is not connected (${def.envVar})`);
      continue;
    }
    if (opts.sendsProprietaryFiles && !(row?.allowProprietaryReferences ?? false) && cred.source !== "test") {
      reasons.push(`${def.name} is not approved to receive proprietary reference files`);
      continue;
    }
    const modelId = (row?.models as Record<string, string> | undefined)?.[capability] ?? def.defaultModels[capability];
    const info = def.models.find((m) => m.id === modelId);
    if (!modelId) {
      reasons.push(`${def.name} has no model selected for ${capability}`);
      continue;
    }
    let score = 100 - order.indexOf(key) * 10;
    if (info) {
      if (opts.quality === "best") score += info.quality * 15;
      if (opts.quality === "fast") score += info.speed * 15;
      if (opts.quality === "cheap") score += (4 - info.quality) * 15;
      if (opts.wantsReferences && info.supportsReferences) score += 40;
      if (opts.wantsTransparency && info.transparentBackground) score += 40;
    }
    candidates.push({ provider: key, model: modelId, apiKey: cred.apiKey, adapter, supportsReferences: Boolean(info?.supportsReferences), transparentBackground: Boolean(info?.transparentBackground), score });
  }
  if (!candidates.length) {
    const what = opts.override ? `The selected provider (${PROVIDER_BY_KEY[opts.override]?.name ?? opts.override}) can't run this` : `No connected provider can do ${capability.replace(/_/g, " ")}`;
    throw new IntegrationRequiredError(`capability:${capability}`, `${what}. ${reasons.join("; ")}.`, "/settings");
  }
  candidates.sort((a, b) => b.score - a.score);
  const { score: _score, ...best } = candidates[0];
  return best;
}

/* ------------------------------------------------------------------ */
/* Metered invocation                                                  */
/* ------------------------------------------------------------------ */

export interface CallContext {
  orgId: string;
  productionId?: string | null;
  stepId?: string | null;
  runId?: string | null;
}

async function meter<T extends { model: string; units: Record<string, number>; costCents: number }>(
  ctx: CallContext,
  capability: Capability,
  route: ResolvedRoute,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T & { provider: string }> {
  const started = Date.now();
  const db = await getDb();
  try {
    const out = await fn();
    await db.insert(schema.costRecords).values({
      id: newId("cost"),
      orgId: ctx.orgId,
      productionId: ctx.productionId ?? null,
      stepId: ctx.stepId ?? null,
      runId: ctx.runId ?? null,
      provider: route.provider,
      model: out.model,
      capability,
      units: out.units,
      costCents: out.costCents,
      estimated: true,
    });
    if (ctx.runId) {
      await db.insert(schema.toolInvocations).values({ id: newId("tool"), runId: ctx.runId, tool: `${route.provider}.${capability}`, input, output: { model: out.model, units: out.units }, status: "succeeded", costCents: out.costCents, durationMs: Date.now() - started });
    }
    return { ...out, provider: route.provider };
  } catch (err) {
    if (ctx.runId) {
      await db.insert(schema.toolInvocations).values({ id: newId("tool"), runId: ctx.runId, tool: `${route.provider}.${capability}`, input, output: { error: String((err as Error).message ?? err) }, status: "failed", durationMs: Date.now() - started });
    }
    if (err instanceof ProviderError && (err.httpStatus === 401 || err.httpStatus === 403)) {
      await db.update(schema.providers).set({ status: "error", lastError: err.message, lastCheckedAt: new Date() }).where(and(eq(schema.providers.orgId, ctx.orgId), eq(schema.providers.providerKey, route.provider)));
    }
    throw err;
  }
}

const summarise = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o, (k, v) => (Buffer.isBuffer(v) || (v && v.type === "Buffer") ? `<${v.length ?? "binary"} bytes>` : typeof v === "string" && v.length > 2000 ? v.slice(0, 2000) + "…" : v)));

export async function generateText(ctx: CallContext, capability: "text" | "vision" | "structured" | "search", req: TextRequest, opts: RouteOptions = {}): Promise<TextResult & { provider: string }> {
  const route = await resolveRoute(ctx.orgId, capability, { ...opts, sendsProprietaryFiles: Boolean(req.images?.length) });
  return meter(ctx, capability, route, summarise({ prompt: req.prompt, images: req.images?.length ?? 0 }), () => route.adapter.text!(route.apiKey, route.model, req));
}

export async function generateImage(ctx: CallContext, req: ImageRequest, opts: RouteOptions = {}): Promise<MediaResult & { provider: string; supportsReferences: boolean }> {
  const capability: Capability = req.references?.length ? "image_edit" : "image_generation";
  const route = await resolveRoute(ctx.orgId, capability, { ...opts, wantsReferences: Boolean(req.references?.length), sendsProprietaryFiles: Boolean(req.references?.length), wantsTransparency: req.transparent });
  const out = await meter(ctx, capability, route, summarise({ prompt: req.prompt, references: req.references?.map((r) => r.label ?? r.mimeType), aspectRatio: req.aspectRatio }), () => route.adapter.image!(route.apiKey, route.model, req));
  return { ...out, supportsReferences: route.supportsReferences };
}

export async function generateVideo(ctx: CallContext, req: VideoRequest, opts: RouteOptions = {}): Promise<MediaResult & { provider: string }> {
  const route = await resolveRoute(ctx.orgId, "video_generation", { ...opts, wantsReferences: Boolean(req.startFrame), sendsProprietaryFiles: Boolean(req.startFrame) });
  return meter(ctx, "video_generation", route, summarise({ prompt: req.prompt, startFrame: Boolean(req.startFrame), durationSeconds: req.durationSeconds }), () => route.adapter.video!(route.apiKey, route.model, req));
}

export async function generateSpeech(ctx: CallContext, req: SpeechRequest, opts: RouteOptions = {}): Promise<MediaResult & { provider: string }> {
  const route = await resolveRoute(ctx.orgId, "speech", opts);
  return meter(ctx, "speech", route, summarise({ ...req }), () => route.adapter.speech!(route.apiKey, route.model, req));
}

export async function transcribe(ctx: CallContext, req: TranscriptionRequest, opts: RouteOptions = {}): Promise<TranscriptionResult & { provider: string }> {
  const route = await resolveRoute(ctx.orgId, "transcription", { ...opts, sendsProprietaryFiles: true });
  return meter(ctx, "transcription", route, { bytes: req.audio.data.length }, () => route.adapter.transcribe!(route.apiKey, route.model, req));
}

export async function generateMusic(ctx: CallContext, req: AudioGenRequest, opts: RouteOptions = {}): Promise<MediaResult & { provider: string }> {
  const route = await resolveRoute(ctx.orgId, "music", opts);
  return meter(ctx, "music", route, req, () => route.adapter.music!(route.apiKey, route.model, req));
}

export async function generateSoundEffect(ctx: CallContext, req: AudioGenRequest, opts: RouteOptions = {}): Promise<MediaResult & { provider: string }> {
  const route = await resolveRoute(ctx.orgId, "sound_effects", opts);
  return meter(ctx, "sound_effects", route, req, () => route.adapter.soundEffect!(route.apiKey, route.model, req));
}

export async function embed(ctx: CallContext, req: EmbeddingRequest, opts: RouteOptions = {}): Promise<EmbeddingResult & { provider: string }> {
  const route = await resolveRoute(ctx.orgId, "embeddings", opts);
  return meter(ctx, "embeddings", route, { count: req.texts.length }, () => route.adapter.embed!(route.apiKey, route.model, req));
}

/** Can this capability run right now? Used for UI badges and plan estimates. */
export async function capabilityAvailable(orgId: string, capability: Capability, opts: RouteOptions = {}): Promise<{ ok: true; provider: string; model: string } | { ok: false; reason: string }> {
  try {
    const r = await resolveRoute(orgId, capability, opts);
    return { ok: true, provider: r.provider, model: r.model };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

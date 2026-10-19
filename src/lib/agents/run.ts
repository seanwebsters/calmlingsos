/**
 * Runs one agent task: canon pack in, validated structured output out, with
 * a durable AgentRun record (inputs, exact references, output, cost,
 * duration, provider/model, prompt version, errors).
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import type { ZodType } from "zod";
import { getDb, schema } from "@/db";
import { newId } from "@/lib/ids";
import { AppError, ProviderError } from "@/lib/errors";
import { generateText, type RouteOptions } from "@/lib/providers/gateway";
import type { BinaryInput, Quality } from "@/lib/providers/types";
import { packProvenance, packToPrompt, type ContextPack } from "@/lib/brain/context";
import { AGENT_BY_KEY, type AgentDefinition } from "./definitions";
import { toProviderSchema } from "./jsonschema";

export const PROMPT_VERSION = "2026-10-19.1";

export async function getAgentConfig(orgId: string, key: string): Promise<AgentDefinition & { enabled: boolean; qualityPreference: Quality; customised: boolean }> {
  const def = AGENT_BY_KEY[key];
  if (!def) throw new AppError(`Unknown agent ${key}`);
  const db = await getDb();
  const [row] = await db.select().from(schema.agents).where(and(eq(schema.agents.orgId, orgId), eq(schema.agents.key, key)));
  return {
    ...def,
    instructions: row?.instructions ?? def.instructions,
    budgetCentsPerRun: row?.budgetCentsPerRun ?? def.budgetCentsPerRun,
    enabled: row?.enabled ?? true,
    qualityPreference: (row?.qualityPreference as Quality) ?? "balanced",
    customised: Boolean(row),
  };
}

export async function saveAgentConfig(orgId: string, key: string, patch: { instructions?: string; enabled?: boolean; budgetCentsPerRun?: number; qualityPreference?: Quality }) {
  const current = await getAgentConfig(orgId, key);
  const db = await getDb();
  const values = {
    instructions: patch.instructions ?? current.instructions,
    enabled: patch.enabled ?? current.enabled,
    budgetCentsPerRun: patch.budgetCentsPerRun ?? current.budgetCentsPerRun,
    qualityPreference: patch.qualityPreference ?? current.qualityPreference,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.agents)
    .values({ id: newId("agt"), orgId, key, ...values })
    .onConflictDoUpdate({ target: [schema.agents.orgId, schema.agents.key], set: values });
}

export interface AgentTask<T> {
  orgId: string;
  agentKey: string;
  task: string;
  prompt: string;
  schema: ZodType<T>;
  pack: ContextPack | null;
  productionId?: string | null;
  stepId?: string | null;
  images?: BinaryInput[];
  capability?: "structured" | "vision" | "search";
  route?: RouteOptions;
  inputs?: Record<string, unknown>;
  maxTokens?: number;
}

export interface AgentResult<T> {
  runId: string;
  data: T;
  costCents: number;
  provider: string;
  model: string;
}

export async function runAgent<T>(t: AgentTask<T>): Promise<AgentResult<T>> {
  const cfg = await getAgentConfig(t.orgId, t.agentKey);
  if (!cfg.enabled) throw new AppError(`${cfg.name} is switched off in Agent Headquarters.`, 409, "agent_disabled");
  const db = await getDb();
  const runId = newId("run");
  const started = Date.now();
  const prov = t.pack ? packProvenance(t.pack) : { referenceAssetVersionIds: [], characterVersionIds: [], canonRecordIds: [], decisionIds: [] };
  await db.insert(schema.agentRuns).values({
    id: runId,
    orgId: t.orgId,
    productionId: t.productionId ?? null,
    stepId: t.stepId ?? null,
    agentKey: t.agentKey,
    task: t.task,
    inputs: { ...(t.inputs ?? {}), prompt: t.prompt.slice(0, 20000), images: t.images?.map((i) => i.label ?? i.mimeType) ?? [] },
    referencesUsed: { assetVersionIds: prov.referenceAssetVersionIds, characterVersionIds: prov.characterVersionIds, canonRecordIds: prov.canonRecordIds, decisionIds: prov.decisionIds },
    status: "running",
    promptVersion: PROMPT_VERSION,
  });
  try {
    const capability = t.capability ?? (t.images?.length ? "vision" : "structured");
    const res = await generateText(
      { orgId: t.orgId, productionId: t.productionId, stepId: t.stepId, runId },
      capability,
      {
        system: cfg.instructions,
        context: t.pack ? packToPrompt(t.pack) : undefined,
        prompt: t.prompt,
        images: t.images,
        jsonSchema: toProviderSchema(t.schema),
        schemaName: t.task,
        webSearch: capability === "search",
        maxTokens: t.maxTokens,
        effort: cfg.qualityPreference === "best" ? "high" : cfg.qualityPreference === "fast" || cfg.qualityPreference === "cheap" ? "low" : "medium",
      },
      { quality: cfg.qualityPreference, ...t.route },
    );
    let data: T;
    try {
      const text = res.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      data = t.schema.parse(JSON.parse(text));
    } catch (err) {
      throw new ProviderError(res.provider, `${cfg.name} returned output that didn't match its handoff schema: ${String(err).slice(0, 300)}`, true);
    }
    await db
      .update(schema.agentRuns)
      .set({ status: "succeeded", output: data as unknown, provider: res.provider, model: res.model, costCents: res.costCents, durationMs: Date.now() - started, finishedAt: new Date(), error: res.costCents > cfg.budgetCentsPerRun ? `Run cost ${res.costCents.toFixed(2)}¢ exceeded the agent budget of ${cfg.budgetCentsPerRun}¢.` : null })
      .where(eq(schema.agentRuns.id, runId));
    return { runId, data, costCents: res.costCents, provider: res.provider, model: res.model };
  } catch (err) {
    await db
      .update(schema.agentRuns)
      .set({ status: "failed", error: String((err as Error).message ?? err).slice(0, 2000), durationMs: Date.now() - started, finishedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
    throw err;
  }
}

/** Record a non-LLM agent run (deterministic tools, media generation) for the run history. */
export async function recordRun(input: { orgId: string; agentKey: string; task: string; productionId?: string | null; stepId?: string | null; inputs?: Record<string, unknown>; output?: unknown; status: "succeeded" | "failed"; provider?: string | null; model?: string | null; costCents?: number; durationMs?: number; error?: string | null; referencesUsed?: { assetVersionIds: string[]; characterVersionIds: string[]; canonRecordIds: string[]; decisionIds: string[] } }) {
  const db = await getDb();
  const id = newId("run");
  await db.insert(schema.agentRuns).values({
    id,
    orgId: input.orgId,
    productionId: input.productionId ?? null,
    stepId: input.stepId ?? null,
    agentKey: input.agentKey,
    task: input.task,
    inputs: input.inputs ?? {},
    output: input.output ?? null,
    status: input.status,
    provider: input.provider ?? null,
    model: input.model ?? null,
    promptVersion: PROMPT_VERSION,
    costCents: input.costCents ?? 0,
    durationMs: input.durationMs ?? null,
    error: input.error ?? null,
    referencesUsed: input.referencesUsed ?? { assetVersionIds: [], characterVersionIds: [], canonRecordIds: [], decisionIds: [] },
    finishedAt: new Date(),
  });
  return id;
}

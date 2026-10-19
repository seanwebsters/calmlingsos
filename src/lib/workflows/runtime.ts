/**
 * Executes one queued step. Translates outcomes into durable step state:
 * integration gaps → BLOCKED (with setup action), budget → BLOCKED + spend
 * approval, retryable provider errors → re-queued with backoff, anything
 * else → FAILED. Costs are rolled up from cost records (including the cost
 * of failed attempts) so the budget is always honest.
 */
import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { AppError, BudgetExceededError, CanonGuardError, IntegrationRequiredError, ProviderError } from "@/lib/errors";
import { enqueue } from "@/lib/jobs/queue";
import { createApproval } from "@/lib/review/approvals";
import { buildContextPack, type ContextPack } from "@/lib/brain/context";
import { advance, type ProductionRow, type StepRow } from "./engine";
import { STEP_HANDLERS } from "./handlers";
import type { RouteOptions } from "@/lib/providers/gateway";
import type { Capability } from "@/lib/providers/types";

export interface StepCtx {
  orgId: string;
  production: ProductionRow;
  step: StepRow;
  steps: StepRow[];
  outputs: Record<string, Record<string, unknown>>;
  brief: Record<string, unknown>;
  pack: ContextPack;
  notes: string | null;
  route(capability: Capability, extra?: RouteOptions): RouteOptions;
  /** Throws BudgetExceededError if spending `cents` more would pass the production budget. */
  ensureBudget(cents: number): Promise<void>;
  /** Persist partial progress so a resumed step can report it. */
  progress(note: string): Promise<void>;
}

export interface StepResult {
  output: Record<string, unknown>;
}

export type StepHandler = (ctx: StepCtx) => Promise<StepResult>;

async function spentFor(productionId: string, stepId?: string): Promise<number> {
  const db = await getDb();
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.costRecords.costCents}), 0)::float` })
    .from(schema.costRecords)
    .where(and(eq(schema.costRecords.productionId, productionId), stepId ? eq(schema.costRecords.stepId, stepId) : undefined));
  return Number(r?.n ?? 0);
}

async function monthSpent(orgId: string): Promise<number> {
  const db = await getDb();
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.costRecords.costCents}), 0)::float` })
    .from(schema.costRecords)
    .where(and(eq(schema.costRecords.orgId, orgId), sql`${schema.costRecords.createdAt} >= date_trunc('month', now())`));
  return Number(r?.n ?? 0);
}

export async function runStepJob(payload: { productionId: string; stepId: string }) {
  const db = await getDb();
  const [step] = await db.select().from(schema.productionSteps).where(eq(schema.productionSteps.id, payload.stepId));
  const [production] = await db.select().from(schema.productions).where(eq(schema.productions.id, payload.productionId));
  if (!step || !production) return;
  if (step.status !== "queued") return; // cancelled, paused or already handled – idempotent no-op
  if (production.status === "paused" || production.status === "cancelled") {
    await db.update(schema.productionSteps).set({ status: production.status === "paused" ? "pending" : "cancelled" }).where(eq(schema.productionSteps.id, step.id));
    return;
  }
  const handler = STEP_HANDLERS[step.handler];
  await db.update(schema.productionSteps).set({ status: "running", attempts: step.attempts + 1, startedAt: step.startedAt ?? new Date(), error: null, updatedAt: new Date() }).where(eq(schema.productionSteps.id, step.id));
  await db.update(schema.productions).set({ status: "running", updatedAt: new Date() }).where(eq(schema.productions.id, production.id));

  const steps = await db.select().from(schema.productionSteps).where(eq(schema.productionSteps.productionId, production.id)).orderBy(asc(schema.productionSteps.position));
  const outputs = Object.fromEntries(steps.filter((s) => s.status === "completed" && s.output).map((s) => [s.key, s.output as Record<string, unknown>]));
  const canonOut = outputs.canon?.pack as ContextPack | undefined;
  const pack = canonOut ?? (await buildContextPack(production.orgId, { characterIds: production.characterIds, department: production.department }));
  const { getOrgSettings } = await import("@/lib/org");
  const settings = await getOrgSettings(production.orgId);

  const ctx: StepCtx = {
    orgId: production.orgId,
    production,
    step: { ...step, attempts: step.attempts + 1 },
    steps,
    outputs,
    brief: production.brief,
    pack,
    notes: step.revisionNotes,
    route: (capability, extra = {}) => ({ override: step.providerOverride ?? production.providerOverrides[capability] ?? null, ...extra }),
    ensureBudget: async (cents) => {
      if (cents <= 0) return;
      const spent = await spentFor(production.id);
      const [fresh] = await db.select({ b: schema.productions.budgetCents }).from(schema.productions).where(eq(schema.productions.id, production.id));
      const budget = fresh?.b ?? production.budgetCents;
      if (spent + cents > budget) throw new BudgetExceededError(`This step needs about ${(cents / 100).toFixed(2)} USD more, but only ${((budget - spent) / 100).toFixed(2)} USD of the ${(budget / 100).toFixed(2)} USD production budget remains.`, cents, budget - spent);
      const month = await monthSpent(production.orgId);
      if (month + cents > settings.monthlyBudgetCents) throw new BudgetExceededError(`The organisation's monthly limit (${(settings.monthlyBudgetCents / 100).toFixed(2)} USD) would be exceeded.`, cents, settings.monthlyBudgetCents - month);
    },
    progress: async (note) => {
      await db.update(schema.productionSteps).set({ error: null, output: { ...(step.output ?? {}), _progress: note }, updatedAt: new Date() }).where(eq(schema.productionSteps.id, step.id));
    },
  };

  const finish = async (patch: Partial<typeof schema.productionSteps.$inferInsert>) => {
    const stepCost = await spentFor(production.id, step.id);
    await db.update(schema.productionSteps).set({ ...patch, actualCostCents: stepCost, updatedAt: new Date() }).where(eq(schema.productionSteps.id, step.id));
    await db.update(schema.productions).set({ spentCents: await spentFor(production.id), updatedAt: new Date() }).where(eq(schema.productions.id, production.id));
  };

  try {
    if (!handler) throw new AppError(`No handler for ${step.handler}`);
    // Conservative pre-check: the step's estimate must fit the remaining budget.
    await ctx.ensureBudget(step.budgetEstimateCents);
    const result = await handler(ctx);
    const awaiting = step.requiresApproval;
    await finish({ status: awaiting ? "awaiting_approval" : "completed", output: result.output, finishedAt: awaiting ? null : new Date(), error: null, blockedOn: null });
    if (awaiting) await createApproval({ orgId: production.orgId, kind: "step", targetType: "production_step", targetId: step.id, title: `${production.title}: ${step.name}`, summary: "Approve this output before the production continues.", payload: { productionId: production.id } });
  } catch (err) {
    if (err instanceof IntegrationRequiredError) {
      await finish({ status: "blocked", blockedOn: err.requirement, error: err.message });
    } else if (err instanceof BudgetExceededError) {
      await finish({ status: "blocked", blockedOn: "budget", error: err.message });
      await createApproval({ orgId: production.orgId, kind: "spend", targetType: "production", targetId: production.id, title: `Budget needed: ${production.title}`, summary: err.message, payload: { productionId: production.id, stepId: step.id, neededCents: err.neededCents, remainingCents: err.remainingCents } });
    } else if (err instanceof CanonGuardError) {
      await finish({ status: "blocked", blockedOn: "canon_lock", error: err.message });
    } else if (err instanceof ProviderError && err.retryable && step.attempts + 1 < step.maxAttempts) {
      const seq = step.queueSeq + 1;
      const delay = err.retryAfterMs ?? Math.min(120_000, 5000 * 2 ** step.attempts);
      await finish({ status: "queued", queueSeq: seq, error: `Attempt ${step.attempts + 1} failed (will retry): ${err.message}` });
      await enqueue({ orgId: production.orgId, type: "run_step", payload, idempotencyKey: `step:${step.id}:${seq}`, runAfter: new Date(Date.now() + delay) });
      return;
    } else {
      await finish({ status: "failed", error: (err as Error).message ?? String(err), finishedAt: new Date() });
      if (!(err instanceof AppError) && !(err instanceof ProviderError)) console.error(JSON.stringify({ level: "error", scope: "step", step: step.id, message: String(err), stack: (err as Error)?.stack }));
    }
  }
  await advance(production.id);
}

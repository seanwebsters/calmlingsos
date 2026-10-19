/**
 * Durable production state machine.
 *
 * A production is a DAG of steps snapshotted from a template. `advance`
 * (serialised per production with a row lock) moves ready steps forward:
 * conditions are evaluated, human gates pause, and work steps are queued as
 * idempotent jobs. Completed steps never re-execute unless a human asks for
 * a re-run; approved/locked outputs are never discarded.
 *
 * Step states: pending → queued → running → completed
 *                         ↘ awaiting_input / awaiting_approval → completed | changes_requested
 *                         ↘ blocked (integration/budget/canon gap) → pending on retry
 *                         ↘ failed (after retries) → pending on retry
 *              pending → skipped (condition false or human skip) | cancelled
 */
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Tx } from "@/db";
import type { StepStatus, WorkflowStepDef } from "@/db/schema";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { AppError, conflict, notFound } from "@/lib/errors";
import { assertCan, type Viewer } from "@/lib/auth/session";
import { enqueue, cancelJobsFor } from "@/lib/jobs/queue";
import { createApproval, closeApprovals } from "@/lib/review/approvals";
import { recordDecision } from "@/lib/brain/decisions";
import { getOrgSettings } from "@/lib/org";
import { BRIEF_SCHEMAS } from "./schemas";
import { getTemplate, validateSteps } from "./registry";
import { STEP_TYPES } from "./templates";

export type ProductionRow = typeof schema.productions.$inferSelect;
export type StepRow = typeof schema.productionSteps.$inferSelect;

const TERMINAL_OK: StepStatus[] = ["completed", "skipped"];
const HUMAN_WAIT: StepStatus[] = ["awaiting_input", "awaiting_approval", "changes_requested"];

export async function loadProduction(orgId: string, id: string) {
  const db = await getDb();
  const [p] = await db.select().from(schema.productions).where(and(eq(schema.productions.orgId, orgId), eq(schema.productions.id, id)));
  if (!p) throw notFound("Production not found.");
  const steps = await db.select().from(schema.productionSteps).where(eq(schema.productionSteps.productionId, id)).orderBy(asc(schema.productionSteps.position));
  return { production: p, steps };
}

async function loadStep(orgId: string, stepId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ s: schema.productionSteps, p: schema.productions })
    .from(schema.productionSteps)
    .innerJoin(schema.productions, eq(schema.productions.id, schema.productionSteps.productionId))
    .where(and(eq(schema.productionSteps.id, stepId), eq(schema.productions.orgId, orgId)));
  if (!row) throw notFound("Step not found.");
  return { step: row.s, production: row.p };
}

/* ------------------------------------------------------------------ */
/* Creation & planning                                                 */
/* ------------------------------------------------------------------ */

export const createProductionInput = z.object({
  templateKey: z.string(),
  title: z.string().min(1).max(200),
  brief: z.record(z.string(), z.unknown()),
  characterIds: z.array(z.string()).default([]),
  budgetCents: z.number().int().min(0).optional(),
  projectId: z.string().nullable().optional(),
  command: z.string().max(4000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  steps: z.array(z.custom<WorkflowStepDef>()).optional(),
  providerOverrides: z.record(z.string(), z.string()).default({}),
});

export async function createProduction(viewer: Viewer, raw: unknown) {
  assertCan(viewer, "production:create");
  const input = createProductionInput.parse(raw);
  const tpl = await getTemplate(viewer.orgId, input.templateKey);
  const brief = BRIEF_SCHEMAS[tpl.briefSchema].parse(input.brief) as Record<string, unknown>;
  const steps = input.steps ?? tpl.steps;
  validateSteps(steps);
  const db = await getDb();
  if (input.characterIds.length) {
    const found = await db.select({ id: schema.characters.id }).from(schema.characters).where(and(eq(schema.characters.orgId, viewer.orgId), inArray(schema.characters.id, input.characterIds)));
    if (found.length !== new Set(input.characterIds).size) throw new AppError("One or more characters don't exist in this workspace.");
  }
  const settings = await getOrgSettings(viewer.orgId);
  const id = newId("prd");
  await db.transaction(async (tx) => {
    await tx.insert(schema.productions).values({
      id,
      orgId: viewer.orgId,
      projectId: input.projectId ?? null,
      department: tpl.department,
      title: input.title,
      templateKey: tpl.key,
      templateVersion: tpl.version,
      brief,
      characterIds: [...new Set(input.characterIds)],
      status: "planning",
      budgetCents: input.budgetCents ?? settings.defaultProductionBudgetCents,
      providerOverrides: input.providerOverrides,
      command: input.command ?? null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      createdBy: viewer.userId,
    });
    for (const [i, st] of steps.entries()) {
      await tx.insert(schema.productionSteps).values({
        id: newId("stp"),
        productionId: id,
        key: st.key,
        name: st.name,
        position: i,
        agentKey: st.agent,
        handler: st.handler,
        dependsOn: st.dependsOn,
        config: st.config ?? {},
        condition: st.condition ?? null,
        requiresApproval: Boolean(st.requiresApproval),
        maxAttempts: st.maxAttempts ?? 3,
        budgetEstimateCents: estimateFor(st, brief),
      });
    }
    if (input.dueDate) await tx.insert(schema.calendarItems).values({ id: newId("cal"), orgId: viewer.orgId, title: `Due: ${input.title}`, kind: "deadline", date: new Date(input.dueDate), productionId: id });
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "production.created", targetType: "production", targetId: id, data: { template: tpl.key, title: input.title } }, tx);
  });
  if (settings.requirePlanApproval) {
    await createApproval({ orgId: viewer.orgId, kind: "plan", targetType: "production", targetId: id, title: `Plan: ${input.title}`, summary: `${steps.length} steps · budget ${((input.budgetCents ?? settings.defaultProductionBudgetCents) / 100).toFixed(2)} USD`, requestedBy: viewer.userId });
  } else {
    await startProduction(viewer, id);
  }
  return id;
}

/** Per-step estimate scaled by the brief (e.g. number of shots or items). */
export function estimateFor(st: WorkflowStepDef, brief: Record<string, unknown>): number {
  const base = st.budgetEstimateCents ?? STEP_TYPES[(st.config?.type as string) ?? ""]?.estimateCents ?? 0;
  const n = (k: string, d: number) => (typeof brief[k] === "number" ? (brief[k] as number) : d);
  switch (st.handler) {
    case "shot_frames":
    case "consistency_review":
    case "shot_voice":
      return base * n("produceCount", 1) * Math.max(3, Math.ceil(n("durationSeconds", 20) / 4));
    case "shot_videos":
      return base * n("produceCount", 1) * Math.max(3, Math.ceil(n("durationSeconds", 20) / 4));
    case "item_images":
    case "item_videos":
      return base * n("count", 4);
    case "character_images":
      return base * (st.config?.mode === "explorations" ? n("explorations", 3) : 1);
    default:
      return base;
  }
}

export const planEdit = z.object({
  title: z.string().min(1).max(200).optional(),
  budgetCents: z.number().int().min(0).optional(),
  providerOverrides: z.record(z.string(), z.string()).optional(),
  steps: z
    .array(
      z.object({
        key: z.string(),
        name: z.string().min(1).max(120).optional(),
        agentKey: z.string().nullable().optional(),
        requiresApproval: z.boolean().optional(),
        providerOverride: z.string().nullable().optional(),
        budgetEstimateCents: z.number().min(0).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        remove: z.boolean().optional(),
      }),
    )
    .optional(),
  /** Insert a human review gate after the named step. */
  insertReviewAfter: z.string().optional(),
});

/** Edit a plan before it runs (or any not-yet-started step while running). */
export async function editPlan(viewer: Viewer, productionId: string, raw: unknown) {
  assertCan(viewer, "production:create");
  const edit = planEdit.parse(raw);
  const { production, steps } = await loadProduction(viewer.orgId, productionId);
  if (["completed", "cancelled"].includes(production.status)) throw conflict("This production has finished.");
  const db = await getDb();
  await db.transaction(async (tx) => {
    if (edit.title || edit.budgetCents !== undefined || edit.providerOverrides) {
      if (edit.budgetCents !== undefined && edit.budgetCents > production.budgetCents) assertCan(viewer, "budget:approve");
      await tx
        .update(schema.productions)
        .set({ title: edit.title ?? production.title, budgetCents: edit.budgetCents ?? production.budgetCents, providerOverrides: edit.providerOverrides ?? production.providerOverrides, updatedAt: new Date() })
        .where(eq(schema.productions.id, productionId));
    }
    for (const e of edit.steps ?? []) {
      const st = steps.find((s) => s.key === e.key);
      if (!st) throw new AppError(`No step ${e.key}.`);
      if (!["pending", "blocked", "failed"].includes(st.status)) throw conflict(`“${st.name}” has already started; re-run it instead.`);
      if (e.remove) {
        if (steps.some((o) => o.dependsOn.includes(st.key))) {
          // Rewire dependents to this step's dependencies.
          for (const o of steps.filter((x) => x.dependsOn.includes(st.key))) {
            const deps = [...new Set([...o.dependsOn.filter((d) => d !== st.key), ...st.dependsOn])];
            await tx.update(schema.productionSteps).set({ dependsOn: deps }).where(eq(schema.productionSteps.id, o.id));
            o.dependsOn = deps;
          }
        }
        await tx.delete(schema.productionSteps).where(eq(schema.productionSteps.id, st.id));
        continue;
      }
      await tx
        .update(schema.productionSteps)
        .set({
          name: e.name ?? st.name,
          agentKey: e.agentKey === undefined ? st.agentKey : e.agentKey,
          requiresApproval: e.requiresApproval ?? st.requiresApproval,
          providerOverride: e.providerOverride === undefined ? st.providerOverride : e.providerOverride,
          budgetEstimateCents: e.budgetEstimateCents ?? st.budgetEstimateCents,
          config: e.config ? { ...st.config, ...e.config, type: st.config.type } : st.config,
          updatedAt: new Date(),
        })
        .where(eq(schema.productionSteps.id, st.id));
    }
    if (edit.insertReviewAfter) {
      const after = steps.find((s) => s.key === edit.insertReviewAfter);
      if (!after) throw new AppError(`No step ${edit.insertReviewAfter}.`);
      const key = `review_${after.key}_${Date.now().toString(36)}`;
      for (const o of steps.filter((x) => x.dependsOn.includes(after.key))) {
        await tx.update(schema.productionSteps).set({ dependsOn: o.dependsOn.map((d) => (d === after.key ? key : d)) }).where(eq(schema.productionSteps.id, o.id));
      }
      await tx.update(schema.productionSteps).set({ position: sql`${schema.productionSteps.position} + 1` }).where(and(eq(schema.productionSteps.productionId, productionId), sql`${schema.productionSteps.position} > ${after.position}`));
      await tx.insert(schema.productionSteps).values({ id: newId("stp"), productionId, key, name: `Review: ${after.name}`, position: after.position + 1, agentKey: null, handler: "human_review", dependsOn: [after.key], config: { type: "human_review", reviewsStep: after.key, what: `Review ${after.name}` } });
    }
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "production.plan_edited", targetType: "production", targetId: productionId, data: edit as Record<string, unknown> }, tx);
  });
  const fresh = await loadProduction(viewer.orgId, productionId);
  validateSteps(fresh.steps.map((s) => ({ key: s.key, name: s.name, agent: s.agentKey, handler: s.handler, dependsOn: s.dependsOn })));
  if (production.status !== "planning") await advance(productionId);
}

/** Approve the plan: generation may now begin. */
export async function startProduction(viewer: Viewer, productionId: string) {
  assertCan(viewer, "production:run");
  const { production } = await loadProduction(viewer.orgId, productionId);
  if (production.status !== "planning") throw conflict("This production has already started.");
  const db = await getDb();
  await db.update(schema.productions).set({ status: "running", updatedAt: new Date() }).where(eq(schema.productions.id, productionId));
  await closeApprovals(viewer.orgId, "production", productionId, "approved", viewer.userId);
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "production.started", targetType: "production", targetId: productionId });
  await advance(productionId);
}

/* ------------------------------------------------------------------ */
/* Advance                                                             */
/* ------------------------------------------------------------------ */

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function evaluateCondition(cond: StepRow["condition"], brief: Record<string, unknown>, outputs: Record<string, unknown>): boolean {
  if (!cond) return true;
  const src = cond.step === "$brief" ? brief : outputs[cond.step];
  const v = getPath(src, cond.path);
  switch (cond.op) {
    case "truthy":
      return Boolean(v) && !(Array.isArray(v) && v.length === 0);
    case "falsy":
      return !v || (Array.isArray(v) && v.length === 0);
    case "eq":
      return v === cond.value;
    case "neq":
      return v !== cond.value;
    case "gt":
      return Number(v) > Number(cond.value);
    case "lt":
      return Number(v) < Number(cond.value);
  }
}

export function deriveProductionStatus(current: ProductionRow["status"], steps: Pick<StepRow, "status">[]): ProductionRow["status"] {
  if (["planning", "paused", "cancelled"].includes(current)) return current;
  if (steps.every((s) => TERMINAL_OK.includes(s.status))) return "completed";
  if (steps.some((s) => s.status === "running" || s.status === "queued")) return "running";
  if (steps.some((s) => HUMAN_WAIT.includes(s.status))) return "awaiting_input";
  if (steps.some((s) => s.status === "blocked")) return "blocked";
  if (steps.some((s) => s.status === "failed")) return "failed";
  return "running";
}

async function lockProduction(tx: Tx, id: string) {
  await tx.execute(sql`select id from productions where id = ${id} for update`);
}

/** Move every ready step forward. Safe to call any number of times. */
export async function advance(productionId: string): Promise<void> {
  const db = await getDb();
  const approvalsToOpen: Parameters<typeof createApproval>[0][] = [];
  await db.transaction(async (tx) => {
    await lockProduction(tx, productionId);
    const [p] = await tx.select().from(schema.productions).where(eq(schema.productions.id, productionId));
    if (!p || ["planning", "paused", "cancelled", "completed"].includes(p.status)) return;
    const steps = await tx.select().from(schema.productionSteps).where(eq(schema.productionSteps.productionId, productionId)).orderBy(asc(schema.productionSteps.position));
    const outputs = Object.fromEntries(steps.filter((s) => s.status === "completed").map((s) => [s.key, s.output]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const st of steps) {
        if (st.status !== "pending") continue;
        const deps = st.dependsOn.map((d) => steps.find((x) => x.key === d));
        if (deps.some((d) => !d || !TERMINAL_OK.includes(d.status))) continue;
        let next: StepStatus;
        if (!evaluateCondition(st.condition, p.brief, outputs)) next = "skipped";
        else if (st.handler === "human_select") next = "awaiting_input";
        else if (st.handler === "human_review") next = "awaiting_approval";
        else next = "queued";
        const seq = st.queueSeq + (next === "queued" ? 1 : 0);
        await tx
          .update(schema.productionSteps)
          .set({ status: next, queueSeq: seq, error: null, blockedOn: null, ...(next === "skipped" ? { finishedAt: new Date() } : {}), updatedAt: new Date() })
          .where(eq(schema.productionSteps.id, st.id));
        st.status = next;
        st.queueSeq = seq;
        changed = true;
        if (next === "queued") {
          await enqueue({ orgId: p.orgId, type: "run_step", payload: { productionId, stepId: st.id }, idempotencyKey: `step:${st.id}:${seq}` }, tx);
        } else if (next === "awaiting_approval") {
          const reviewed = steps.find((x) => x.key === st.config.reviewsStep);
          approvalsToOpen.push({ orgId: p.orgId, kind: "step", targetType: "production_step", targetId: st.id, title: `${p.title}: ${st.name}`, summary: String(st.config.what ?? (reviewed ? `Review ${reviewed.name}` : "Review")), payload: { productionId, reviewsStep: st.config.reviewsStep ?? null } });
        } else if (next === "awaiting_input") {
          approvalsToOpen.push({ orgId: p.orgId, kind: "step", targetType: "production_step", targetId: st.id, title: `${p.title}: ${st.name}`, summary: "Selection needed", payload: { productionId, selection: true } });
        }
      }
    }
    const status = deriveProductionStatus(p.status, steps);
    if (status !== p.status) await tx.update(schema.productions).set({ status, updatedAt: new Date() }).where(eq(schema.productions.id, productionId));
    for (const a of approvalsToOpen) await createApproval(a, tx);
  });
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

export async function pauseProduction(viewer: Viewer, id: string) {
  assertCan(viewer, "production:run");
  const { production } = await loadProduction(viewer.orgId, id);
  if (["completed", "cancelled", "planning"].includes(production.status)) throw conflict(`Can't pause a ${production.status} production.`);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await lockProduction(tx, id);
    await tx.update(schema.productions).set({ status: "paused", updatedAt: new Date() }).where(eq(schema.productions.id, id));
    // Queued (not yet running) steps go back to pending; running steps finish their current unit.
    await tx.update(schema.productionSteps).set({ status: "pending", updatedAt: new Date() }).where(and(eq(schema.productionSteps.productionId, id), eq(schema.productionSteps.status, "queued")));
    await cancelJobsFor("productionId", id, tx);
  });
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "production.paused", targetType: "production", targetId: id });
}

/** Resume a paused, blocked, failed or cancelled production. Completed work and approvals are kept. */
export async function resumeProduction(viewer: Viewer, id: string) {
  assertCan(viewer, "production:run");
  const { production, steps } = await loadProduction(viewer.orgId, id);
  if (production.status === "completed" || production.status === "planning") throw conflict(`Can't resume a ${production.status} production.`);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await lockProduction(tx, id);
    for (const st of steps) {
      if (["blocked", "failed", "cancelled"].includes(st.status)) {
        await tx.update(schema.productionSteps).set({ status: "pending", attempts: 0, error: null, blockedOn: null, updatedAt: new Date() }).where(eq(schema.productionSteps.id, st.id));
      }
    }
    await tx.update(schema.productions).set({ status: "running", updatedAt: new Date() }).where(eq(schema.productions.id, id));
  });
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "production.resumed", targetType: "production", targetId: id });
  await advance(id);
}

export async function cancelProduction(viewer: Viewer, id: string) {
  assertCan(viewer, "production:run");
  const { production } = await loadProduction(viewer.orgId, id);
  if (production.status === "completed") throw conflict("This production has completed.");
  const db = await getDb();
  await db.transaction(async (tx) => {
    await lockProduction(tx, id);
    await tx.update(schema.productions).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.productions.id, id));
    await tx
      .update(schema.productionSteps)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(schema.productionSteps.productionId, id), inArray(schema.productionSteps.status, ["pending", "queued", "awaiting_input", "awaiting_approval", "changes_requested", "blocked", "failed"])));
    await cancelJobsFor("productionId", id, tx);
  });
  const db2 = await getDb();
  const pending = await db2.select().from(schema.approvals).where(and(eq(schema.approvals.orgId, viewer.orgId), eq(schema.approvals.status, "pending"), sql`${schema.approvals.payload} ->> 'productionId' = ${id}`));
  for (const a of pending) await closeApprovals(viewer.orgId, a.targetType, a.targetId, "withdrawn", viewer.userId, "Production cancelled");
  await closeApprovals(viewer.orgId, "production", id, "withdrawn", viewer.userId, "Production cancelled");
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "production.cancelled", targetType: "production", targetId: id });
}

/** Retry a failed or blocked step (e.g. after connecting a provider). */
export async function retryStep(viewer: Viewer, stepId: string) {
  assertCan(viewer, "production:run");
  const { step, production } = await loadStep(viewer.orgId, stepId);
  if (!["failed", "blocked", "cancelled"].includes(step.status)) throw conflict(`“${step.name}” is ${step.status}, not failed or blocked.`);
  const db = await getDb();
  await db.update(schema.productionSteps).set({ status: "pending", attempts: 0, error: null, blockedOn: null, updatedAt: new Date() }).where(eq(schema.productionSteps.id, stepId));
  if (["blocked", "failed", "cancelled", "paused"].includes(production.status)) await db.update(schema.productions).set({ status: "running", updatedAt: new Date() }).where(eq(schema.productions.id, production.id));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "step.retried", targetType: "production_step", targetId: stepId });
  await advance(production.id);
}

function downstreamOf(steps: StepRow[], key: string): StepRow[] {
  const out = new Set<string>();
  const visit = (k: string) => {
    for (const s of steps.filter((x) => x.dependsOn.includes(k))) {
      if (!out.has(s.key)) {
        out.add(s.key);
        visit(s.key);
      }
    }
  };
  visit(key);
  return steps.filter((s) => out.has(s.key));
}

/**
 * Re-run a step on purpose (new generation). Downstream steps that already
 * ran are reset to pending so they pick up the new output; locked/approved
 * media items are preserved by the media handlers.
 */
export async function rerunStep(viewer: Viewer, stepId: string, notes?: string | null) {
  assertCan(viewer, "production:run");
  const { step, production } = await loadStep(viewer.orgId, stepId);
  if (["running", "queued"].includes(step.status)) throw conflict(`“${step.name}” is already running.`);
  if (production.status === "cancelled") throw conflict("This production was cancelled; resume it first.");
  const { steps } = await loadProduction(viewer.orgId, production.id);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await lockProduction(tx, production.id);
    await tx
      .update(schema.productionSteps)
      .set({ status: "pending", generation: step.generation + 1, attempts: 0, revisionNotes: notes ?? step.revisionNotes, error: null, blockedOn: null, updatedAt: new Date() })
      .where(eq(schema.productionSteps.id, stepId));
    for (const d of downstreamOf(steps, step.key)) {
      if (d.status === "pending") continue;
      await tx.update(schema.productionSteps).set({ status: "pending", generation: d.handler === "human_select" ? d.generation : d.generation + 1, attempts: 0, error: null, blockedOn: null, updatedAt: new Date() }).where(eq(schema.productionSteps.id, d.id));
      await closeApprovals(viewer.orgId, "production_step", d.id, "withdrawn", viewer.userId, `Upstream “${step.name}” re-run`, tx);
    }
    await tx.update(schema.productions).set({ status: "running", updatedAt: new Date() }).where(eq(schema.productions.id, production.id));
  });
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "step.rerun", targetType: "production_step", targetId: stepId, data: { notes: notes ?? null } });
  await advance(production.id);
}

export async function skipStep(viewer: Viewer, stepId: string, reason: string) {
  assertCan(viewer, "production:run");
  const { step, production } = await loadStep(viewer.orgId, stepId);
  if (!["pending", "blocked", "failed", "awaiting_input"].includes(step.status)) throw conflict(`“${step.name}” can't be skipped while ${step.status}.`);
  if (step.handler === "human_review") assertCan(viewer, "review:approve");
  const db = await getDb();
  await db.update(schema.productionSteps).set({ status: "skipped", error: `Skipped by ${viewer.name}: ${reason}`, finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.productionSteps.id, stepId));
  await closeApprovals(viewer.orgId, "production_step", stepId, "withdrawn", viewer.userId, "Step skipped");
  if (["blocked", "failed"].includes(production.status)) await db.update(schema.productions).set({ status: "running" }).where(eq(schema.productions.id, production.id));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "step.skipped", targetType: "production_step", targetId: stepId, data: { reason } });
  await advance(production.id);
}

/** Creative director selection (concepts, ideas, explorations). Selections and rejections feed learning. */
export async function submitSelection(viewer: Viewer, stepId: string, selected: string[], reasons: Record<string, string> = {}) {
  assertCan(viewer, "review:approve");
  const { step, production } = await loadStep(viewer.orgId, stepId);
  if (step.handler !== "human_select" || step.status !== "awaiting_input") throw conflict("This step isn't waiting for a selection.");
  if (!selected.length) throw new AppError("Select at least one.");
  const { steps } = await loadProduction(viewer.orgId, production.id);
  const source = steps.find((s) => s.key === step.config.fromStep);
  const candidates = (getPath(source?.output, String(step.config.path ?? "items")) as { id: string; title?: string; name?: string }[] | undefined) ?? [];
  const valid = selected.filter((id) => candidates.some((c) => c.id === id));
  if (valid.length !== selected.length) throw new AppError("Unknown selection.");
  const max = typeof step.config.max === "number" ? step.config.max : typeof step.config.maxFromBrief === "string" ? Number(production.brief[step.config.maxFromBrief as string] ?? 99) : 99;
  if (valid.length > max) throw new AppError(`Select at most ${max}.`);
  const db = await getDb();
  await db.update(schema.productionSteps).set({ status: "completed", output: { selected: valid, selectedBy: viewer.userId, selectedAt: new Date().toISOString() }, finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.productionSteps.id, stepId));
  await closeApprovals(viewer.orgId, "production_step", stepId, "approved", viewer.userId);
  for (const c of candidates) {
    const picked = valid.includes(c.id);
    if (!picked && !reasons[c.id]) continue;
    await recordDecision(viewer.orgId, viewer.userId, {
      kind: picked ? "selection" : "rejection",
      summary: `${picked ? "Selected" : "Passed on"} “${c.title ?? c.name ?? c.id}” (${production.department})`,
      detail: reasons[c.id] ?? "",
      department: production.department,
      characterIds: production.characterIds,
      tags: [String(step.config.path ?? "items")],
      sourceType: "production_step",
      sourceId: stepId,
    });
  }
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "step.selection", targetType: "production_step", targetId: stepId, data: { selected: valid } });
  await advance(production.id);
}

/** Approve an approval-gated step or human review gate. */
export async function approveStep(viewer: Viewer, stepId: string, note = "") {
  assertCan(viewer, "review:approve");
  const { step, production } = await loadStep(viewer.orgId, stepId);
  if (step.status !== "awaiting_approval") throw conflict("This step isn't awaiting approval.");
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(schema.productionSteps).set({ status: "completed", output: step.handler === "human_review" ? { approvedBy: viewer.userId, note, approvedAt: new Date().toISOString() } : step.output, finishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.productionSteps.id, stepId));
    if (step.handler === "human_review" && step.config.reviewsStep) {
      const [reviewed] = await tx.select().from(schema.productionSteps).where(and(eq(schema.productionSteps.productionId, production.id), eq(schema.productionSteps.key, String(step.config.reviewsStep))));
      if (reviewed) {
        // Approving the gate approves that step's deliverables still waiting for review.
        await tx
          .update(schema.generatedAssets)
          .set({ status: "approved", updatedAt: new Date() })
          .where(and(eq(schema.generatedAssets.stepId, reviewed.id), eq(schema.generatedAssets.status, "ready_for_review")));
      }
    }
    await closeApprovals(viewer.orgId, "production_step", stepId, "approved", viewer.userId, note, tx);
    await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "step.approved", targetType: "production_step", targetId: stepId, data: { note } }, tx);
  });
  await advance(production.id);
}

/** Request changes: the reviewed step re-runs with the notes; the gate waits again. */
export async function requestStepChanges(viewer: Viewer, stepId: string, notes: string) {
  assertCan(viewer, "review:comment");
  const { step, production } = await loadStep(viewer.orgId, stepId);
  if (step.status !== "awaiting_approval") throw conflict("This step isn't awaiting approval.");
  if (!notes.trim()) throw new AppError("Describe the changes you need.");
  const target = step.handler === "human_review" ? String(step.config.reviewsStep ?? "") : step.key;
  const { steps } = await loadProduction(viewer.orgId, production.id);
  const targetStep = steps.find((s) => s.key === target);
  if (!targetStep) throw new AppError("Nothing to send back.");
  await closeApprovals(viewer.orgId, "production_step", stepId, "rejected", viewer.userId, notes);
  await recordDecision(viewer.orgId, viewer.userId, { kind: "correction", summary: `Changes requested on “${targetStep.name}” (${production.title})`, detail: notes, department: production.department, characterIds: production.characterIds, tags: [targetStep.handler], sourceType: "production_step", sourceId: targetStep.id });
  const db = await getDb();
  if (step.id !== targetStep.id) await db.update(schema.productionSteps).set({ status: "changes_requested" }).where(eq(schema.productionSteps.id, step.id));
  await rerunStep(viewer, targetStep.id, notes);
}

/** Humans may edit any agent deliverable; edits are audited and flow downstream on the next run. */
export async function editStepOutput(viewer: Viewer, stepId: string, output: Record<string, unknown>) {
  assertCan(viewer, "production:create");
  const { step } = await loadStep(viewer.orgId, stepId);
  if (!["completed", "awaiting_approval"].includes(step.status)) throw conflict("Only finished outputs can be edited.");
  if (step.handler === "human_select" || step.handler === "human_review") throw new AppError("Human decisions can't be edited – re-run the step instead.");
  const type = STEP_TYPES[String(step.config.type)];
  if (type?.schemaKey) {
    const { S } = await import("./schemas");
    S[type.schemaKey].parse(output);
  }
  const db = await getDb();
  await db.update(schema.productionSteps).set({ output: { ...output, _editedBy: viewer.name, _editedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(schema.productionSteps.id, stepId));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "step.output_edited", targetType: "production_step", targetId: stepId });
}

/** Raise a production's budget (resolves a spend approval). */
export async function raiseBudget(viewer: Viewer, productionId: string, budgetCents: number) {
  assertCan(viewer, "budget:approve");
  const { production, steps } = await loadProduction(viewer.orgId, productionId);
  if (budgetCents <= production.budgetCents) throw new AppError("The new budget must be higher.");
  const db = await getDb();
  await db.update(schema.productions).set({ budgetCents, updatedAt: new Date() }).where(eq(schema.productions.id, productionId));
  await closeApprovals(viewer.orgId, "production", productionId, "approved", viewer.userId, `Budget raised to ${budgetCents}`);
  for (const st of steps.filter((s) => s.status === "blocked" && s.blockedOn === "budget")) {
    await db.update(schema.productionSteps).set({ status: "pending", attempts: 0, blockedOn: null, error: null }).where(eq(schema.productionSteps.id, st.id));
    await closeApprovals(viewer.orgId, "production_step", st.id, "approved", viewer.userId, "Budget raised");
  }
  if (production.status === "blocked") await db.update(schema.productions).set({ status: "running" }).where(eq(schema.productions.id, productionId));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "production.budget_raised", targetType: "production", targetId: productionId, data: { from: production.budgetCents, to: budgetCents } });
  await advance(productionId);
}

/**
 * Autonomous agent team.
 *
 * A mission is a goal handed to the Studio Director, who plans and delegates
 * to specialists. Each task is its own tool-using loop running as durable
 * jobs. Conversations are append-only and persisted after every turn, so a
 * task can pause – waiting on teammates or on a human decision – and resume
 * exactly where it left off, even after a restart.
 */
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { TranscriptEntry } from "@/db/schema";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { AppError, BudgetExceededError, IntegrationRequiredError, ProviderError, conflict, notFound } from "@/lib/errors";
import { assertCan, type Viewer } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/permissions";
import { enqueue, cancelJobsFor } from "@/lib/jobs/queue";
import { closeApprovals } from "@/lib/review/approvals";
import { agentTurn, adapterOf } from "@/lib/providers/gateway";
import type { ToolResult } from "@/lib/providers/types";
import { buildContextPack, packToPrompt } from "@/lib/brain/context";
import { getOrgSettings } from "@/lib/org";
import { env } from "@/lib/env";
import { AGENT_BY_KEY } from "./definitions";
import { getAgentConfig, recordRun } from "./run";
import { charactersForPack, runTool, toolsFor, type MissionRow, type TaskRow, type ToolCtx } from "./tools";

export const MAX_TURNS_PER_TASK = 16;

const TEAM_RULES = `You are working as part of the CALMLINGS OS autonomous agent team.
- Use your tools to do real work. Retrieve approved canon (search_canon) before creative work.
- Save deliverables with write_document (or generate_image where you have it). Everything you make goes to human review.
- If something needs the creative director's decision, call request_approval and wait.
- Be economical: the mission has a budget.
- When your task is complete, reply WITHOUT calling a tool: give a concise final report of what you produced (with asset ids) and anything that needs attention.`;

const LEAD_RULES = `You lead this mission. Break the goal into well-scoped tasks and delegate them to the right specialists (delegate), run independent tasks in parallel, then await_reports, review the results against canon and the brief, ask for revisions or follow-ups if needed, and finish with a report for the creative director. For heavy media pipelines (full videos, game asset batches, product ranges) use propose_production – it becomes a plan the creative director approves.`;

/* ------------------------------------------------------------------ */

export const startMissionInput = z.object({
  goal: z.string().min(3).max(4000),
  characterIds: z.array(z.string()).default([]),
  budgetCents: z.number().int().min(10).max(1_000_000).optional(),
});

export async function startMission(viewer: Viewer, raw: unknown) {
  assertCan(viewer, "production:create");
  const input = startMissionInput.parse(raw);
  const settings = await getOrgSettings(viewer.orgId);
  const db = await getDb();
  const id = newId("msn");
  const mission = { id, orgId: viewer.orgId, goal: input.goal, characterIds: input.characterIds, budgetCents: input.budgetCents ?? settings.defaultProductionBudgetCents, createdBy: viewer.userId, status: "running" };
  await db.insert(schema.missions).values(mission);
  const [row] = await db.select().from(schema.missions).where(eq(schema.missions.id, id));
  await createTask(row, { parent: null, agentKey: "studio_director", title: "Lead the mission", instructions: input.goal });
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "mission.started", targetType: "mission", targetId: id, data: { goal: input.goal } });
  return id;
}

export async function createTask(mission: MissionRow, t: { parent: TaskRow | null; agentKey: string; title: string; instructions: string }) {
  const db = await getDb();
  const id = newId("tsk");
  const agent = AGENT_BY_KEY[t.agentKey];
  const brief = t.parent
    ? `Task from ${AGENT_BY_KEY[t.parent.agentKey]?.name ?? t.parent.agentKey} for the mission “${mission.goal}”.\n\nTask: ${t.title}\n\n${t.instructions}`
    : `Mission from the creative director:\n\n${t.instructions}`;
  await db.insert(schema.missionTasks).values({
    id,
    missionId: mission.id,
    orgId: mission.orgId,
    parentTaskId: t.parent?.id ?? null,
    agentKey: t.agentKey,
    title: t.title,
    instructions: brief,
    depth: t.parent ? t.parent.depth + 1 : 0,
    status: "queued",
    transcript: [{ at: new Date().toISOString(), kind: "note", text: `${agent?.name ?? t.agentKey} picked up: ${t.title}` }],
  });
  await queueTask(mission.orgId, id);
  return id;
}

async function queueTask(orgId: string, taskId: string) {
  await enqueue({ orgId, type: "agent_task", payload: { taskId, missionId: (await taskById(taskId))?.missionId ?? null }, idempotencyKey: `agent_task:${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` });
}

async function taskById(id: string) {
  const db = await getDb();
  const [t] = await db.select().from(schema.missionTasks).where(eq(schema.missionTasks.id, id));
  return t ?? null;
}

/** A Viewer acting for the mission's creator (used when an agent proposes a production plan). */
export async function missionViewer(mission: MissionRow): Promise<Viewer> {
  const db = await getDb();
  const [r] = await db
    .select({ u: schema.users, m: schema.memberships, o: schema.organisations })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.organisations, eq(schema.organisations.id, schema.memberships.orgId))
    .where(and(eq(schema.memberships.orgId, mission.orgId), mission.createdBy ? eq(schema.memberships.userId, mission.createdBy) : sql`true`))
    .orderBy(asc(schema.memberships.createdAt))
    .limit(1);
  if (!r) throw new AppError("The mission's owner no longer exists.");
  return { userId: r.u.id, name: r.u.name, email: r.u.email, orgId: r.o.id, orgName: r.o.name, role: r.m.role as Role };
}

export async function childReports(taskId: string): Promise<{ pending: boolean; text: string }> {
  const db = await getDb();
  const kids = await db.select().from(schema.missionTasks).where(eq(schema.missionTasks.parentTaskId, taskId)).orderBy(asc(schema.missionTasks.createdAt));
  const pending = kids.some((k) => !["done", "failed", "cancelled", "blocked"].includes(k.status));
  const text = kids
    .map((k) => `### ${AGENT_BY_KEY[k.agentKey]?.name ?? k.agentKey} – ${k.title} [${k.status}]\n${k.status === "done" ? (k.report ?? "") : (k.error ?? "No report.")}${k.outputs.length ? `\nOutputs: ${k.outputs.map((o) => `${o.type} ${o.id} “${o.title}”`).join("; ")}` : ""}`)
    .join("\n\n");
  return { pending, text };
}

/* ------------------------------------------------------------------ */
/* Running a task                                                      */
/* ------------------------------------------------------------------ */

async function missionSpent(missionId: string) {
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${schema.costRecords.costCents}),0)::float` }).from(schema.costRecords).where(eq(schema.costRecords.missionId, missionId));
  return Number(r?.n ?? 0);
}

export async function runAgentTask(taskId: string) {
  const db = await getDb();
  // Claim atomically so the same task never runs twice at once.
  const claimed = await db.update(schema.missionTasks).set({ status: "running", updatedAt: new Date() }).where(and(eq(schema.missionTasks.id, taskId), eq(schema.missionTasks.status, "queued"))).returning();
  const task = claimed[0];
  if (!task) return;
  const [mission] = await db.select().from(schema.missions).where(eq(schema.missions.id, task.missionId));
  if (!mission || ["cancelled", "completed"].includes(mission.status)) {
    await db.update(schema.missionTasks).set({ status: "cancelled" }).where(eq(schema.missionTasks.id, taskId));
    return;
  }
  const agent = await getAgentConfig(mission.orgId, task.agentKey);
  const transcript = [...task.transcript];
  const outputs = [...task.outputs];
  let messages = [...task.messages];
  let turns = task.turns;
  let provider = task.provider;
  let cost = task.costCents;
  const started = Date.now();
  const timeBudget = env.serverless ? 40_000 : 10 * 60_000;

  const log = (e: Omit<TranscriptEntry, "at">) => transcript.push({ at: new Date().toISOString(), ...e, text: e.text.slice(0, 2000) });
  const save = async (patch: Partial<typeof schema.missionTasks.$inferInsert> = {}) => {
    await db.update(schema.missionTasks).set({ messages, transcript: transcript.slice(-200), outputs, turns, provider, costCents: cost, updatedAt: new Date(), ...patch }).where(eq(schema.missionTasks.id, taskId));
  };
  const ensureBudget = async (cents: number) => {
    const spent = await missionSpent(mission.id);
    if (spent + cents > mission.budgetCents) throw new BudgetExceededError(`The mission budget of $${(mission.budgetCents / 100).toFixed(2)} would be exceeded ($${(spent / 100).toFixed(2)} spent).`, cents, mission.budgetCents - spent);
  };
  const ctx: ToolCtx = {
    mission,
    task,
    agent,
    log,
    addOutput: (o) => outputs.push(o),
    ensureBudget,
    pack: async (names = []) => buildContextPack(mission.orgId, { characterIds: await charactersForPack(mission.orgId, mission, names), department: agent.department, query: mission.goal }),
  };

  try {
    if (!agent.enabled) throw new AppError(`${agent.name} is switched off in Agent Headquarters.`);
    const tools = toolsFor(agent, task);
    const system = `${agent.instructions}\n\n${TEAM_RULES}${tools.some((t) => t.name === "delegate") ? `\n\n${LEAD_RULES}\nTeammates you can delegate to (key – role):\n${Object.values(AGENT_BY_KEY).filter((a) => a.key !== agent.key).map((a) => `${a.key} – ${a.name}: ${a.role}`).join("\n")}` : ""}`;
    const pack = await ctx.pack();
    const context = packToPrompt(pack);

    if (!messages.length) {
      // First run: pick the provider for this conversation (formats differ by provider).
      const first = await agentTurnFor(mission, task, provider, { system, context, messages: [{ role: "user", content: task.instructions }], tools });
      provider = first.provider;
      messages = [{ role: "user", content: task.instructions }];
      await handleTurn(first);
    }
    while (true) {
      const current = await taskById(taskId);
      if (current?.status !== "running") return;
      if (turns >= MAX_TURNS_PER_TASK) throw new AppError(`Stopped after ${MAX_TURNS_PER_TASK} turns without finishing.`);
      if (Date.now() - started > timeBudget) {
        await save({ status: "queued" });
        await queueTask(mission.orgId, taskId);
        return;
      }
      const res = await agentTurnFor(mission, task, provider, { system, context, messages, tools });
      const stop = await handleTurn(res);
      if (stop) return;
    }

    async function handleTurn(res: Awaited<ReturnType<typeof agentTurnFor>>): Promise<boolean> {
      turns++;
      cost += res.costCents;
      messages.push(...res.append);
      if (res.text) log({ kind: "note", text: res.text });
      if (res.done) {
        await save({ status: "done", report: res.text || "(no report)", pendingToolUseId: null, pendingResults: [] });
        await recordRun({ orgId: mission.orgId, agentKey: task.agentKey, task: `${task.title} (mission)`, status: "succeeded", provider: res.provider, model: res.model, costCents: cost, durationMs: Date.now() - started, output: { report: res.text, outputs } });
        await onTaskFinished(taskId);
        return true;
      }
      const results: ToolResult[] = [];
      for (const call of res.toolCalls) {
        log({ kind: "tool", tool: call.name, text: describeCall(call.name, call.input), data: call.input });
        const out = await runTool(ctx, call.name, call.input);
        if (typeof out === "string") {
          results.push({ id: call.id, content: out, isError: out.startsWith("Tool error") });
          log({ kind: "result", tool: call.name, text: out.slice(0, 600) });
          continue;
        }
        // Suspend: hold results computed so far plus any remaining calls (answered on resume).
        const remaining = res.toolCalls.slice(res.toolCalls.indexOf(call) + 1);
        for (const r of remaining) results.push({ id: r.id, content: "Not run – the task paused before this call. Call it again if still needed.", isError: true });
        if (out.suspend === "team") log({ kind: "note", text: "Waiting for teammates to report back…" });
        else log({ kind: "note", text: "Waiting for the creative director's decision…" });
        await save({ status: out.suspend === "team" ? "waiting_team" : "waiting_approval", pendingToolUseId: call.id, pendingApprovalId: out.approvalId ?? null, pendingResults: results });
        await refreshMission(mission.id);
        if (out.suspend === "team") await maybeResumeParent(taskId); // children may have already finished
        return true;
      }
      messages.push(...toolResultMessages(provider!, results));
      await save();
      return false;
    }
  } catch (err) {
    const blocked = err instanceof IntegrationRequiredError || err instanceof BudgetExceededError;
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ProviderError && err.retryable) {
      log({ kind: "error", text: `Provider hiccup, retrying shortly: ${message}` });
      await save({ status: "queued" });
      await enqueue({ orgId: mission.orgId, type: "agent_task", payload: { taskId, missionId: mission.id }, idempotencyKey: `agent_task:${taskId}:retry:${Date.now()}`, runAfter: new Date(Date.now() + (err.retryAfterMs ?? 10_000)) });
      return;
    }
    log({ kind: "error", text: message });
    await save({ status: blocked ? "blocked" : "failed", error: message });
    await recordRun({ orgId: mission.orgId, agentKey: task.agentKey, task: `${task.title} (mission)`, status: "failed", provider, costCents: cost, durationMs: Date.now() - started, error: message });
    await onTaskFinished(taskId);
  }
}

async function agentTurnFor(mission: MissionRow, task: TaskRow, provider: string | null, req: Parameters<typeof agentTurn>[1]) {
  const ensure = await missionSpent(mission.id);
  if (ensure + 5 > mission.budgetCents) throw new BudgetExceededError(`The mission budget of $${(mission.budgetCents / 100).toFixed(2)} has been used.`, 5, mission.budgetCents - ensure);
  const cfg = await getAgentConfig(mission.orgId, task.agentKey);
  return agentTurn({ orgId: mission.orgId, missionId: mission.id }, { ...req, effort: cfg.qualityPreference === "best" ? "high" : cfg.qualityPreference === "balanced" ? "medium" : "low" }, { override: provider, quality: cfg.qualityPreference });
}

function toolResultMessages(provider: string, results: ToolResult[]): unknown[] {
  const a = adapterOf(provider);
  if (!a?.toolResults) throw new AppError(`Provider ${provider} can't continue this conversation.`);
  return a.toolResults(results);
}

function describeCall(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === "string" ? String(input[k]).slice(0, 120) : "");
  switch (name) {
    case "search_canon":
      return `Reading canon on ${s("topic")}`;
    case "delegate":
      return `Delegating “${s("title")}” to ${AGENT_BY_KEY[s("agent")]?.name ?? s("agent")}`;
    case "write_document":
      return `Writing “${s("title")}”`;
    case "generate_image":
      return `Generating image “${s("title")}”`;
    case "propose_canon":
      return `Proposing lore “${s("title")}”`;
    case "propose_production":
      return `Setting up production “${s("title")}”`;
    case "request_approval":
      return `Asking the creative director: ${s("question")}`;
    case "await_reports":
      return "Waiting for team reports";
    default:
      return name.replace(/_/g, " ");
  }
}

/* ------------------------------------------------------------------ */
/* Coordination                                                        */
/* ------------------------------------------------------------------ */

async function onTaskFinished(taskId: string) {
  const t = await taskById(taskId);
  if (!t) return;
  if (t.parentTaskId) await maybeResumeParent(t.parentTaskId, true);
  await refreshMission(t.missionId);
}

/** When every delegated task has finished, give the waiting lead its reports and continue. */
async function maybeResumeParent(parentId: string, fromChild = false) {
  void fromChild;
  const db = await getDb();
  const parent = await taskById(parentId);
  if (!parent || parent.status !== "waiting_team" || !parent.pendingToolUseId || !parent.provider) return;
  const r = await childReports(parentId);
  if (r.pending) return;
  const results = [...parent.pendingResults.filter((x) => x.id !== parent.pendingToolUseId), { id: parent.pendingToolUseId, content: r.text || "No reports.", isError: false }];
  const ordered = orderResults(parent.messages, results);
  const resumed = await db
    .update(schema.missionTasks)
    .set({ status: "queued", messages: [...parent.messages, ...toolResultMessages(parent.provider, ordered)], pendingToolUseId: null, pendingResults: [], transcript: [...parent.transcript, { at: new Date().toISOString(), kind: "result", tool: "await_reports", text: "Team reports received." }], updatedAt: new Date() })
    .where(and(eq(schema.missionTasks.id, parentId), eq(schema.missionTasks.status, "waiting_team")))
    .returning({ id: schema.missionTasks.id });
  if (resumed.length) await queueTask(parent.orgId, parentId);
}

/** Tool results must follow the order of the tool calls in the last assistant turn. */
function orderResults(messages: unknown[], results: ToolResult[]): ToolResult[] {
  const last = [...messages].reverse().find((m) => (m as { role?: string }).role === "assistant") as { content?: unknown; tool_calls?: { id: string }[] } | undefined;
  const ids: string[] = Array.isArray(last?.content) ? (last!.content as { type: string; id?: string }[]).filter((b) => b.type === "tool_use").map((b) => b.id!) : (last?.tool_calls ?? []).map((c) => c.id);
  if (!ids.length) return results;
  return ids.map((id) => results.find((r) => r.id === id) ?? { id, content: "No result.", isError: true });
}

/** Called when a human decides a request_approval from an agent. */
export async function resumeAfterDecision(orgId: string, taskId: string, approved: boolean, note: string | null) {
  const db = await getDb();
  const t = await taskById(taskId);
  if (!t || t.orgId !== orgId || t.status !== "waiting_approval" || !t.pendingToolUseId || !t.provider) return;
  const answer = `${approved ? "APPROVED" : "DECLINED"} by the creative director.${note ? ` Note: ${note}` : ""}`;
  const results = orderResults(t.messages, [...t.pendingResults.filter((x) => x.id !== t.pendingToolUseId), { id: t.pendingToolUseId, content: answer, isError: false }]);
  await db
    .update(schema.missionTasks)
    .set({ status: "queued", messages: [...t.messages, ...toolResultMessages(t.provider, results)], pendingToolUseId: null, pendingApprovalId: null, pendingResults: [], transcript: [...t.transcript, { at: new Date().toISOString(), kind: "human", text: answer }], updatedAt: new Date() })
    .where(eq(schema.missionTasks.id, taskId));
  await queueTask(orgId, taskId);
  await refreshMission(t.missionId);
}

export async function refreshMission(missionId: string) {
  const db = await getDb();
  const [m] = await db.select().from(schema.missions).where(eq(schema.missions.id, missionId));
  if (!m || ["cancelled"].includes(m.status)) return;
  const tasks = await db.select().from(schema.missionTasks).where(eq(schema.missionTasks.missionId, missionId));
  const root = tasks.find((t) => !t.parentTaskId);
  let status = "running";
  let report: string | null = m.report;
  let error: string | null = null;
  if (root?.status === "done") {
    status = "completed";
    report = root.report;
  } else if (root?.status === "failed") {
    status = "failed";
    error = root.error;
  } else if (tasks.some((t) => t.status === "waiting_approval")) status = "awaiting_approval";
  else if (root?.status === "blocked" || (tasks.some((t) => t.status === "blocked") && !tasks.some((t) => ["running", "queued"].includes(t.status)))) {
    status = "blocked";
    error = tasks.find((t) => t.status === "blocked")?.error ?? null;
  }
  await db.update(schema.missions).set({ status, report, error, spentCents: await missionSpent(missionId), updatedAt: new Date() }).where(eq(schema.missions.id, missionId));
}

export async function cancelMission(viewer: Viewer, id: string) {
  assertCan(viewer, "production:run");
  const db = await getDb();
  const [m] = await db.select().from(schema.missions).where(and(eq(schema.missions.id, id), eq(schema.missions.orgId, viewer.orgId)));
  if (!m) throw notFound("Mission not found.");
  if (m.status === "completed") throw conflict("This mission has finished.");
  await db.update(schema.missions).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.missions.id, id));
  const open = await db.update(schema.missionTasks).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(schema.missionTasks.missionId, id), inArray(schema.missionTasks.status, ["queued", "waiting_team", "waiting_approval", "blocked"]))).returning({ id: schema.missionTasks.id });
  for (const t of open) await closeApprovals(viewer.orgId, "mission_task", t.id, "withdrawn", viewer.userId, "Mission stopped");
  await cancelJobsFor("missionId", id);
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "mission.cancelled", targetType: "mission", targetId: id });
}

/** Resume a stopped, blocked or failed mission. Finished tasks keep their work. */
export async function resumeMission(viewer: Viewer, id: string) {
  assertCan(viewer, "production:run");
  const db = await getDb();
  const [m] = await db.select().from(schema.missions).where(and(eq(schema.missions.id, id), eq(schema.missions.orgId, viewer.orgId)));
  if (!m) throw notFound("Mission not found.");
  await db.update(schema.missions).set({ status: "running", error: null, updatedAt: new Date() }).where(eq(schema.missions.id, id));
  const tasks = await db.select().from(schema.missionTasks).where(eq(schema.missionTasks.missionId, id));
  for (const t of tasks.filter((x) => ["failed", "blocked", "cancelled"].includes(x.status))) {
    // A task that was mid-wait goes back to waiting; others re-run from their saved conversation.
    const status = t.pendingToolUseId ? (t.pendingApprovalId ? "waiting_approval" : "waiting_team") : "queued";
    await db.update(schema.missionTasks).set({ status, error: null, turns: Math.min(t.turns, MAX_TURNS_PER_TASK - 4), updatedAt: new Date() }).where(eq(schema.missionTasks.id, t.id));
    if (status === "queued") await queueTask(viewer.orgId, t.id);
  }
  for (const t of tasks) await maybeResumeParent(t.id);
  await refreshMission(id);
}

export async function raiseMissionBudget(viewer: Viewer, id: string, budgetCents: number) {
  assertCan(viewer, "budget:approve");
  const db = await getDb();
  await db.update(schema.missions).set({ budgetCents, updatedAt: new Date() }).where(and(eq(schema.missions.id, id), eq(schema.missions.orgId, viewer.orgId)));
  await resumeMission(viewer, id);
}

export async function getMission(orgId: string, id: string) {
  const db = await getDb();
  const [m] = await db.select().from(schema.missions).where(and(eq(schema.missions.id, id), eq(schema.missions.orgId, orgId)));
  if (!m) throw notFound("Mission not found.");
  const tasks = await db.select().from(schema.missionTasks).where(eq(schema.missionTasks.missionId, id)).orderBy(asc(schema.missionTasks.createdAt));
  return { mission: m, tasks };
}

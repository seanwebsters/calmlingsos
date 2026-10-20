/**
 * Studio tools available to autonomous agents. Every tool goes through the
 * same services, permissions and canon rules as the UI: agents can read
 * approved canon, draft work, generate media with approved references,
 * delegate to teammates and ask humans – never publish, alter canon directly
 * or spend past the mission budget.
 */
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TranscriptEntry } from "@/db/schema";
import { buildContextPack, packProvenance, packToPrompt, type ContextPack } from "@/lib/brain/context";
import { createCanon } from "@/lib/brain/canon";
import { listCharacters } from "@/lib/brain/characters";
import { createGeneratedAsset, emptyProvenance } from "@/lib/review/assets";
import { createApproval } from "@/lib/review/approvals";
import { generateImage } from "@/lib/providers/gateway";
import { AppError, IntegrationRequiredError } from "@/lib/errors";
import type { ToolSpec } from "@/lib/providers/types";
import { identityPrompt, imageRefsFor, loadRefs, requireRefs } from "@/lib/workflows/handlers/common";
import { AGENT_BY_KEY, AGENTS, type AgentDefinition } from "./definitions";
import { PROMPT_VERSION } from "./run";
import { listTemplates } from "@/lib/workflows/registry";

export type TaskRow = typeof schema.missionTasks.$inferSelect;
export type MissionRow = typeof schema.missions.$inferSelect;

export interface ToolCtx {
  mission: MissionRow;
  task: TaskRow;
  agent: AgentDefinition;
  log(entry: Omit<TranscriptEntry, "at">): void;
  addOutput(o: { type: string; id: string; title: string }): void;
  ensureBudget(cents: number): Promise<void>;
  pack(characterNames?: string[]): Promise<ContextPack>;
}

export type ToolOutcome = string | { suspend: "team" | "approval"; approvalId?: string; content?: string };

interface Tool {
  spec: ToolSpec;
  allowed(agent: AgentDefinition, task: TaskRow): boolean;
  run(ctx: ToolCtx, input: Record<string, unknown>): Promise<ToolOutcome>;
}

export const MAX_DEPTH = 2;
export const MAX_TASKS_PER_MISSION = 30;

const str = (v: unknown, max = 20000) => (typeof v === "string" ? v.slice(0, max) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const isLead = (a: AgentDefinition) => a.department === "executive";

async function resolveNames(orgId: string, names: string[]) {
  const chars = await listCharacters(orgId);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const c = chars.find((x) => x.name.toLowerCase() === n.toLowerCase() || x.code.toLowerCase() === n.toLowerCase());
    if (c) ids.push(c.id);
    else unknown.push(n);
  }
  return { ids, unknown };
}

const TOOLS: Record<string, Tool> = {
  list_characters: {
    spec: { name: "list_characters", description: "List the Calmlings characters in the library with canon status and how many approved references each has.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    allowed: () => true,
    async run(ctx) {
      const chars = await listCharacters(ctx.mission.orgId);
      if (!chars.length) return "The character library is empty. Do not invent characters; tell the creative director that official characters and references need to be added.";
      return chars.map((c) => `${c.name} (${c.code}) – ${c.approvedVersionId ? "approved canon" : "NO approved canon"}; ${c.masterCount} official masters, ${c.supportingCount} supporting references`).join("\n");
    },
  },
  search_canon: {
    spec: {
      name: "search_canon",
      description: "Retrieve approved Calmlings canon (character profiles, world/brand/lore records, creative director rules) for the named characters and a topic. Always do this before creative work.",
      inputSchema: { type: "object", properties: { characters: { type: "array", items: { type: "string" }, description: "Character names or codes" }, topic: { type: "string" } }, required: ["characters", "topic"], additionalProperties: false },
    },
    allowed: () => true,
    async run(ctx, input) {
      const pack = await ctx.pack(strs(input.characters));
      const text = packToPrompt({ ...pack, semantic: pack.semantic });
      return text.slice(0, 14000);
    },
  },
  list_references: {
    spec: { name: "list_references", description: "List approved reference files for a character (official masters and supporting references).", inputSchema: { type: "object", properties: { character: { type: "string" } }, required: ["character"], additionalProperties: false } },
    allowed: () => true,
    async run(ctx, input) {
      const pack = await ctx.pack([str(input.character)]);
      if (!pack.references.length) return `No approved references for ${str(input.character)}. Visual generation for them is blocked until a human uploads and approves references.`;
      return pack.references.map((r) => `${r.title} [${r.designation}${r.viewAngle ? `, ${r.viewAngle}` : ""}] ${r.mediaKind}${r.analysisSummary ? ` – ${r.analysisSummary}` : ""}`).join("\n");
    },
  },
  delegate: {
    spec: {
      name: "delegate",
      description: "Hand a well-scoped task to a specialist teammate. They work in parallel and report back; call await_reports to receive their reports. Give complete instructions – they only see what you write plus approved canon.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", enum: AGENTS.map((a) => a.key), description: "Teammate agent key" },
          title: { type: "string", description: "Short task title" },
          instructions: { type: "string", description: "What to produce, constraints, and the deliverable expected back" },
        },
        required: ["agent", "title", "instructions"],
        additionalProperties: false,
      },
    },
    allowed: (a, t) => isLead(a) && t.depth < MAX_DEPTH,
    async run(ctx, input) {
      const key = str(input.agent);
      const target = AGENT_BY_KEY[key];
      if (!target) return `Unknown agent "${key}".`;
      if (key === ctx.task.agentKey) return "You can't delegate to yourself.";
      const db = await getDb();
      const all = await db.select({ id: schema.missionTasks.id }).from(schema.missionTasks).where(eq(schema.missionTasks.missionId, ctx.mission.id));
      if (all.length >= MAX_TASKS_PER_MISSION) return `The mission already has ${all.length} tasks (limit ${MAX_TASKS_PER_MISSION}). Work with the reports you have.`;
      const { createTask } = await import("./team");
      const id = await createTask(ctx.mission, { parent: ctx.task, agentKey: key, title: str(input.title, 200) || "Task", instructions: str(input.instructions) });
      ctx.log({ kind: "handoff", text: `Handed “${str(input.title, 200)}” to ${target.name}`, data: { to: key, taskId: id } });
      return `Delegated to ${target.name} as task ${id}. They are working on it now. Call await_reports when you need their results.`;
    },
  },
  await_reports: {
    spec: { name: "await_reports", description: "Wait for every task you delegated to finish and receive their reports.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    allowed: (a) => isLead(a),
    async run(ctx) {
      const { childReports } = await import("./team");
      const r = await childReports(ctx.task.id);
      if (r.pending) return { suspend: "team" };
      return r.text || "You have not delegated anything.";
    },
  },
  write_document: {
    spec: {
      name: "write_document",
      description: "Save a deliverable document (concepts, script, treatment, pitch, plan…) as Markdown. It goes to the Approvals queue for human review.",
      inputSchema: { type: "object", properties: { title: { type: "string" }, markdown: { type: "string" }, characters: { type: "array", items: { type: "string" } } }, required: ["title", "markdown", "characters"], additionalProperties: false },
    },
    allowed: () => true,
    async run(ctx, input) {
      const { ids } = await resolveNames(ctx.mission.orgId, strs(input.characters));
      const pack = await ctx.pack(strs(input.characters));
      const p = packProvenance(pack);
      const asset = await createGeneratedAsset({
        orgId: ctx.mission.orgId,
        itemKey: `mission:${ctx.task.id}:${Date.now()}`,
        kind: "document",
        role: "document",
        title: str(input.title, 200) || "Document",
        textContent: `${str(input.markdown, 60000)}\n\n---\n_Draft by ${ctx.agent.name} (CALMLINGS OS agent team). Not approved until a human approves it._`,
        characterIds: ids,
        provenance: { ...emptyProvenance({ promptVersion: PROMPT_VERSION }), ...p, provider: ctx.task.provider, parameters: { missionId: ctx.mission.id, taskId: ctx.task.id, agent: ctx.agent.key } },
      });
      ctx.addOutput({ type: "document", id: asset.id, title: asset.title });
      return `Saved “${asset.title}” for review (asset ${asset.id}).`;
    },
  },
  generate_image: {
    spec: {
      name: "generate_image",
      description: "Generate an image. Any Calmlings character named is rendered from their APPROVED reference images (never invent their look). Fails if a character has no approved reference. Costs money – use deliberately.",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, prompt: { type: "string", description: "Scene, composition, mood. Don't describe character appearance – references handle identity." }, characters: { type: "array", items: { type: "string" } }, aspect: { type: "string", enum: ["1:1", "9:16", "16:9", "4:5"] } },
        required: ["title", "prompt", "characters", "aspect"],
        additionalProperties: false,
      },
    },
    allowed: (a) => a.permissions.includes("generate_images"),
    async run(ctx, input) {
      const pack = await ctx.pack(strs(input.characters));
      const { ids, unknown } = await resolveNames(ctx.mission.orgId, strs(input.characters));
      if (unknown.length) return `Unknown characters: ${unknown.join(", ")}. Only existing characters can be generated.`;
      try {
        requireRefs(pack, ids);
      } catch (e) {
        if (e instanceof IntegrationRequiredError) return `BLOCKED: ${e.message}`;
        throw e;
      }
      await ctx.ensureBudget(8);
      const refs = imageRefsFor(pack, ids);
      const binaries = await loadRefs(refs, pack);
      const prompt = `${str(input.prompt, 4000)}${identityPrompt(pack, ids)}`;
      const aspect = (["1:1", "9:16", "16:9", "4:5"].includes(str(input.aspect)) ? str(input.aspect) : "1:1") as "1:1";
      const res = await generateImage({ orgId: ctx.mission.orgId, missionId: ctx.mission.id }, { prompt, references: binaries, aspectRatio: aspect }, { quality: "best" });
      const asset = await createGeneratedAsset({
        orgId: ctx.mission.orgId,
        itemKey: `mission:${ctx.task.id}:${Date.now()}`,
        kind: "image",
        role: "concept_image",
        title: str(input.title, 200) || "Image",
        data: res.data,
        mimeType: res.mimeType,
        characterIds: ids,
        costCents: res.costCents,
        provenance: { ...emptyProvenance({ promptVersion: PROMPT_VERSION, prompt }), ...packProvenance(pack), referenceAssetVersionIds: refs.map((r) => r.versionId), provider: res.provider, model: res.model, parameters: { missionId: ctx.mission.id, taskId: ctx.task.id, aspectRatio: aspect, regen: { kind: "image", prompt: str(input.prompt, 4000), characterIds: ids, aspectRatio: aspect, transparent: false, role: "concept_image" } } },
      });
      ctx.addOutput({ type: "image", id: asset.id, title: asset.title });
      return `Generated “${asset.title}” (asset ${asset.id}) with ${refs.length} approved reference(s). It is waiting for human review.`;
    },
  },
  propose_canon: {
    spec: {
      name: "propose_canon",
      description: "Propose new world/lore canon. It is saved as DRAFT CANON (AI proposal) and only becomes official if the creative director approves it.",
      inputSchema: { type: "object", properties: { domain: { type: "string", enum: ["world", "lore"] }, kind: { type: "string" }, title: { type: "string" }, body: { type: "string" }, characters: { type: "array", items: { type: "string" } } }, required: ["domain", "kind", "title", "body", "characters"], additionalProperties: false },
    },
    allowed: (a) => a.permissions.includes("propose_canon") || isLead(a),
    async run(ctx, input) {
      const { ids } = await resolveNames(ctx.mission.orgId, strs(input.characters));
      const id = await createCanon({ orgId: ctx.mission.orgId, userId: null, agentKey: ctx.agent.key }, { domain: str(input.domain) === "lore" ? "lore" : "world", kind: str(input.kind, 60) || "lore", title: str(input.title, 200), body: str(input.body), characterIds: ids, data: { missionId: ctx.mission.id } });
      ctx.addOutput({ type: "canon", id, title: str(input.title, 200) });
      return `Saved as DRAFT CANON ${id}. It needs the creative director's approval to become official.`;
    },
  },
  propose_production: {
    spec: {
      name: "propose_production",
      description: "Set up a full production pipeline (e.g. social video with frames → video → edit → export) for heavy media work. It is created as a PLAN that the creative director must approve before anything is generated.",
      inputSchema: { type: "object", properties: { template: { type: "string", description: "Workflow template key, e.g. social_video, game_asset, product_range, animation_concepts" }, title: { type: "string" }, briefJson: { type: "string", description: "Brief fields as a JSON object string" }, characters: { type: "array", items: { type: "string" } } }, required: ["template", "title", "briefJson", "characters"], additionalProperties: false },
    },
    allowed: (a) => isLead(a),
    async run(ctx, input) {
      const templates = await listTemplates(ctx.mission.orgId);
      const tpl = templates.find((t) => t.key === str(input.template));
      if (!tpl) return `Unknown template. Available: ${templates.map((t) => t.key).join(", ")}`;
      let brief: Record<string, unknown> = {};
      try {
        brief = JSON.parse(str(input.briefJson) || "{}");
      } catch {
        return "briefJson must be a JSON object string.";
      }
      const { ids } = await resolveNames(ctx.mission.orgId, strs(input.characters));
      const { missionViewer } = await import("./team");
      const viewer = await missionViewer(ctx.mission);
      const { createProduction } = await import("@/lib/workflows/engine");
      try {
        const id = await createProduction(viewer, { templateKey: tpl.key, title: str(input.title, 200), brief, characterIds: ids, command: `Agent team mission: ${ctx.mission.goal}` });
        ctx.addOutput({ type: "production", id, title: str(input.title, 200) });
        return `Production ${id} created as a plan awaiting the creative director's approval.`;
      } catch (e) {
        return `Couldn't create the production: ${(e as Error).message}`;
      }
    },
  },
  request_approval: {
    spec: {
      name: "request_approval",
      description: "Ask the creative director to decide something before you continue (direction choice, spending, a canon question). You pause until they answer.",
      inputSchema: { type: "object", properties: { question: { type: "string" }, context: { type: "string" } }, required: ["question", "context"], additionalProperties: false },
    },
    allowed: () => true,
    async run(ctx, input) {
      const approvalId = await createApproval({ orgId: ctx.mission.orgId, kind: "mission", targetType: "mission_task", targetId: ctx.task.id, title: `${ctx.agent.name}: ${str(input.question, 300)}`, summary: str(input.context, 2000), payload: { missionId: ctx.mission.id, taskId: ctx.task.id, agentKey: ctx.agent.key }, requestedBy: ctx.agent.key });
      return { suspend: "approval", approvalId };
    },
  },
  get_performance_data: {
    spec: { name: "get_performance_data", description: "Summary of imported social performance data (only real imported metrics).", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    allowed: () => true,
    async run(ctx) {
      const db = await getDb();
      const rows = await db.select().from(schema.analyticsRecords).where(eq(schema.analyticsRecords.orgId, ctx.mission.orgId)).orderBy(desc(schema.analyticsRecords.views)).limit(25);
      if (!rows.length) return "No performance data has been imported. Do not assume any metrics.";
      return rows.map((r) => `[${r.platform}] "${r.title}" format=${r.format ?? "?"} theme=${r.theme ?? "?"} views=${r.views ?? "n/a"} shares=${r.shares ?? "n/a"} saves=${r.saves ?? "n/a"}`).join("\n");
    },
  },
};

export function toolsFor(agent: AgentDefinition, task: TaskRow): ToolSpec[] {
  return Object.values(TOOLS)
    .filter((t) => t.allowed(agent, task))
    .map((t) => t.spec);
}

export async function runTool(ctx: ToolCtx, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const tool = TOOLS[name];
  if (!tool || !tool.allowed(ctx.agent, ctx.task)) return `Tool "${name}" is not available to you.`;
  try {
    return await tool.run(ctx, input);
  } catch (e) {
    if (e instanceof IntegrationRequiredError) throw e;
    if (e instanceof AppError && e.code === "budget_exceeded") throw e;
    return `Tool error: ${(e as Error).message}`;
  }
}

export async function charactersForPack(orgId: string, mission: MissionRow, names: string[]) {
  const { ids } = await resolveNames(orgId, names);
  return [...new Set([...mission.characterIds, ...ids])];
}

export async function tasksOf(missionId: string) {
  const db = await getDb();
  return db.select().from(schema.missionTasks).where(eq(schema.missionTasks.missionId, missionId));
}

export async function tasksById(ids: string[]) {
  if (!ids.length) return [];
  const db = await getDb();
  return db.select().from(schema.missionTasks).where(and(inArray(schema.missionTasks.id, ids)));
}

export { buildContextPack };

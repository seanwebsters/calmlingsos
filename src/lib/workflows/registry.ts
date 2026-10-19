import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { WorkflowStepDef } from "@/db/schema";
import { newId, slugify } from "@/lib/ids";
import { audit } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assertCan, type Viewer } from "@/lib/auth/session";
import { AGENT_BY_KEY } from "@/lib/agents/definitions";
import { BUILT_IN_TEMPLATES, STEP_TYPES, type TemplateDef } from "./templates";
import { BRIEF_SCHEMAS, type BriefSchemaKey } from "./schemas";

export const HANDLERS = new Set(Object.values(STEP_TYPES).map((s) => s.handler));

/** Structural validation: unique keys, known handlers/agents, dependencies exist, no cycles. */
export function validateSteps(steps: Pick<WorkflowStepDef, "key" | "name" | "agent" | "handler" | "dependsOn">[]) {
  const keys = new Set<string>();
  for (const s of steps) {
    if (!/^[a-z0-9_]{1,60}$/.test(s.key)) throw new AppError(`Step key “${s.key}” must be lowercase letters, numbers or underscores.`);
    if (keys.has(s.key)) throw new AppError(`Duplicate step key “${s.key}”.`);
    keys.add(s.key);
    if (!HANDLERS.has(s.handler)) throw new AppError(`Unknown step handler “${s.handler}”.`);
    if (s.agent && !AGENT_BY_KEY[s.agent]) throw new AppError(`Unknown agent “${s.agent}”.`);
  }
  for (const s of steps) for (const d of s.dependsOn) if (!keys.has(d)) throw new AppError(`“${s.key}” depends on missing step “${d}”.`);
  const state = new Map<string, 0 | 1 | 2>();
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const visit = (k: string) => {
    if (state.get(k) === 2) return;
    if (state.get(k) === 1) throw new AppError(`Workflow has a dependency cycle through “${k}”.`);
    state.set(k, 1);
    for (const d of byKey.get(k)!.dependsOn) visit(d);
    state.set(k, 2);
  };
  for (const s of steps) visit(s.key);
}

export async function listTemplates(orgId: string): Promise<TemplateDef[]> {
  const db = await getDb();
  const custom = await db.select().from(schema.workflowTemplates).where(eq(schema.workflowTemplates.orgId, orgId));
  return [
    ...BUILT_IN_TEMPLATES,
    ...custom.map((c) => ({ key: c.key, name: c.name, department: c.department, description: c.description, briefSchema: c.briefSchema as BriefSchemaKey, steps: c.steps, version: c.version, builtIn: false })),
  ];
}

export async function getTemplate(orgId: string, key: string): Promise<TemplateDef> {
  const t = (await listTemplates(orgId)).find((x) => x.key === key);
  if (!t) throw notFound(`Unknown workflow template “${key}”.`);
  return t;
}

export const templateInput = z.object({
  key: z.string().optional(),
  name: z.string().min(1).max(120),
  department: z.string().min(1).max(40),
  description: z.string().max(1000).default(""),
  briefSchema: z.enum(Object.keys(BRIEF_SCHEMAS) as [BriefSchemaKey, ...BriefSchemaKey[]]),
  steps: z
    .array(
      z.object({
        key: z.string(),
        name: z.string().min(1).max(120),
        agent: z.string().nullable(),
        handler: z.string(),
        dependsOn: z.array(z.string()),
        config: z.record(z.string(), z.unknown()).default({}),
        condition: z.object({ step: z.string(), path: z.string(), op: z.enum(["eq", "neq", "gt", "lt", "truthy", "falsy"]), value: z.unknown().optional() }).nullable().optional(),
        requiresApproval: z.boolean().default(false),
        maxAttempts: z.number().int().min(1).max(10).default(3),
        budgetEstimateCents: z.number().min(0).default(0),
      }),
    )
    .min(1),
});

/** Save a custom template from the workflow builder (new key, or a new version of an existing custom key). */
export async function saveTemplate(viewer: Viewer, raw: unknown) {
  assertCan(viewer, "workflow:edit");
  const input = templateInput.parse(raw);
  validateSteps(input.steps);
  const db = await getDb();
  const key = input.key && !BUILT_IN_TEMPLATES.some((b) => b.key === input.key) ? input.key : `custom_${slugify(input.name).replace(/-/g, "_")}_${Date.now().toString(36)}`;
  const [existing] = await db.select().from(schema.workflowTemplates).where(and(eq(schema.workflowTemplates.orgId, viewer.orgId), eq(schema.workflowTemplates.key, key)));
  if (existing) {
    await db.update(schema.workflowTemplates).set({ name: input.name, department: input.department, description: input.description, briefSchema: input.briefSchema, steps: input.steps, version: existing.version + 1, updatedAt: new Date() }).where(eq(schema.workflowTemplates.id, existing.id));
  } else {
    await db.insert(schema.workflowTemplates).values({ id: newId("wft"), orgId: viewer.orgId, key, name: input.name, department: input.department, description: input.description, briefSchema: input.briefSchema, steps: input.steps });
  }
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "workflow.saved", targetType: "workflow_template", targetId: key });
  return key;
}

export async function deleteTemplate(viewer: Viewer, key: string) {
  assertCan(viewer, "workflow:edit");
  const db = await getDb();
  await db.delete(schema.workflowTemplates).where(and(eq(schema.workflowTemplates.orgId, viewer.orgId), eq(schema.workflowTemplates.key, key)));
}

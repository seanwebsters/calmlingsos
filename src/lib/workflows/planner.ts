/**
 * Studio Director: turns a natural-language instruction into an editable,
 * multi-department execution plan BEFORE anything costly runs. No plan is
 * ever fabricated: without a text provider the director says so and offers
 * manual template selection.
 */
import "server-only";
import { z } from "zod";
import { runAgent } from "@/lib/agents/run";
import { buildContextPack } from "@/lib/brain/context";
import { listCharacters } from "@/lib/brain/characters";
import { assertCan, type Viewer } from "@/lib/auth/session";
import { BRIEF_SCHEMAS } from "./schemas";
import { listTemplates } from "./registry";
import { estimateFor } from "./engine";
import { S } from "./schemas";

export interface PlannedProduction {
  templateKey: string;
  templateName: string;
  title: string;
  characterIds: string[];
  unknownCharacters: string[];
  brief: Record<string, unknown>;
  briefErrors: string[];
  rationale: string;
  estimatedCents: number;
  steps: { key: string; name: string; agent: string | null; requiresApproval: boolean; estimateCents: number }[];
}

export interface StudioPlan {
  command: string;
  summary: string;
  productions: PlannedProduction[];
  questions: string[];
  canonGaps: string[];
  costCents: number;
  runId: string;
}

export async function planFromCommand(viewer: Viewer, command: string): Promise<StudioPlan> {
  assertCan(viewer, "production:create");
  const templates = await listTemplates(viewer.orgId);
  const chars = await listCharacters(viewer.orgId);
  const pack = await buildContextPack(viewer.orgId, { characterIds: chars.filter((c) => c.approvedVersionId).map((c) => c.id), query: command });
  const catalogue = templates
    .map((t) => {
      const shape = z.toJSONSchema(BRIEF_SCHEMAS[t.briefSchema]) as { properties?: Record<string, { type?: string; enum?: string[] }> };
      return `- ${t.key} (${t.department}): ${t.description}\n  brief fields: ${Object.entries(shape.properties ?? {}).map(([k, v]) => `${k}${v.enum ? `∈{${v.enum.join("|")}}` : `:${v.type ?? "any"}`}`).join(", ")}`;
    })
    .join("\n");
  const res = await runAgent({
    orgId: viewer.orgId,
    agentKey: "studio_director",
    task: "Plan from command",
    prompt: `The creative director says:\n"${command}"\n\nAvailable workflow templates:\n${catalogue}\n\nCharacters in the workspace: ${chars.map((c) => `${c.name} (${c.code}${c.approvedVersionId ? "" : ", NO approved canon"})`).join("; ") || "none yet"}\n\nMap the instruction onto one or more productions using ONLY these templates. Fill brief fields from the instruction (reasonable defaults otherwise). Use character codes. If the instruction spans departments, create one production per department. Ask questions for real ambiguities and list canon gaps (e.g. characters without approved references).`,
    schema: S.plan,
    pack,
  });
  const productions: PlannedProduction[] = res.data.productions.map((raw) => {
    let parsedBrief: Record<string, unknown> = {};
    try {
      const v = JSON.parse(raw.briefJson);
      if (v && typeof v === "object" && !Array.isArray(v)) parsedBrief = v;
    } catch {
      parsedBrief = {};
    }
    const p = { ...raw, brief: parsedBrief };
    const tpl = templates.find((t) => t.key === p.templateKey) ?? templates[0];
    const ids: string[] = [];
    const unknown: string[] = [];
    for (const n of p.characters) {
      const c = chars.find((x) => x.code.toLowerCase() === n.toLowerCase() || x.name.toLowerCase() === n.toLowerCase());
      if (c) ids.push(c.id);
      else unknown.push(n);
    }
    const parsed = BRIEF_SCHEMAS[tpl.briefSchema].safeParse(p.brief);
    const brief = (parsed.success ? parsed.data : BRIEF_SCHEMAS[tpl.briefSchema].safeParse({ ...p.brief, request: String(p.brief.request ?? command), theme: String(p.brief.theme ?? command) }).data ?? p.brief) as Record<string, unknown>;
    const steps = tpl.steps.map((s) => ({ key: s.key, name: s.name, agent: s.agent, requiresApproval: Boolean(s.requiresApproval) || s.handler === "human_review" || s.handler === "human_select", estimateCents: estimateFor(s, brief) }));
    return {
      templateKey: tpl.key,
      templateName: tpl.name,
      title: p.title,
      characterIds: [...new Set(ids)],
      unknownCharacters: unknown,
      brief,
      briefErrors: parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      rationale: p.rationale,
      estimatedCents: steps.reduce((n, s) => n + s.estimateCents, 0),
      steps,
    };
  });
  return { command, summary: res.data.summary, productions, questions: res.data.questions, canonGaps: [...res.data.canonGaps, ...pack.warnings], costCents: res.costCents, runId: res.runId };
}

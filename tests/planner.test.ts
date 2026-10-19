import { beforeAll, describe, expect, it } from "vitest";
import { approvedCharacter, clearFakes, freshDb, installFakes, makeOrg, setupEnv } from "./helpers";

setupEnv();

describe("Studio Director planning", () => {
  let ctx: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    await freshDb();
    ctx = await makeOrg();
  });

  it("turns a command into an editable plan without inventing characters", async () => {
    const blue = await approvedCharacter(ctx.viewer, "Blue", "#3366ff");
    await installFakes();
    const { planFromCommand } = await import("@/lib/workflows/planner");
    const plan = await planFromCommand(ctx.viewer, "Create five new Calmlings TikToks using Blue and a plush range");
    expect(plan.productions).toHaveLength(2);
    const social = plan.productions[0];
    expect(social.templateKey).toBe("social_video");
    expect(social.characterIds).toEqual([blue.id]);
    expect(social.unknownCharacters).toEqual(["Ghosty"]);
    expect(social.brief.conceptCount).toBe(5);
    expect(social.steps.some((s) => s.requiresApproval)).toBe(true);
    expect(social.estimatedCents).toBeGreaterThan(0);
    // An unparseable brief falls back to schema defaults rather than failing.
    expect(plan.productions[1].brief.request).toBeTruthy();
    // Nothing was created yet.
    const { getDb, schema } = await import("@/db");
    expect(await (await getDb()).select().from(schema.productions)).toHaveLength(0);
    await clearFakes();
  });

  it("refuses to plan without a text provider (no fabricated plan)", async () => {
    await clearFakes();
    const { planFromCommand } = await import("@/lib/workflows/planner");
    await expect(planFromCommand(ctx.viewer, "Make game-ready character expression sheets")).rejects.toThrow(/No connected provider/);
  });
});

describe("Structured output schemas", () => {
  it("every handoff schema converts to a strict-mode compatible JSON schema", async () => {
    const { S } = await import("@/lib/workflows/schemas");
    const { toProviderSchema } = await import("@/lib/agents/jsonschema");
    const bad: string[] = [];
    const walk = (n: Record<string, unknown>, path: string) => {
      if (n.type === "object" && n.additionalProperties !== false) bad.push(`${path}: object without additionalProperties:false`);
      for (const k of ["minLength", "maxLength", "minimum", "maximum", "pattern", "format"]) if (k in n) bad.push(`${path}: ${k}`);
      if (n.properties) for (const [k, v] of Object.entries(n.properties as Record<string, Record<string, unknown>>)) walk(v, `${path}.${k}`);
      if (n.items) walk(n.items as Record<string, unknown>, `${path}[]`);
      for (const k of ["anyOf", "allOf"]) if (Array.isArray(n[k])) (n[k] as Record<string, unknown>[]).forEach((x, i) => walk(x, `${path}|${i}`));
    };
    for (const [k, schema] of Object.entries(S)) walk(toProviderSchema(schema), k);
    expect(bad).toEqual([]);
  });
});

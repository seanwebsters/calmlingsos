import { beforeAll, describe, expect, it } from "vitest";
import { approvedCharacter, clearFakes, freshDb, installFakes, makeOrg, setupEnv } from "./helpers";

setupEnv();

describe("Autonomous agent team", () => {
  let ctx: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    await freshDb();
    ctx = await makeOrg();
    await approvedCharacter(ctx.viewer, "Blue", "#3366ff");
  });

  it("director delegates in parallel, waits for reports, asks a human, then finishes", async () => {
    const log = await installFakes();
    const { startMission, getMission } = await import("@/lib/agents/team");
    const { drainJobs } = await import("@/lib/jobs/worker");
    const id = await startMission(ctx.viewer, { goal: "Five rainy-day TikToks with Blue", budgetCents: 500 });
    await drainJobs();
    let m = await getMission(ctx.orgId, id);
    const root = m.tasks.find((t) => !t.parentTaskId)!;
    const kids = m.tasks.filter((t) => t.parentTaskId === root.id);
    expect(kids.map((k) => k.agentKey).sort()).toEqual(["comedy_writer", "short_form_scriptwriter"]);
    expect(kids.every((k) => k.status === "done" && k.outputs.length === 1)).toBe(true);
    // Director resumed with the reports, then asked the creative director.
    expect(root.status).toBe("waiting_approval");
    expect(m.mission.status).toBe("awaiting_approval");
    expect(JSON.stringify(root.messages)).toContain("Done – document saved.");
    // Canon reached the director through its search_canon tool call.
    expect(JSON.stringify(root.messages)).toContain("CHR-BLUE");
    expect(log.agentTurns.length).toBeGreaterThan(4);
    // Specialists can't delegate.
    expect(log.agentTurns.filter((t) => !t.lead).every((t) => !t.tools.includes("delegate"))).toBe(true);

    const { listApprovals, closeApprovals } = await import("@/lib/review/approvals");
    const a = (await listApprovals(ctx.orgId)).find((x) => x.kind === "mission")!;
    expect(a.targetId).toBe(root.id);
    await closeApprovals(ctx.orgId, a.targetType, a.targetId, "approved", ctx.userId);
    const { resumeAfterDecision } = await import("@/lib/agents/team");
    await resumeAfterDecision(ctx.orgId, root.id, true, "Yes, concept 1");
    await drainJobs();
    m = await getMission(ctx.orgId, id);
    expect(m.mission.status).toBe("completed");
    expect(m.mission.report).toContain("Mission complete");
    expect(m.mission.spentCents).toBeGreaterThan(0);
    const { listGeneratedAssets } = await import("@/lib/review/assets");
    expect((await listGeneratedAssets(ctx.orgId, { kind: "document" })).filter((d) => d.provenance.parameters.missionId === id)).toHaveLength(2);
    // The office shows the team.
    const { officeState } = await import("@/lib/agents/office");
    const office = await officeState(ctx.orgId);
    expect(office.agents).toHaveLength(45);
    await clearFakes();
  });

  it("blocks honestly without a tool-capable provider", async () => {
    await clearFakes();
    const { startMission, getMission } = await import("@/lib/agents/team");
    const { drainJobs } = await import("@/lib/jobs/worker");
    const id = await startMission(ctx.viewer, { goal: "Anything" });
    await drainJobs();
    const m = await getMission(ctx.orgId, id);
    expect(m.mission.status).toBe("blocked");
    expect(m.tasks[0].error).toMatch(/No connected provider/);
  });

  it("stops at the mission budget", async () => {
    await installFakes();
    const { startMission, getMission } = await import("@/lib/agents/team");
    const { drainJobs } = await import("@/lib/jobs/worker");
    const id = await startMission(ctx.viewer, { goal: "Tiny budget", budgetCents: 10 });
    const { getDb, schema } = await import("@/db");
    const db = await getDb();
    await db.insert(schema.costRecords).values({ id: "cost_x", orgId: ctx.orgId, missionId: id, provider: "anthropic", capability: "tool_use", costCents: 9.9 });
    await drainJobs();
    const m = await getMission(ctx.orgId, id);
    expect(m.mission.status).toBe("blocked");
    expect(m.tasks[0].error).toMatch(/budget/);
    await clearFakes();
  });
});

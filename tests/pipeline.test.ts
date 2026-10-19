import { beforeAll, describe, expect, it } from "vitest";
import { approvedCharacter, freshDb, installFakes, makeOrg, setupEnv } from "./helpers";

setupEnv();

describe("Social video pipeline (acceptance B, C, F)", () => {
  let ctx: Awaited<ReturnType<typeof makeOrg>>;
  let blue: { id: string; referenceId: string };
  beforeAll(async () => {
    await freshDb();
    ctx = await makeOrg();
    blue = await approvedCharacter(ctx.viewer, "Blue", "#3366ff");
  });

  it("runs brief → concepts → selection → script → storyboard → frames → video → assembly → export", async () => {
    const log = await installFakes();
    const { createProduction, startProduction, loadProduction, submitSelection, approveStep } = await import("@/lib/workflows/engine");
    const { drainJobs } = await import("@/lib/jobs/worker");
    const id = await createProduction(ctx.viewer, { templateKey: "social_video", title: "Blue breathes", brief: { theme: "Taking a pause", conceptCount: 4, produceCount: 1, durationSeconds: 6, includeVoice: false }, characterIds: [blue.id], budgetCents: 5000 });
    let p = await loadProduction(ctx.orgId, id);
    expect(p.production.status).toBe("planning");
    await startProduction(ctx.viewer, id);
    await drainJobs();
    p = await loadProduction(ctx.orgId, id);
    const select = p.steps.find((s) => s.key === "select")!;
    expect(select.status).toBe("awaiting_input");
    const concepts = p.steps.find((s) => s.key === "concepts")!.output as { concepts: { id: string }[] };
    expect(concepts.concepts).toHaveLength(4);
    // Canon was injected into the concept agent's context.
    expect(log.text.some((t) => t.context?.includes("CHR-BLUE") && t.context.includes("Blue is gentle"))).toBe(true);

    await submitSelection(ctx.viewer, select.id, ["c2"]);
    await drainJobs();
    p = await loadProduction(ctx.orgId, id);
    const boards = p.steps.find((s) => s.key === "storyboards")!;
    expect(boards.status).toBe("awaiting_approval");

    // Browser refresh = reload from the database: everything is persisted.
    const { getDb, schema } = await import("@/db");
    const db = await getDb();
    const shots = await db.select().from(schema.shots);
    expect(shots).toHaveLength(2);

    await approveStep(ctx.viewer, boards.id);
    await drainJobs();
    p = await loadProduction(ctx.orgId, id);
    expect(p.steps.find((s) => s.key === "frames")!.status).toBe("completed");
    // Frames used Blue's approved master reference.
    expect(log.images.length).toBe(2);
    expect(log.images.every((i) => i.refs.some((r) => r.includes("OFFICIAL MASTER") && r.includes("Blue")))).toBe(true);
    const framesReview = p.steps.find((s) => s.key === "frames_review")!;
    expect(framesReview.status).toBe("awaiting_approval");
    await approveStep(ctx.viewer, framesReview.id);
    await drainJobs();
    p = await loadProduction(ctx.orgId, id);
    expect(p.steps.find((s) => s.key === "video")!.status).toBe("completed");
    expect(p.steps.find((s) => s.key === "voice")!.status).toBe("skipped");
    expect(log.videos).toBe(2);
    const assemble = p.steps.find((s) => s.key === "assemble")!;
    expect(assemble.status, assemble.error ?? "").toBe("completed");
    expect(p.steps.find((s) => s.key === "qa")!.status).toBe("completed");
    const final = p.steps.find((s) => s.key === "final_review")!;
    await approveStep(ctx.viewer, final.id);
    await drainJobs();
    p = await loadProduction(ctx.orgId, id);
    const exp = p.steps.find((s) => s.key === "export")!;
    expect(exp.status, exp.error ?? "").toBe("completed");
    expect(p.production.status).toBe("completed");
    expect(p.production.spentCents).toBeGreaterThan(0);
  }, 120_000);

  it("stops mid-run and resumes without duplicating completed work (F)", async () => {
    const log = await installFakes({ failImagesTimes: 0 });
    const { createProduction, startProduction, loadProduction, submitSelection, approveStep, cancelProduction, resumeProduction } = await import("@/lib/workflows/engine");
    const { drainJobs } = await import("@/lib/jobs/worker");
    const id = await createProduction(ctx.viewer, { templateKey: "social_video", title: "Stop and go", brief: { theme: "Rest", conceptCount: 3, produceCount: 1, durationSeconds: 6, includeVideo: false }, characterIds: [blue.id], budgetCents: 5000 });
    await startProduction(ctx.viewer, id);
    await drainJobs();
    let p = await loadProduction(ctx.orgId, id);
    await submitSelection(ctx.viewer, p.steps.find((s) => s.key === "select")!.id, ["c1"]);
    await drainJobs();
    p = await loadProduction(ctx.orgId, id);
    await approveStep(ctx.viewer, p.steps.find((s) => s.key === "storyboards")!.id);
    // Run only the brand check, then stop before frames run.
    await drainJobs({ maxJobs: 1 });
    await cancelProduction(ctx.viewer, id);
    await drainJobs();
    p = await loadProduction(ctx.orgId, id);
    expect(p.production.status).toBe("cancelled");
    const textCallsBefore = log.text.length;
    const conceptsOutput = JSON.stringify(p.steps.find((s) => s.key === "concepts")!.output);
    await resumeProduction(ctx.viewer, id);
    await drainJobs();
    p = await loadProduction(ctx.orgId, id);
    // Concepts, scripts, storyboards were not regenerated.
    expect(JSON.stringify(p.steps.find((s) => s.key === "concepts")!.output)).toBe(conceptsOutput);
    expect(p.steps.find((s) => s.key === "storyboards")!.status).toBe("completed");
    expect(p.steps.find((s) => s.key === "frames")!.status).toBe("completed");
    expect(log.images.length).toBe(2);
    expect(log.text.length - textCallsBefore).toBeLessThanOrEqual(2);
  }, 120_000);
});

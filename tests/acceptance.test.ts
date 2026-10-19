import { beforeAll, describe, expect, it } from "vitest";
import { approvedCharacter, clearFakes, freshDb, installFakes, makeOrg, pngOf, setupEnv } from "./helpers";

setupEnv();

describe("Acceptance tests A, C, D, E", () => {
  let ctx: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    await freshDb();
    ctx = await makeOrg();
  });

  it("A: upload an official reference, create a profile, approve it, retrieve it from another workspace", async () => {
    const { createCharacter, saveProfile, approveVersion, getCharacter } = await import("@/lib/brain/characters");
    const { emptyProfile } = await import("@/lib/brain/profile");
    const { uploadReferences, classifyReference, getReference } = await import("@/lib/brain/references");
    const { buildContextPack } = await import("@/lib/brain/context");
    const id = await createCharacter(ctx.viewer, { name: "Dadirri" });
    const up = await uploadReferences(ctx.viewer, [{ name: "dadirri-front.png", data: await pngOf("#c2884a") }], { characterIds: [id], viewAngle: "front", rightsStatus: "owned" });
    expect(up.rejected).toEqual([]);
    const refId = up.created[0].id;
    expect((await getReference(ctx.orgId, refId)).asset.designation).toBe("unclassified");
    // Not approved yet → not retrievable.
    let pack = await buildContextPack(ctx.orgId, { characterIds: [id] });
    expect(pack.references).toHaveLength(0);
    expect(pack.missingCanon.map((m) => m.id)).toContain(id);
    await classifyReference(ctx.viewer, refId, "official_master");
    const { versionId } = await saveProfile(ctx.viewer, id, { ...emptyProfile("Dadirri"), personality: "Deep listener" }, "v1");
    await approveVersion(ctx.viewer, versionId);
    expect((await getCharacter(ctx.orgId, id)).character.canonStatus).toBe("official");
    // Another department's production retrieves the same approved canon.
    pack = await buildContextPack(ctx.orgId, { characterIds: [id], department: "game" });
    expect(pack.references.map((r) => r.assetId)).toEqual([refId]);
    expect(pack.characters[0].text).toContain("Deep listener");
    const tech = (await getReference(ctx.orgId, refId)).asset.technical;
    expect(tech.width).toBe(256);
    expect(tech.dominantColours?.[0]).toBe("#c2884a");
  });

  it("E: a second character's references never contaminate the first character's context", async () => {
    const blue = await approvedCharacter(ctx.viewer, "Blue", "#3366ff");
    const rosa = await approvedCharacter(ctx.viewer, "Rosa", "#ff3366");
    const { uploadReferences } = await import("@/lib/brain/references");
    // A group shot of both characters.
    await uploadReferences(ctx.viewer, [{ name: "group.png", data: await pngOf("#999999") }], { characterIds: [blue.id, rosa.id], designation: "approved_supporting" });
    const { buildContextPack } = await import("@/lib/brain/context");
    const bluePack = await buildContextPack(ctx.orgId, { characterIds: [blue.id] });
    expect(bluePack.references.every((r) => r.characterIds.every((c) => c === blue.id))).toBe(true);
    expect(bluePack.references.map((r) => r.assetId)).toContain(blue.referenceId);
    expect(bluePack.references.map((r) => r.assetId)).not.toContain(rosa.referenceId);
    expect(bluePack.characters.map((c) => c.name)).toEqual(["Blue"]);
    // With both cast, the group shot is allowed.
    const both = await buildContextPack(ctx.orgId, { characterIds: [blue.id, rosa.id] });
    expect(both.references).toHaveLength(3);
    // And generation for Blue only sends Blue's references.
    const log = await installFakes();
    const { createProduction, startProduction, loadProduction } = await import("@/lib/workflows/engine");
    const { drainJobs } = await import("@/lib/jobs/worker");
    const pid = await createProduction(ctx.viewer, { templateKey: "game_asset", title: "Blue emotes", brief: { request: "Blue emote", count: 1, transparency: false, width: 128, height: 128 }, characterIds: [blue.id] });
    await startProduction(ctx.viewer, pid);
    await drainJobs();
    const p = await loadProduction(ctx.orgId, pid);
    const ctxText = log.text.map((t) => t.context ?? "").join("\n");
    expect(ctxText).toContain("CHR-BLUE");
    expect(ctxText).not.toContain("CHR-ROSA");
    expect(p.steps.find((s) => s.key === "render")!.status).toBe("completed");
    await clearFakes();
  });

  it("C: generate, request changes, regenerate, compare, approve, export", async () => {
    await installFakes();
    const { createProduction, startProduction, loadProduction } = await import("@/lib/workflows/engine");
    const { drainJobs } = await import("@/lib/jobs/worker");
    const { listGeneratedAssets, reviewAsset, requestRegeneration, getAssetDetail, exportAsset } = await import("@/lib/review/assets");
    const ch = await approvedCharacter(ctx.viewer, "Moss", "#33aa66");
    const pid = await createProduction(ctx.viewer, { templateKey: "game_asset", title: "Moss collectible", brief: { request: "Moss figurine", count: 1, transparency: true, width: 128, height: 128 }, characterIds: [ch.id] });
    await startProduction(ctx.viewer, pid);
    await drainJobs();
    const p = await loadProduction(ctx.orgId, pid);
    const render = p.steps.find((s) => s.key === "render")!;
    const [v1] = await listGeneratedAssets(ctx.orgId, { productionId: pid, role: "game_asset_source" });
    expect(v1.provenance.provider).toBe("google");
    expect(v1.stepId).toBe(render.id);
    await reviewAsset(ctx.viewer, v1.id, "request_changes", "Softer shell");
    await requestRegeneration(ctx.viewer, v1.id, "Softer shell");
    await drainJobs();
    const detail = await getAssetDetail(ctx.orgId, v1.id);
    expect(detail.versions).toHaveLength(2);
    const v2 = detail.versions[1];
    expect(v2.parentId).toBe(v1.id);
    expect(v2.provenance.prompt).toContain("Softer shell");
    // Same reference versions → fair comparison; provenance resolves to the real reference.
    expect(v2.provenance.referenceAssetVersionIds).toEqual(v1.provenance.referenceAssetVersionIds);
    expect(detail.references.length).toBeGreaterThan(0);
    await expect(exportAsset(ctx.viewer, v2.id)).rejects.toThrow(/Approve/);
    await reviewAsset(ctx.viewer, v2.id, "approve", "Lovely");
    const zip = await exportAsset(ctx.viewer, v2.id);
    expect(zip.data.subarray(0, 2).toString()).toBe("PK");
    const after = await getAssetDetail(ctx.orgId, v2.id);
    expect(after.asset.status).toBe("published");
    await clearFakes();
  });

  it("D: with providers disconnected, steps block with an integration requirement and nothing fake is produced", async () => {
    await clearFakes();
    const ch = await approvedCharacter(ctx.viewer, "Pebble", "#777777");
    const { createProduction, startProduction, loadProduction } = await import("@/lib/workflows/engine");
    const { drainJobs } = await import("@/lib/jobs/worker");
    const { listGeneratedAssets } = await import("@/lib/review/assets");
    const pid = await createProduction(ctx.viewer, { templateKey: "social_video", title: "No providers", brief: { theme: "Rest" }, characterIds: [ch.id] });
    await startProduction(ctx.viewer, pid);
    await drainJobs();
    const p = await loadProduction(ctx.orgId, pid);
    const research = p.steps.find((s) => s.key === "research")!;
    expect(research.status).toBe("blocked");
    expect(research.blockedOn).toBe("capability:structured");
    expect(research.error).toMatch(/No connected provider/);
    expect(research.output).toBeNull();
    expect(p.production.status).toBe("blocked");
    expect(await listGeneratedAssets(ctx.orgId, { productionId: pid })).toHaveLength(0);
    // Provider status reports real disconnection.
    const { providerStatuses } = await import("@/lib/providers/gateway");
    const statuses = await providerStatuses(ctx.orgId);
    expect(statuses.every((s) => !s.connected && s.status === "disconnected")).toBe(true);
    // Reconnecting and retrying continues from the blocked step.
    await installFakes();
    const { retryStep } = await import("@/lib/workflows/engine");
    await retryStep(ctx.viewer, research.id);
    await drainJobs();
    const p2 = await loadProduction(ctx.orgId, pid);
    expect(p2.steps.find((s) => s.key === "select")!.status).toBe("awaiting_input");
    await clearFakes();
  });

  it("D: an explicit provider override that isn't available fails loudly instead of substituting", async () => {
    await installFakes();
    const { resolveRoute } = await import("@/lib/providers/gateway");
    await expect(resolveRoute(ctx.orgId, "image_generation", { override: "openai" })).rejects.toThrow(/OpenAI/);
    const r = await resolveRoute(ctx.orgId, "image_generation", {});
    expect(r.provider).toBe("google");
    await clearFakes();
  });
});

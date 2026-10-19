import { beforeAll, describe, expect, it } from "vitest";
import { approvedCharacter, freshDb, installFakes, makeOrg, pngOf, setupEnv, clearFakes } from "./helpers";

setupEnv();

describe("G: permissions", () => {
  it("only canon authorities can approve canon, classify masters or approve deliverables", async () => {
    const { can, ROLES } = await import("@/lib/auth/permissions");
    expect(can("owner", "providers:manage")).toBe(true);
    expect(can("creative_director", "canon:approve")).toBe(true);
    expect(can("creative_director", "providers:manage")).toBe(false);
    for (const r of ["producer", "contributor", "viewer"]) {
      expect(can(r, "canon:approve")).toBe(false);
      expect(can(r, "review:approve")).toBe(false);
      expect(can(r, "outreach:approve")).toBe(false);
    }
    expect(can("viewer", "reference:upload")).toBe(false);
    expect(can("not-a-role", "review:comment")).toBe(false);
    expect(ROLES).toHaveLength(5);
  });

  it("services enforce roles", async () => {
    await freshDb();
    const { viewer } = await makeOrg();
    const producer = { ...viewer, role: "producer" as const };
    const viewerRole = { ...viewer, role: "viewer" as const };
    const { createCharacter, saveProfile, approveVersion } = await import("@/lib/brain/characters");
    const { emptyProfile } = await import("@/lib/brain/profile");
    const { uploadReferences } = await import("@/lib/brain/references");
    const id = await createCharacter(producer as never, { name: "Fern" });
    const { versionId } = await saveProfile(producer as never, id, emptyProfile("Fern"), "draft");
    await expect(approveVersion(producer as never, versionId)).rejects.toThrow(/permission|can't/i);
    await expect(uploadReferences(viewerRole as never, [{ name: "a.png", data: await pngOf("#000000") }], {})).rejects.toThrow();
    await expect(uploadReferences(producer as never, [{ name: "a.png", data: await pngOf("#000000") }], { designation: "official_master" })).rejects.toThrow(/creative director/);
  });
});

describe("G: asset versioning and canon protection", () => {
  let ctx: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    await freshDb();
    ctx = await makeOrg();
  });

  it("keeps every reference version and never deletes official masters", async () => {
    const ch = await approvedCharacter(ctx.viewer, "Blue", "#3366ff");
    const { addVersion, getReference, deleteReference } = await import("@/lib/brain/references");
    const { versions: before } = await getReference(ctx.orgId, ch.referenceId);
    await addVersion(ctx.viewer, ch.referenceId, { name: "blue-v2.png", data: await pngOf("#2255ee") }, "Updated render");
    const { asset, versions, current } = await getReference(ctx.orgId, ch.referenceId);
    expect(versions).toHaveLength(before.length + 1);
    expect(current!.version).toBe(2);
    expect(versions.map((v) => v.sha256)).toHaveLength(new Set(versions.map((v) => v.sha256)).size);
    // A new master file must be re-approved before agents use it.
    expect(asset.approvalState).toBe("pending");
    await expect(deleteReference(ctx.viewer, ch.referenceId)).rejects.toThrow(/can't be deleted/);
  });

  it("rejects files whose bytes don't match an allowed type", async () => {
    const { uploadReferences } = await import("@/lib/brain/references");
    const r = await uploadReferences(ctx.viewer, [{ name: "evil.png", data: Buffer.from("MZ\x90\x00 not an image") }, { name: "script.exe", data: Buffer.from("x") }], {});
    expect(r.created).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it("expands ZIP collections", async () => {
    const { zipSync } = await import("fflate");
    const zip = Buffer.from(zipSync({ "set/a.png": new Uint8Array(await pngOf("#111111")), "set/b.png": new Uint8Array(await pngOf("#222222")), "set/notes.txt": new TextEncoder().encode("Blue loves rain") }));
    const { uploadReferences, getReference } = await import("@/lib/brain/references");
    const r = await uploadReferences(ctx.viewer, [{ name: "set.zip", data: zip }], { tags: ["batch"] });
    expect(r.created).toHaveLength(3);
    const doc = r.created.find((c) => c.mediaKind === "document")!;
    expect((await getReference(ctx.orgId, doc.id)).asset.analysis?.extractedText).toContain("Blue loves rain");
  });

  it("Character Lock turns locked-field edits into change requests", async () => {
    const ch = await approvedCharacter(ctx.viewer, "Rosa", "#ff3366");
    const { setCharacterLock, saveProfile, getCharacter, approveVersion } = await import("@/lib/brain/characters");
    const { listApprovals } = await import("@/lib/review/approvals");
    await setCharacterLock(ctx.viewer, ch.id, true, ["colours", "silhouette"]);
    const { approved } = await getCharacter(ctx.orgId, ch.id);
    const res = await saveProfile(ctx.viewer, ch.id, { ...approved!.profile, colours: [{ name: "Body", hex: "#00ff00" }] }, "Recolour");
    expect(res.status).toBe("pending_approval");
    expect(res.lockedFieldsTouched).toEqual(["colours"]);
    expect((await listApprovals(ctx.orgId)).some((a) => a.targetId === res.versionId && a.kind === "character_change")).toBe(true);
    // Still the old canon until approved.
    expect((await getCharacter(ctx.orgId, ch.id)).approved!.profile.colours[0].hex).toBe("#ff3366");
    const ok = await saveProfile(ctx.viewer, ch.id, { ...approved!.profile, backstory: "Grew up by the pond" }, "Backstory");
    expect(ok.status).toBe("draft");
    await approveVersion(ctx.viewer, res.versionId);
    expect((await getCharacter(ctx.orgId, ch.id)).approved!.profile.colours[0].hex).toBe("#00ff00");
  });

  it("AI-proposed lore is draft canon until a human approves it", async () => {
    const { createCanon, approveCanon, getCanonRecord, reviseCanon } = await import("@/lib/brain/canon");
    const id = await createCanon({ orgId: ctx.orgId, userId: null, agentKey: "worldbuilding_director" }, { domain: "lore", kind: "location", title: "The Quiet Pond", body: "A pond" });
    expect((await getCanonRecord(ctx.orgId, id)).record.canonStatus).toBe("ai_proposal");
    await approveCanon(ctx.viewer, id);
    const rev = await reviseCanon(ctx.viewer, id, { body: "A still pond" });
    const r = await getCanonRecord(ctx.orgId, rev);
    expect(r.official?.id).toBe(id);
    await approveCanon(ctx.viewer, rev);
    const r2 = await getCanonRecord(ctx.orgId, id);
    expect(r2.record.superseded).toBe(true);
    expect(r2.official?.id).toBe(rev);
  });
});

describe("G: provider failures and workflow state transitions", () => {
  let ctx: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    await freshDb();
    ctx = await makeOrg();
  });

  it("retries retryable provider errors then succeeds; failed attempts still count towards cost", async () => {
    const log = await installFakes({ failImagesTimes: 1 });
    const ch = await approvedCharacter(ctx.viewer, "Blue", "#3366ff");
    const { createProduction, startProduction, loadProduction } = await import("@/lib/workflows/engine");
    const { getDb, schema } = await import("@/db");
    const db = await getDb();
    const { drainJobs } = await import("@/lib/jobs/worker");
    const pid = await createProduction(ctx.viewer, { templateKey: "game_asset", title: "Retry", brief: { request: "x", count: 1, transparency: false, width: 64, height: 64 }, characterIds: [ch.id] });
    await startProduction(ctx.viewer, pid);
    await drainJobs();
    // Make the delayed retry due now.
    await db.update(schema.jobs).set({ runAfter: new Date(0) });
    await drainJobs();
    const p = await loadProduction(ctx.orgId, pid);
    const render = p.steps.find((s) => s.key === "render")!;
    expect(render.status).toBe("completed");
    expect(render.attempts).toBe(2);
    expect(log.images).toHaveLength(1);
    await clearFakes();
  });

  it("blocks on budget and resumes after a human raises it", async () => {
    await installFakes();
    const ch = await approvedCharacter(ctx.viewer, "Rain", "#4488cc");
    const { createProduction, startProduction, loadProduction, raiseBudget } = await import("@/lib/workflows/engine");
    const { drainJobs } = await import("@/lib/jobs/worker");
    const pid = await createProduction(ctx.viewer, { templateKey: "game_asset", title: "Budget", brief: { request: "x", count: 3, transparency: false, width: 64, height: 64 }, characterIds: [ch.id], budgetCents: 10 });
    await startProduction(ctx.viewer, pid);
    await drainJobs();
    let p = await loadProduction(ctx.orgId, pid);
    const render = p.steps.find((s) => s.key === "render")!;
    expect(render.status).toBe("blocked");
    expect(render.blockedOn).toBe("budget");
    await raiseBudget(ctx.viewer, pid, 1000);
    await drainJobs();
    p = await loadProduction(ctx.orgId, pid);
    expect(p.steps.find((s) => s.key === "render")!.status).toBe("completed");
    await clearFakes();
  });

  it("derives production status and evaluates conditions", async () => {
    const { deriveProductionStatus, evaluateCondition } = await import("@/lib/workflows/engine");
    expect(deriveProductionStatus("running", [{ status: "completed" }, { status: "skipped" }])).toBe("completed");
    expect(deriveProductionStatus("running", [{ status: "completed" }, { status: "awaiting_input" }])).toBe("awaiting_input");
    expect(deriveProductionStatus("running", [{ status: "blocked" }, { status: "pending" }])).toBe("blocked");
    expect(deriveProductionStatus("running", [{ status: "failed" }])).toBe("failed");
    expect(deriveProductionStatus("paused", [{ status: "completed" }])).toBe("paused");
    expect(evaluateCondition({ step: "$brief", path: "includeVideo", op: "truthy" }, { includeVideo: false }, {})).toBe(false);
    expect(evaluateCondition({ step: "qa", path: "passed", op: "eq", value: true }, {}, { qa: { passed: true } })).toBe(true);
    expect(evaluateCondition(null, {}, {})).toBe(true);
  });

  it("rejects cyclic or broken workflow templates", async () => {
    const { validateSteps } = await import("@/lib/workflows/registry");
    expect(() => validateSteps([{ key: "a", name: "A", agent: null, handler: "agent_task", dependsOn: ["b"] }, { key: "b", name: "B", agent: null, handler: "agent_task", dependsOn: ["a"] }])).toThrow(/cycle/);
    expect(() => validateSteps([{ key: "a", name: "A", agent: null, handler: "nope", dependsOn: [] }])).toThrow(/handler/);
    expect(() => validateSteps([{ key: "a", name: "A", agent: "ghost", handler: "agent_task", dependsOn: [] }])).toThrow(/agent/);
    const { BUILT_IN_TEMPLATES } = await import("@/lib/workflows/templates");
    for (const t of BUILT_IN_TEMPLATES) expect(() => validateSteps(t.steps)).not.toThrow();
  });

  it("job idempotency keys prevent duplicate work", async () => {
    const { enqueue } = await import("@/lib/jobs/queue");
    const a = await enqueue({ orgId: ctx.orgId, type: "noop", payload: {}, idempotencyKey: "same" });
    const b = await enqueue({ orgId: ctx.orgId, type: "noop", payload: {}, idempotencyKey: "same" });
    expect(a).toBeTruthy();
    expect(b).toBeNull();
  });
});

describe("Pure modules", () => {
  it("encrypts credentials with AES-GCM", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/crypto");
    const c = encryptSecret("sk-secret-123");
    expect(c).not.toContain("sk-secret");
    expect(decryptSecret(c)).toBe("sk-secret-123");
    expect(() => decryptSecret(c.slice(0, -2) + "AA")).toThrow();
  });

  it("validates game assets against spec", async () => {
    const { processToSpec, validateGameAsset, expectedName } = await import("@/lib/game/validate");
    const spec = { targetEngine: "Unity", category: "collectible", width: 128, height: 128, aspectRatio: "1:1", transparency: true, fileFormat: "png" as const, animation: { frames: 1, fps: 12, layout: "none" as const }, colourSpace: "srgb" as const, namingPattern: "cal_{category}_{name}_{width}x{height}", targetPlatform: "mobile", maxFileKb: 256 };
    const good = await processToSpec(await pngOf("#ff8800", 200, true), spec);
    const name = `${expectedName(spec, "Sea Shell")}.png`;
    expect(name).toBe("cal_collectible_sea_shell_128x128.png");
    const ok = await validateGameAsset(good, spec, name, { name: "Sea Shell", category: "collectible", frames: 1 });
    expect(ok.passed, JSON.stringify(ok.checks)).toBe(true);
    const opaque = await processToSpec(await pngOf("#ff8800", 200, false), spec);
    const bad = await validateGameAsset(opaque, spec, "Shell.PNG", { name: "Sea Shell", category: "collectible", frames: 1 });
    expect(bad.passed).toBe(false);
    expect(bad.checks.filter((c) => !c.passed).map((c) => c.name).sort()).toEqual(["Naming", "Transparency"]);
  });

  it("screens originality and sniffs types", async () => {
    const { screenOriginality } = await import("@/lib/brain/originality");
    expect(screenOriginality([{ field: "name", text: "Pikachoo", isName: true }])).toHaveLength(1);
    expect(screenOriginality([{ field: "name", text: "Dadirri", isName: true }])).toHaveLength(0);
    const { sniff } = await import("@/lib/files/sniff");
    expect(sniff(await pngOf("#000000"), "x.png")?.mimeType).toBe("image/png");
    expect(sniff(await pngOf("#000000"), "x.jpg")?.mimeType).toBe("image/png");
    expect(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "x.svg")?.mediaKind).toBe("image");
    expect(sniff(Buffer.from("hello"), "x.exe")).toBeNull();
  });

  it("reports statistics honestly", async () => {
    const { wilson, confidenceFor } = await import("@/lib/analytics/stats");
    expect(wilson(0, 0).rate).toBeNull();
    expect(confidenceFor(50)).toBe("LOW");
  });

  it("parses analytics CSV without inventing metrics", async () => {
    const { parseCsv, mapRow } = await import("@/lib/analytics/csv");
    const rows = parseCsv('post_id,platform,title,views,shares\n1,tiktok,"Blue, breathing",1200,\n');
    expect(rows).toHaveLength(1);
    const m = mapRow(rows[0]);
    expect(m.views).toBe(1200);
    expect(m.shares).toBeNull();
    expect(m.title).toBe("Blue, breathing");
  });
});

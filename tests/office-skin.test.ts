import { beforeAll, describe, expect, it } from "vitest";
import { clearFakes, freshDb, installFakes, makeOrg, pngOf, setupEnv } from "./helpers";

setupEnv();

describe("Office reskin with Nano Banana", () => {
  let ctx: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => {
    await freshDb();
    ctx = await makeOrg();
  });

  it("blocks with the missing integration when no Nano Banana provider is connected", async () => {
    await clearFakes();
    const { reskinOffice } = await import("@/lib/office-skin");
    await expect(reskinOffice(ctx.viewer, { prompt: "Light oak and eucalyptus", parts: ["floor"] })).rejects.toThrow(/GEMINI_API_KEY|FAL_KEY/);
  });

  it("generates textures, stores them per organisation and never asks for characters", async () => {
    const log = await installFakes();
    const { reskinOffice, getOfficeSkin } = await import("@/lib/office-skin");
    const res = await reskinOffice(ctx.viewer, { prompt: "Light oak floors, eucalyptus forest outside", parts: ["floor", "wall", "rug"], theme: "dusk" });
    expect(res.failed).toEqual([]);
    expect(res.costCents).toBe(12);
    expect(log.images).toHaveLength(3);
    expect(log.images.every((i) => /no characters/.test(i.prompt) && i.prompt.includes("eucalyptus"))).toBe(true);
    const { getOrgSettings } = await import("@/lib/org");
    const stored = (await getOrgSettings(ctx.orgId)).officeSkin!;
    expect(stored.theme).toBe("dusk");
    expect(stored.model).toMatch(/flash-image|nano-banana/);
    for (const k of [stored.floorKey, stored.wallKey, stored.rugKey]) expect(k?.startsWith(`orgs/${ctx.orgId}/office/`)).toBe(true);
    const { getStorage } = await import("@/lib/storage");
    expect((await getStorage().get(stored.floorKey!))?.length).toBeGreaterThan(0);
    const view = await getOfficeSkin(ctx.orgId);
    expect(view.floorUrl && view.wallUrl && view.rugUrl).toBeTruthy();
    // Other settings survive a reskin.
    expect((await getOrgSettings(ctx.orgId)).defaultProductionBudgetCents).toBe(2500);
  });

  it("passes a style image as a reference, switches themes and resets textures", async () => {
    const log = await installFakes();
    const { reskinOffice, setOfficeTheme, resetOfficeSkin } = await import("@/lib/office-skin");
    await reskinOffice(ctx.viewer, { prompt: "Like this mood board", parts: ["wall"], reference: { mimeType: "image/png", data: await pngOf("#ffcc88") } });
    expect(log.images[0].refs).toEqual(["style reference"]);
    expect((await setOfficeTheme(ctx.viewer, "midnight")).theme).toBe("midnight");
    await expect(setOfficeTheme(ctx.viewer, "nope")).rejects.toThrow(/Unknown/);
    const reset = await resetOfficeSkin(ctx.viewer);
    expect(reset).toMatchObject({ theme: "midnight", floorUrl: null, wallUrl: null, rugUrl: null });
    await clearFakes();
  });

  it("requires the agents:edit permission", async () => {
    const { reskinOffice } = await import("@/lib/office-skin");
    await expect(reskinOffice({ ...ctx.viewer, role: "producer" as never }, { prompt: "anything at all", parts: ["floor"] })).rejects.toThrow();
  });
});

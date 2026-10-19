import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import sharp from "sharp";

const shots = process.env.E2E_SCREENSHOTS;
const snap = async (page: import("@playwright/test").Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false });
};

test("setup → character → official reference → approved canon → production plan → honest integration block", async ({ page }) => {
  const email = `cd-${Date.now()}@studio.test`;
  await page.goto("/");
  await expect(page).toHaveURL(/setup/);
  await page.fill('input[name="orgName"]', "Calmlings Studio");
  await page.fill('input[name="name"]', "Creative Director");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "correct-horse-battery");
  await page.click("text=Create studio");
  await expect(page).toHaveURL(/settings/);
  await expect(page.getByText("AI providers")).toBeVisible();
  await expect(page.getByText("not connected").first()).toBeVisible();
  await snap(page, "01-settings");

  await page.goto("/mission");
  await expect(page.getByText("What should we create today?").first()).toBeVisible();
  await snap(page, "02-mission-empty");

  // The command bar is honest when no text provider is connected.
  await page.fill("textarea", "Create five new Calmlings TikToks using Blue.");
  await page.keyboard.press("Enter");
  await expect(page.getByText("needs a connected text model")).toBeVisible();
  await snap(page, "03-command-needs-provider");

  // Character
  await page.goto("/characters");
  await page.click("text=New character");
  await page.fill('input[name="name"]', "Test Character");
  await page.click("button:text('Create')");
  await expect(page).toHaveURL(/characters\/chr_/);
  const charUrl = page.url().split("?")[0];
  const charId = charUrl.split("/").pop()!;

  // Upload a reference (a neutral test image – not a Calmlings design).
  const img = path.join(os.tmpdir(), "e2e-front.png");
  fs.writeFileSync(img, await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 120, g: 160, b: 255, alpha: 1 } } }).png().toBuffer());
  await page.goto(`/references?character=${charId}&upload=1`);
  await page.setInputFiles('input[type="file"]', img);
  await page.selectOption("select >> nth=1", "front");
  await page.selectOption("select >> nth=2", "official_master");
  await page.click("button:has-text('Upload 1')");
  await expect(page.getByText("Uploaded 1 file(s)")).toBeVisible();
  await expect(page.locator("a[href^='/references/ref_']").first()).toBeVisible();
  await snap(page, "04-references");
  await page.locator("a[href^='/references/ref_']").first().click();
  await expect(page.getByText("Technical metadata")).toBeVisible();
  await expect(page.getByText("512×512")).toBeVisible();
  await snap(page, "05-reference-detail");

  // Profile → new version → approve as canon
  await page.goto(`${charUrl}?tab=personality`);
  await page.locator("textarea").nth(1).fill("Gentle, curious and patient.");
  await page.fill('input[placeholder^="Change note"]', "First canon");
  await page.click("text=Save as new version");
  await expect(page.getByText(/Saved v2 as a draft/)).toBeVisible();
  await page.goto(`${charUrl}?tab=version%20history`);
  page.once("dialog", (d) => d.accept());
  await page.locator("button:has-text('Approve as canon')").first().click();
  await expect(page.getByText("Official canon").first()).toBeVisible();
  await page.goto(`${charUrl}?tab=master%20references`);
  await snap(page, "06-character-masters");

  // Social production → plan → start → blocked honestly
  await page.goto("/social");
  await page.locator("textarea").first().fill("Taking a mindful pause");
  await page.getByRole("button", { name: "Test Character" }).first().click();
  await page.click("text=Create plan");
  await expect(page).toHaveURL(/productions\/prd_/);
  await expect(page.getByText("Execution plan – edit before anything costly runs")).toBeVisible();
  await snap(page, "07-plan");
  await page.click("text=Approve plan & start");
  await expect(page.getByText(/No connected provider can do/).first()).toBeVisible({ timeout: 30_000 });
  await snap(page, "08-blocked-honestly");
  // No generated deliverables exist.
  await page.goto(page.url().split("?")[0] + "?tab=deliverables");
  await expect(page.getByText("No deliverables yet")).toBeVisible();

  for (const p of ["/agents", "/agents?tab=workflows", "/approvals", "/calendar", "/analytics", "/game", "/product", "/story", "/canon", "/animation", "/music", "/marketing", "/licensing"]) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await page.goto("/agents?tab=workflows");
  await snap(page, "09-workflow-builder");
  await page.goto("/mission");
  await snap(page, "10-mission");
});

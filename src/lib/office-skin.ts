import "server-only";
import { getOrgSettings, updateOrgSettings } from "./org";
import { audit } from "./audit";
import { newId } from "./ids";
import { AppError, IntegrationRequiredError } from "./errors";
import { assertCan, type Viewer } from "./auth/session";
import { generateImage, resolveRoute } from "./providers/gateway";
import type { BinaryInput } from "./providers/types";
import { getStorage, orgKey, urlFor } from "./storage";
import type { OfficeSkin } from "@/db/schema";
import { DEFAULT_OFFICE_THEME, OFFICE_THEMES, SKIN_PARTS, type OfficeSkinView, type SkinPart } from "@/components/office/themes";

/** Providers whose image model is Nano Banana, in preference order. */
const NANO_BANANA = ["google", "fal"] as const;
const isNanoBanana = (model: string) => /nano-banana|flash-image/i.test(model);

const EMPTY: OfficeSkin = { theme: DEFAULT_OFFICE_THEME, prompt: null, floorKey: null, wallKey: null, rugKey: null, provider: null, model: null, generatedAt: null };

/* The office is decor, not canon: prompts rule out characters so nothing resembling a Calmling is invented. */
const PART_PROMPTS: Record<SkinPart, { aspectRatio: "1:1" | "16:9"; prompt: (style: string) => string }> = {
  floor: {
    aspectRatio: "1:1",
    prompt: (s) => `Seamless, tileable, top-down texture of an office floor surface. Style: ${s}. Perfectly flat, orthographic, evenly lit, no perspective, no shadows, no furniture, no objects, no text, no logos, no people, no characters or creatures.`,
  },
  wall: {
    aspectRatio: "16:9",
    prompt: (s) => `Wide panoramic view as seen through the floor-to-ceiling windows of a modern creative studio. Scene: ${s}. Soft natural light, photographic depth, no window frames, no interior, no text, no logos, no people, no characters or creatures.`,
  },
  rug: {
    aspectRatio: "1:1",
    prompt: (s) => `Seamless, tileable, top-down texture of a soft woven area rug for a modern office. Style: ${s}. Light, mostly neutral tones that can be colour-tinted, flat and evenly lit, no perspective, no objects, no text, no logos, no people, no characters or creatures.`,
  },
};

export async function getOfficeSkin(orgId: string): Promise<OfficeSkinView> {
  const skin = { ...EMPTY, ...(await getOrgSettings(orgId)).officeSkin };
  const sign = (k: string | null) => urlFor(k, { ttlSeconds: 12 * 3600 });
  return {
    theme: OFFICE_THEMES[skin.theme] ? skin.theme : DEFAULT_OFFICE_THEME,
    prompt: skin.prompt,
    floorUrl: await sign(skin.floorKey),
    wallUrl: await sign(skin.wallKey),
    rugUrl: await sign(skin.rugKey),
    model: skin.model,
    generatedAt: skin.generatedAt,
  };
}

async function save(viewer: Viewer, skin: OfficeSkin) {
  await updateOrgSettings(viewer.orgId, viewer.userId, { officeSkin: skin });
}

export async function setOfficeTheme(viewer: Viewer, theme: string) {
  assertCan(viewer, "agents:edit");
  if (!OFFICE_THEMES[theme]) throw new AppError("Unknown office theme.");
  const current = { ...EMPTY, ...(await getOrgSettings(viewer.orgId)).officeSkin };
  await save(viewer, { ...current, theme });
  return getOfficeSkin(viewer.orgId);
}

export async function resetOfficeSkin(viewer: Viewer) {
  assertCan(viewer, "agents:edit");
  const current = { ...EMPTY, ...(await getOrgSettings(viewer.orgId)).officeSkin };
  await save(viewer, { ...EMPTY, theme: current.theme });
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "office.skin_reset", targetType: "organisation", targetId: viewer.orgId });
  return getOfficeSkin(viewer.orgId);
}

/** Picks the first connected provider whose model for this capability is Nano Banana. */
async function nanoBananaRoute(orgId: string, withReference: boolean) {
  const capability = withReference ? "image_edit" : "image_generation";
  const reasons: string[] = [];
  for (const provider of NANO_BANANA) {
    try {
      const r = await resolveRoute(orgId, capability, { override: provider, sendsProprietaryFiles: withReference, wantsReferences: withReference });
      if (isNanoBanana(r.model)) return r;
      reasons.push(`${provider} is set to ${r.model}, not Nano Banana`);
    } catch (e) {
      reasons.push((e as Error).message.replace(/\.$/, ""));
    }
  }
  throw new IntegrationRequiredError(`capability:${capability}`, `Reskinning uses Nano Banana through Google Gemini (GEMINI_API_KEY) or fal.ai (FAL_KEY). ${reasons.join("; ")}.`, "/settings");
}

export async function reskinOffice(viewer: Viewer, input: { prompt: string; parts: SkinPart[]; theme?: string; reference?: BinaryInput | null }) {
  assertCan(viewer, "agents:edit");
  const style = input.prompt.trim().slice(0, 600);
  if (style.length < 3) throw new AppError("Describe the look you want.");
  const parts = SKIN_PARTS.filter((p) => input.parts.includes(p));
  if (!parts.length) throw new AppError("Pick at least one part of the office to reskin.");
  const route = await nanoBananaRoute(viewer.orgId, Boolean(input.reference));
  const references = input.reference ? [{ ...input.reference, label: "style reference" }] : undefined;

  const results = await Promise.allSettled(
    parts.map(async (part) => {
      const spec = PART_PROMPTS[part];
      const prompt = spec.prompt(style) + (references ? " Match the colours, materials and mood of the attached style reference image." : "");
      const out = await generateImage({ orgId: viewer.orgId }, { prompt, references, aspectRatio: spec.aspectRatio }, { override: route.provider });
      const ext = out.mimeType.includes("jpeg") ? "jpg" : out.mimeType.includes("webp") ? "webp" : "png";
      const key = orgKey(viewer.orgId, "office", `${part}-${newId("skin")}.${ext}`);
      await getStorage().put(key, out.data, out.mimeType);
      return { part, key, model: out.model, costCents: out.costCents };
    }),
  );
  const done = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = results.flatMap((r, i) => (r.status === "rejected" ? [`${parts[i]}: ${(r.reason as Error)?.message ?? r.reason}`] : []));
  if (!done.length) throw new AppError(`Nano Banana didn't return any textures. ${failed.join("; ")}`);

  const current = { ...EMPTY, ...(await getOrgSettings(viewer.orgId)).officeSkin };
  const next: OfficeSkin = { ...current, prompt: style, provider: route.provider, model: done[0].model, generatedAt: new Date().toISOString() };
  if (input.theme && OFFICE_THEMES[input.theme]) next.theme = input.theme;
  for (const d of done) next[`${d.part}Key`] = d.key;
  await save(viewer, next);
  const costCents = done.reduce((n, d) => n + d.costCents, 0);
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "office.reskinned", targetType: "organisation", targetId: viewer.orgId, data: { prompt: style, parts: done.map((d) => d.part), provider: route.provider, costCents } });
  return { skin: await getOfficeSkin(viewer.orgId), costCents, failed };
}

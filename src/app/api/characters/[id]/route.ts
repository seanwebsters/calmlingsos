import { z } from "zod";
import { body, route } from "@/lib/http";
import { getCharacter, setHeroAsset, updateCharacterMeta } from "@/lib/brain/characters";

export const GET = route<{ id: string }>(null, async ({ viewer, params }) => getCharacter(viewer.orgId, params.id));
export const PATCH = route<{ id: string }>("canon:edit", async ({ req, viewer, params }) => {
  const b = await body(req, z.object({ summary: z.string().max(1000).optional(), canonStatus: z.enum(["draft", "experimental", "archived"]).optional(), heroAssetId: z.string().nullable().optional() }));
  if (b.heroAssetId !== undefined) await setHeroAsset(viewer, params.id, b.heroAssetId);
  if (b.summary !== undefined || b.canonStatus) await updateCharacterMeta(viewer, params.id, { summary: b.summary, canonStatus: b.canonStatus });
});

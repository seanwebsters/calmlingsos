import { z } from "zod";
import { body, route } from "@/lib/http";
import { createCharacter, listCharacters } from "@/lib/brain/characters";

export const GET = route(null, async ({ viewer }) => ({ characters: await listCharacters(viewer.orgId) }));
export const POST = route("canon:edit", async ({ req, viewer }) => {
  const b = await body(req, z.object({ name: z.string().min(1).max(120), summary: z.string().max(1000).optional(), canonStatus: z.enum(["draft", "experimental"]).optional() }));
  return { id: await createCharacter(viewer, b) };
});

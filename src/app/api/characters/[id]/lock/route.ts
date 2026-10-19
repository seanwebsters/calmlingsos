import { z } from "zod";
import { body, route } from "@/lib/http";
import { setCharacterLock } from "@/lib/brain/characters";

export const POST = route<{ id: string }>("character:lock", async ({ req, viewer, params }) => {
  const b = await body(req, z.object({ locked: z.boolean(), fields: z.array(z.string()).default([]) }));
  await setCharacterLock(viewer, params.id, b.locked, b.fields);
});

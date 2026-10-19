import { z } from "zod";
import { body, route } from "@/lib/http";
import { saveProfile } from "@/lib/brain/characters";

export const POST = route<{ id: string }>("canon:edit", async ({ req, viewer, params }) => {
  const b = await body(req, z.object({ profile: z.unknown(), changeNote: z.string().max(500).default("") }));
  return saveProfile(viewer, params.id, b.profile, b.changeNote);
});

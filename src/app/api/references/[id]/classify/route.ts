import { z } from "zod";
import { body, route } from "@/lib/http";
import { classifyReference } from "@/lib/brain/references";

export const POST = route<{ id: string }>("reference:classify", async ({ req, viewer, params }) => {
  const b = await body(req, z.object({ designation: z.enum(["official_master", "approved_supporting", "style_inspiration", "experimental", "rejected", "archived", "unclassified"]), note: z.string().max(500).default("") }));
  await classifyReference(viewer, params.id, b.designation, b.note);
});

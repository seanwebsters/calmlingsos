import { z } from "zod";
import { body, route } from "@/lib/http";
import { approveVersion, rejectVersion } from "@/lib/brain/characters";
import { AppError } from "@/lib/errors";

export const POST = route<{ id: string; action: string }>("canon:approve", async ({ req, viewer, params }) => {
  const b = await body(req, z.object({ note: z.string().max(1000).default("") }));
  if (params.action === "approve") return approveVersion(viewer, params.id, b.note);
  if (params.action === "reject") return rejectVersion(viewer, params.id, b.note);
  throw new AppError("Unknown action");
});

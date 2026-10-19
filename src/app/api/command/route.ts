import { z } from "zod";
import { body, route } from "@/lib/http";
import { planFromCommand } from "@/lib/workflows/planner";

export const POST = route("production:create", async ({ req, viewer }) => {
  const { command } = await body(req, z.object({ command: z.string().min(3).max(4000) }));
  return planFromCommand(viewer, command);
});

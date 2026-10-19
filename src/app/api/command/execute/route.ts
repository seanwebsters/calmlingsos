import { z } from "zod";
import { body, route } from "@/lib/http";
import { createProduction } from "@/lib/workflows/engine";

export const POST = route("production:create", async ({ req, viewer }) => {
  const b = await body(req, z.object({ command: z.string().max(4000), productions: z.array(z.object({ templateKey: z.string(), title: z.string(), brief: z.record(z.string(), z.unknown()), characterIds: z.array(z.string()) })).min(1).max(12) }));
  const ids: string[] = [];
  for (const p of b.productions) ids.push(await createProduction(viewer, { ...p, command: b.command }));
  return { ids };
});

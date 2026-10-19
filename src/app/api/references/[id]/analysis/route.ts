import { z } from "zod";
import { body, route } from "@/lib/http";
import { getReference, queueAnalysis, reviewAnalysis } from "@/lib/brain/references";

export const POST = route<{ id: string }>("reference:classify", async ({ req, viewer, params }) => {
  const b = await body(req, z.object({ reanalyze: z.boolean().optional(), description: z.string().max(8000).optional(), composition: z.string().max(4000).optional(), styleObservations: z.array(z.string()).optional(), consistencyRules: z.array(z.string()).optional(), transcript: z.string().optional() }));
  if (b.reanalyze) {
    const { asset } = await getReference(viewer.orgId, params.id);
    await queueAnalysis(viewer.orgId, params.id, asset.currentVersionId!, Date.now());
    return;
  }
  const { reanalyze: _r, ...edits } = b;
  await reviewAnalysis(viewer, params.id, edits);
});

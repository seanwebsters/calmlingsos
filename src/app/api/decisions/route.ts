import { z } from "zod";
import { route } from "@/lib/http";
import { createDecision, listDecisions, setDecisionActive } from "@/lib/brain/decisions";

export const GET = route(null, async ({ req, viewer }) => ({ decisions: await listDecisions(viewer.orgId, new URL(req.url).searchParams.get("q") ?? undefined) }));
export const POST = route("review:comment", async ({ req, viewer }) => ({ id: await createDecision(viewer, await req.json()) }));
export const PATCH = route("canon:approve", async ({ req, viewer }) => {
  const b = z.object({ id: z.string(), active: z.boolean() }).parse(await req.json());
  await setDecisionActive(viewer, b.id, b.active);
});

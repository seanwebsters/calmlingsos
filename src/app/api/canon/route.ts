import { route } from "@/lib/http";
import { createCanon, listCanon } from "@/lib/brain/canon";

export const GET = route(null, async ({ req, viewer }) => ({ records: await listCanon(viewer.orgId, { domain: new URL(req.url).searchParams.get("domain") ?? undefined }) }));
export const POST = route("canon:edit", async ({ req, viewer }) => ({ id: await createCanon(viewer, await req.json()) }));

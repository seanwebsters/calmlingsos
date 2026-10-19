import { route } from "@/lib/http";
import { deleteTemplate, listTemplates, saveTemplate } from "@/lib/workflows/registry";

export const GET = route(null, async ({ viewer }) => ({ templates: await listTemplates(viewer.orgId) }));
export const POST = route("workflow:edit", async ({ req, viewer }) => ({ key: await saveTemplate(viewer, await req.json()) }));
export const DELETE = route("workflow:edit", async ({ req, viewer }) => deleteTemplate(viewer, new URL(req.url).searchParams.get("key") ?? ""));

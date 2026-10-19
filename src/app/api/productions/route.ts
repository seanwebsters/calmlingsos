import { route } from "@/lib/http";
import { createProduction } from "@/lib/workflows/engine";

export const POST = route("production:create", async ({ req, viewer }) => ({ id: await createProduction(viewer, await req.json()) }));

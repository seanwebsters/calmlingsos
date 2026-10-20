import { route } from "@/lib/http";
import { startMission } from "@/lib/agents/team";

export const POST = route("production:create", async ({ req, viewer }) => ({ id: await startMission(viewer, await req.json()) }));

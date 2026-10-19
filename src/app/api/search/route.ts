import { route } from "@/lib/http";
import { searchAll } from "@/lib/brain/search";

export const GET = route(null, async ({ req, viewer }) => searchAll(viewer.orgId, new URL(req.url).searchParams.get("q") ?? ""));

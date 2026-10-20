import { route } from "@/lib/http";
import { officeState } from "@/lib/agents/office";

export const dynamic = "force-dynamic";
export const GET = route(null, async ({ viewer }) => officeState(viewer.orgId));

import { route } from "@/lib/http";
import { providerStatuses } from "@/lib/providers/gateway";

export const GET = route(null, async ({ viewer }) => ({ providers: (await providerStatuses(viewer.orgId)).map(({ definition: _d, ...p }) => p) }));

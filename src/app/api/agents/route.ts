import { z } from "zod";
import { body, route } from "@/lib/http";
import { saveAgentConfig } from "@/lib/agents/run";
import { audit } from "@/lib/audit";

export const PATCH = route("agents:edit", async ({ req, viewer }) => {
  const b = await body(req, z.object({ key: z.string(), instructions: z.string().min(20).max(20000).optional(), enabled: z.boolean().optional(), budgetCentsPerRun: z.number().int().min(0).max(100000).optional(), qualityPreference: z.enum(["best", "balanced", "fast", "cheap"]).optional() }));
  const { key, ...patch } = b;
  await saveAgentConfig(viewer.orgId, key, patch);
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "agent.updated", targetType: "agent", targetId: key, data: { ...patch, instructions: patch.instructions ? "(changed)" : undefined } });
});

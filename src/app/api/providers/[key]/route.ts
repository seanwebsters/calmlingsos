import { z } from "zod";
import { body, route } from "@/lib/http";
import { deleteCredential, saveCredential, testProvider, updateProviderSettings } from "@/lib/providers/gateway";

export const POST = route<{ key: string }>("providers:manage", async ({ req, viewer, params }) => {
  const b = await body(req, z.object({ apiKey: z.string().min(8).max(500).optional(), enabled: z.boolean().optional(), allowProprietaryReferences: z.boolean().optional(), models: z.record(z.string(), z.string()).optional(), test: z.boolean().optional() }));
  if (b.apiKey) await saveCredential(viewer.orgId, viewer.userId, params.key, b.apiKey);
  if (b.enabled !== undefined || b.allowProprietaryReferences !== undefined || b.models) await updateProviderSettings(viewer.orgId, viewer.userId, params.key, { enabled: b.enabled, allowProprietaryReferences: b.allowProprietaryReferences, models: b.models });
  if (b.test || b.apiKey) return testProvider(viewer.orgId, params.key);
  return { ok: true };
});
export const DELETE = route<{ key: string }>("providers:manage", async ({ viewer, params }) => deleteCredential(viewer.orgId, viewer.userId, params.key));

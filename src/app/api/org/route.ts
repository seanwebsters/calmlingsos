import { route } from "@/lib/http";
import { addMember, updateOrgSettings } from "@/lib/org";
import { AppError } from "@/lib/errors";
import { assertCan } from "@/lib/auth/session";
import { exportOrgData, purgeExpired } from "@/lib/org-data";

export const PATCH = route("org:manage", async ({ req, viewer }) => updateOrgSettings(viewer.orgId, viewer.userId, await req.json()));
export const POST = route(null, async ({ req, viewer }) => {
  const b = (await req.json()) as Record<string, unknown>;
  if (b.action === "add_member") {
    assertCan(viewer, "members:manage");
    return { userId: await addMember(viewer.orgId, viewer.userId, b) };
  }
  if (b.action === "purge") {
    assertCan(viewer, "data:delete");
    return purgeExpired(viewer);
  }
  throw new AppError("Unknown action");
});
export const GET = route("org:manage", async ({ viewer }) => {
  const data = await exportOrgData(viewer);
  return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="calmlings-os-export-${new Date().toISOString().slice(0, 10)}.json"` } });
});

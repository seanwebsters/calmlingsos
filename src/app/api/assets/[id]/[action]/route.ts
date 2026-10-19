import { z } from "zod";
import { route } from "@/lib/http";
import { exportAsset, getAsset, getAssetDetail, promoteToReference, requestRegeneration, reviewAsset } from "@/lib/review/assets";
import { getStorage } from "@/lib/storage";
import { AppError, notFound } from "@/lib/errors";
import { assertCan } from "@/lib/auth/session";

export const GET = route<{ id: string; action: string }>(null, async ({ viewer, params }) => {
  if (params.action === "detail") return getAssetDetail(viewer.orgId, params.id);
  if (params.action === "export") {
    const z = await exportAsset(viewer, params.id);
    return new Response(new Uint8Array(z.data), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${z.filename}"` } });
  }
  if (params.action === "download") {
    assertCan(viewer, "export:create");
    const a = await getAsset(viewer.orgId, params.id);
    if (a.textContent && !a.storageKey) return new Response(a.textContent, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${a.id}.md"` } });
    const data = a.storageKey ? await getStorage().get(a.storageKey) : null;
    if (!data) throw notFound();
    return new Response(new Uint8Array(data), { headers: { "content-type": a.mimeType ?? "application/octet-stream", "content-disposition": `attachment; filename="${a.id}.${a.storageKey!.split(".").pop()}"` } });
  }
  throw new AppError("Unknown action");
});

export const POST = route<{ id: string; action: string }>("review:comment", async ({ req, viewer, params }) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const comment = String(b.comment ?? b.notes ?? "");
  switch (params.action) {
    case "approve":
    case "reject":
    case "request_changes":
    case "comment":
    case "lock":
    case "unlock":
      return reviewAsset(viewer, params.id, params.action, comment, b.annotation ? z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), atSeconds: z.number().optional() }).parse(b.annotation) : null);
    case "regenerate":
      return { jobId: await requestRegeneration(viewer, params.id, comment) };
    case "promote":
      return { referenceId: await promoteToReference(viewer, params.id) };
  }
  throw new AppError("Unknown action");
});

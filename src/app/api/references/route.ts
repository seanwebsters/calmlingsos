import { route } from "@/lib/http";
import { listReferences, uploadReferences } from "@/lib/brain/references";
import { AppError } from "@/lib/errors";

export const GET = route(null, async ({ req, viewer }) => {
  const u = new URL(req.url);
  return { references: await listReferences(viewer.orgId, { q: u.searchParams.get("q") ?? undefined, characterId: u.searchParams.get("character") ?? undefined, designation: u.searchParams.get("designation") ?? undefined, mediaKind: u.searchParams.get("kind") ?? undefined }) };
});

/** Multipart batch upload: field "files" (many) + "meta" (JSON). */
export const POST = route("reference:upload", async ({ req, viewer }) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw new AppError("Expected multipart form data.");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw new AppError("Choose at least one file.");
  if (files.length > 200) throw new AppError("Upload at most 200 files at once (or use a ZIP).");
  const meta = JSON.parse(String(form.get("meta") ?? "{}"));
  const incoming = await Promise.all(files.map(async (f) => ({ name: f.name, data: Buffer.from(await f.arrayBuffer()) })));
  return uploadReferences(viewer, incoming, meta);
});

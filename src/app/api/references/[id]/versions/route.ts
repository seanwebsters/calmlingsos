import { route } from "@/lib/http";
import { addVersion } from "@/lib/brain/references";
import { AppError } from "@/lib/errors";

export const POST = route<{ id: string }>("reference:upload", async ({ req, viewer, params }) => {
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) throw new AppError("Choose a file.");
  return addVersion(viewer, params.id, { name: f.name, data: Buffer.from(await f.arrayBuffer()) }, String(form.get("note") ?? ""));
});

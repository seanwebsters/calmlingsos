import { route } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { reskinOffice, resetOfficeSkin, setOfficeTheme } from "@/lib/office-skin";
import { SKIN_PARTS, type SkinPart } from "@/components/office/themes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

/** JSON {action: "theme" | "reset"} or multipart {prompt, parts, theme?, reference?} to reskin with Nano Banana. */
export const POST = route("agents:edit", async ({ req, viewer }) => {
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as { action?: string; theme?: string };
    if (b.action === "theme") return { skin: await setOfficeTheme(viewer, String(b.theme ?? "")) };
    if (b.action === "reset") return { skin: await resetOfficeSkin(viewer) };
    throw new AppError("Unknown action.");
  }
  const form = await req.formData();
  const file = form.get("reference");
  let reference = null;
  if (file instanceof File && file.size > 0) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new AppError("The style reference must be a PNG, JPEG or WEBP image.");
    if (file.size > MAX_REFERENCE_BYTES) throw new AppError("The style reference must be under 10 MB.");
    reference = { mimeType: file.type, data: Buffer.from(await file.arrayBuffer()) };
  }
  const parts = String(form.get("parts") ?? SKIN_PARTS.join(","))
    .split(",")
    .filter((p): p is SkinPart => (SKIN_PARTS as readonly string[]).includes(p));
  return reskinOffice(viewer, { prompt: String(form.get("prompt") ?? ""), parts, theme: String(form.get("theme") ?? "") || undefined, reference });
});

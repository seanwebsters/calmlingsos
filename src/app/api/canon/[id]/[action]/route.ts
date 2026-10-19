import { route } from "@/lib/http";
import { approveCanon, archiveCanon, rejectCanon, reviseCanon, submitCanonForApproval } from "@/lib/brain/canon";
import { AppError } from "@/lib/errors";

export const POST = route<{ id: string; action: string }>("canon:edit", async ({ req, viewer, params }) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  switch (params.action) {
    case "revise":
      return { id: await reviseCanon(viewer, params.id, b) };
    case "submit":
      return submitCanonForApproval(viewer, params.id);
    case "approve":
      return approveCanon(viewer, params.id, String(b.note ?? ""));
    case "reject":
      return rejectCanon(viewer, params.id, String(b.note ?? ""));
    case "archive":
      return archiveCanon(viewer, params.id);
  }
  throw new AppError("Unknown action");
});

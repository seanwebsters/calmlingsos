import { z } from "zod";
import { route } from "@/lib/http";
import { approveStep, editStepOutput, requestStepChanges, rerunStep, retryStep, skipStep, submitSelection } from "@/lib/workflows/engine";
import { AppError } from "@/lib/errors";

export const POST = route<{ id: string; action: string }>("review:comment", async ({ req, viewer, params }) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const notes = typeof b.notes === "string" ? b.notes : "";
  switch (params.action) {
    case "retry":
      return retryStep(viewer, params.id);
    case "rerun":
      return rerunStep(viewer, params.id, notes || null);
    case "skip":
      return skipStep(viewer, params.id, notes || "Skipped");
    case "select":
      return submitSelection(viewer, params.id, z.array(z.string()).parse(b.selected), z.record(z.string(), z.string()).default({}).parse(b.reasons ?? {}));
    case "approve":
      return approveStep(viewer, params.id, notes);
    case "changes":
      return requestStepChanges(viewer, params.id, notes);
    case "output":
      return editStepOutput(viewer, params.id, z.record(z.string(), z.unknown()).parse(b.output));
  }
  throw new AppError("Unknown action");
});

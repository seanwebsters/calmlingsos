import { z } from "zod";
import { route } from "@/lib/http";
import { cancelProduction, editPlan, pauseProduction, raiseBudget, resumeProduction, startProduction } from "@/lib/workflows/engine";
import { AppError } from "@/lib/errors";

export const POST = route<{ id: string; action: string }>("production:run", async ({ req, viewer, params }) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  switch (params.action) {
    case "start":
      return startProduction(viewer, params.id);
    case "pause":
      return pauseProduction(viewer, params.id);
    case "resume":
      return resumeProduction(viewer, params.id);
    case "cancel":
      return cancelProduction(viewer, params.id);
    case "plan":
      return editPlan(viewer, params.id, b);
    case "budget":
      return raiseBudget(viewer, params.id, z.coerce.number().int().parse(b.budgetCents ?? Math.round(Number(b.notes ?? 0) * 100)));
  }
  throw new AppError("Unknown action");
});

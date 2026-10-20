import { z } from "zod";
import { route } from "@/lib/http";
import { cancelMission, getMission, raiseMissionBudget, resumeMission } from "@/lib/agents/team";
import { AppError } from "@/lib/errors";

export const GET = route<{ id: string; action: string }>(null, async ({ viewer, params }) => getMission(viewer.orgId, params.id));

export const POST = route<{ id: string; action: string }>("production:run", async ({ req, viewer, params }) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (params.action === "cancel") return cancelMission(viewer, params.id);
  if (params.action === "resume") return resumeMission(viewer, params.id);
  if (params.action === "budget") return raiseMissionBudget(viewer, params.id, z.coerce.number().int().min(1).parse(b.budgetCents ?? Math.round(Number(b.notes ?? 0) * 100)));
  throw new AppError("Unknown action");
});

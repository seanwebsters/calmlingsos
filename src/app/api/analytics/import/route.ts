import { route } from "@/lib/http";
import { importAnalyticsCsv } from "@/lib/analytics/service";
import { AppError } from "@/lib/errors";

export const POST = route("analytics:import", async ({ req, viewer }) => {
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) throw new AppError("Choose a CSV file.");
  if (f.size > 20 * 1024 * 1024) throw new AppError("CSV files are limited to 20 MB.");
  return importAnalyticsCsv(viewer, await f.text(), String(form.get("platform") ?? ""));
});

import "server-only";
import type { JobHandler } from "./worker";

export const JOB_HANDLERS: Record<string, JobHandler> = {
  run_step: async (job) => {
    const { runStepJob } = await import("@/lib/workflows/runtime");
    await runStepJob(job.payload as { productionId: string; stepId: string });
  },
  analyze_reference: async (job) => {
    const { analyzeReference } = await import("@/lib/brain/analysis");
    await analyzeReference(job.payload as { assetId: string; versionId: string });
  },
  regenerate_asset: async (job) => {
    const { regenerateAssetJob } = await import("@/lib/workflows/handlers/media");
    await regenerateAssetJob(job.payload as { assetId: string; notes: string; requestedBy: string });
  },
  index_source: async (job) => {
    const { indexSource } = await import("@/lib/brain/embeddings");
    const p = job.payload as { orgId: string; type: string; id: string };
    await indexSource(p.orgId, p.type, p.id);
  },
};

/**
 * Background worker. Runs inside the web process (instrumentation.ts) or as
 * a separate process (`npm run worker`). Job handlers are registered by type.
 */
import "server-only";
import { hostname } from "node:os";
import { AppError, IntegrationRequiredError, ProviderError } from "@/lib/errors";
import { claimNext, completeJob, failJob, recoverStaleJobs, type JobRow } from "./queue";

export type JobHandler = (job: JobRow) => Promise<void>;

/** Thrown by a handler to request a later retry without counting as an error. */
export class RetryLater extends Error {
  constructor(readonly delayMs: number, message = "retry later") {
    super(message);
  }
}

async function handlers(): Promise<Record<string, JobHandler>> {
  const mod = await import("./handlers");
  return mod.JOB_HANDLERS;
}

export async function processJob(job: JobRow): Promise<void> {
  const table = await handlers();
  const handler = table[job.type];
  if (!handler) {
    await failJob(job.id, `No handler for job type ${job.type}`, null);
    return;
  }
  try {
    await handler(job);
    await completeJob(job.id);
  } catch (err) {
    if (err instanceof RetryLater) {
      await failJob(job.id, err.message, err.delayMs);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Handlers persist domain-level failure state themselves; the job only records it.
    const retryable = err instanceof ProviderError ? err.retryable : !(err instanceof AppError || err instanceof IntegrationRequiredError);
    await failJob(job.id, msg, retryable ? Math.min(60_000, 2000 * 2 ** (job.attempts - 1)) : null);
  }
}

/** Process jobs until the queue is empty (tests, scripts). */
export async function drainJobs(opts: { maxJobs?: number; types?: string[] } = {}): Promise<number> {
  const workerId = `drain-${process.pid}`;
  let n = 0;
  while (n < (opts.maxJobs ?? 500)) {
    const job = await claimNext(workerId, opts.types);
    if (!job) break;
    await processJob(job);
    n++;
  }
  return n;
}

const g = globalThis as unknown as { __calmlingsWorker?: { stop: () => void } };

export function startWorker(opts: { concurrency?: number; pollMs?: number } = {}) {
  if (g.__calmlingsWorker) return g.__calmlingsWorker;
  const workerId = `${hostname()}-${process.pid}`;
  let stopped = false;
  const concurrency = opts.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 3);
  const pollMs = opts.pollMs ?? 1000;
  const loop = async (slot: number) => {
    while (!stopped) {
      try {
        const job = await claimNext(`${workerId}#${slot}`);
        if (!job) {
          await new Promise((r) => setTimeout(r, pollMs));
          continue;
        }
        await processJob(job);
      } catch (err) {
        console.error(JSON.stringify({ level: "error", scope: "worker", message: String(err) }));
        await new Promise((r) => setTimeout(r, pollMs * 5));
      }
    }
  };
  void recoverStaleJobs().catch(() => null);
  const recover = setInterval(() => void recoverStaleJobs().catch(() => null), 5 * 60_000);
  for (let i = 0; i < concurrency; i++) void loop(i);
  g.__calmlingsWorker = {
    stop: () => {
      stopped = true;
      clearInterval(recover);
      g.__calmlingsWorker = undefined;
    },
  };
  console.log(JSON.stringify({ level: "info", scope: "worker", message: `Worker ${workerId} started (${concurrency} slots)` }));
  return g.__calmlingsWorker;
}

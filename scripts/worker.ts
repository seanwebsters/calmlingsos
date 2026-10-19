/**
 * Standalone worker process: `npm run worker`. Run one or more alongside the
 * web app (set IN_PROCESS_WORKER=off on the web process to separate them).
 */
import { getDb } from "../src/db";
import { startWorker } from "../src/lib/jobs/worker";

async function main() {
  await getDb();
  const w = startWorker({ concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3) });
  const stop = () => {
    w.stop();
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
void main();

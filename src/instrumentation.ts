export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { getDb } = await import("./db");
  await getDb(); // runs migrations
  const { env } = await import("./lib/env");
  if (env.inProcessWorker) {
    const { startWorker } = await import("./lib/jobs/worker");
    startWorker();
  }
}

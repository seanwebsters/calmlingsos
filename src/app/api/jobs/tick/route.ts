import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { drainJobs } from "@/lib/jobs/worker";
import { pendingJobCount, recoverStaleJobs } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runs queued background work for up to ~45 seconds. On serverless hosts
 * (no long-lived worker) the app calls this while someone has it open; a
 * scheduler can also call it with `Authorization: Bearer $CRON_SECRET`.
 */
async function tick(orgId: string | null) {
  await recoverStaleJobs(env.serverless ? 3 * 60_000 : 15 * 60_000);
  const processed = await drainJobs({ timeBudgetMs: 45_000 });
  return NextResponse.json({ processed, remaining: orgId ? await pendingJobCount(orgId) : null });
}

export async function POST() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return tick(viewer.orgId);
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return tick(null);
}

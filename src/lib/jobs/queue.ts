/**
 * Durable job queue on PostgreSQL. Jobs survive restarts; each unit of work
 * has an idempotency key so it can never be enqueued twice; claiming uses
 * FOR UPDATE SKIP LOCKED so several workers can share the queue.
 */
import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/db";
import { newId } from "@/lib/ids";

export interface EnqueueInput {
  orgId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  runAfter?: Date;
  maxAttempts?: number;
}

/** Returns the job id, or null if a job with the same idempotency key already exists. */
export async function enqueue(input: EnqueueInput, tx?: Tx): Promise<string | null> {
  const db = tx ?? (await getDb());
  const id = newId("job");
  const rows = await db
    .insert(schema.jobs)
    .values({ id, orgId: input.orgId, type: input.type, payload: input.payload, idempotencyKey: input.idempotencyKey, runAfter: input.runAfter ?? new Date(), maxAttempts: input.maxAttempts ?? 3 })
    .onConflictDoNothing({ target: schema.jobs.idempotencyKey })
    .returning({ id: schema.jobs.id });
  return rows[0]?.id ?? null;
}

export type JobRow = typeof schema.jobs.$inferSelect;

export async function claimNext(workerId: string, types?: string[]): Promise<JobRow | null> {
  const db = await getDb();
  const typeFilter = types?.length ? sql`and type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const res = await db.execute(sql`
    update jobs set status = 'running', locked_by = ${workerId}, locked_at = now(), attempts = attempts + 1, updated_at = now()
    where id = (
      select id from jobs where status = 'queued' and run_after <= now() ${typeFilter}
      order by run_after asc limit 1 for update skip locked
    )
    returning id`);
  const rows = (res as unknown as { rows: { id: string }[] }).rows;
  const id = rows[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
  return job ?? null;
}

export async function completeJob(id: string) {
  const db = await getDb();
  await db.update(schema.jobs).set({ status: "succeeded", lockedBy: null, updatedAt: new Date() }).where(eq(schema.jobs.id, id));
}

export async function failJob(id: string, error: string, retryInMs: number | null) {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
  if (!job) return;
  const retry = retryInMs !== null && job.attempts < job.maxAttempts;
  await db
    .update(schema.jobs)
    .set({ status: retry ? "queued" : "failed", lastError: error.slice(0, 2000), lockedBy: null, runAfter: retry ? new Date(Date.now() + retryInMs!) : job.runAfter, updatedAt: new Date() })
    .where(eq(schema.jobs.id, id));
  return retry;
}

export async function cancelJobsFor(key: string, value: string, tx?: Tx) {
  const db = tx ?? (await getDb());
  await db
    .update(schema.jobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(schema.jobs.status, "queued"), sql`${schema.jobs.payload} ->> ${key} = ${value}`));
}

/** Jobs left "running" by a crashed process go back to the queue. */
export async function recoverStaleJobs(olderThanMs = 15 * 60_000) {
  const db = await getDb();
  await db
    .update(schema.jobs)
    .set({ status: "queued", lockedBy: null, updatedAt: new Date() })
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.lockedAt, new Date(Date.now() - olderThanMs))));
}

export async function jobCounts(orgId: string) {
  const db = await getDb();
  const rows = await db
    .select({ status: schema.jobs.status, n: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.orgId, orgId), inArray(schema.jobs.status, ["queued", "running", "failed"])))
    .groupBy(schema.jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

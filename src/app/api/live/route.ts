import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getViewer } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Server-sent events: emits "change" whenever the watched scope changes. */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorised", { status: 401 });
  const scope = new URL(req.url).searchParams.get("scope") ?? "org";
  const db = await getDb();
  const fingerprint = async () => {
    if (scope.startsWith("production:")) {
      const id = scope.slice(11);
      const [r] = await db.execute(sql`select (select max(updated_at) from production_steps where production_id = ${id})::text as s, (select updated_at from productions where id = ${id} and org_id = ${viewer.orgId})::text as p, (select count(*) from generated_assets where production_id = ${id})::text as a, (select max(updated_at) from generated_assets where production_id = ${id})::text as u`).then((x) => (x as unknown as { rows: Record<string, string>[] }).rows);
      return JSON.stringify(r);
    }
    if (scope.startsWith("reference:")) {
      const [r] = await db.select({ u: schema.referenceAssets.updatedAt, s: schema.referenceAssets.analysisStatus }).from(schema.referenceAssets).where(and(eq(schema.referenceAssets.id, scope.slice(10)), eq(schema.referenceAssets.orgId, viewer.orgId)));
      return JSON.stringify(r ?? null);
    }
    const [r] = await db.execute(sql`select (select max(updated_at) from productions where org_id = ${viewer.orgId})::text as p, (select count(*) from approvals where org_id = ${viewer.orgId} and status = 'pending')::text as a, (select max(updated_at) from jobs where org_id = ${viewer.orgId})::text as j, (select max(updated_at) from reference_assets where org_id = ${viewer.orgId})::text as r`).then((x) => (x as unknown as { rows: Record<string, string>[] }).rows);
    return JSON.stringify(r);
  };
  let last = await fingerprint();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`retry: 3000\nevent: hello\ndata: {}\n\n`));
      const timer = setInterval(async () => {
        try {
          const now = await fingerprint();
          if (now !== last) {
            last = now;
            controller.enqueue(enc.encode(`event: change\ndata: {}\n\n`));
          } else controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          clearInterval(timer);
          controller.close();
        }
      }, 1500);
      // Close before serverless time limits; EventSource reconnects automatically.
      const lifetime = setTimeout(() => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      }, 50_000);
      req.signal.addEventListener("abort", () => {
        clearTimeout(lifetime);
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      });
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}

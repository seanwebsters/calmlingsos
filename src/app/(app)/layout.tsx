import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getViewer } from "@/lib/auth/session";
import { needsSetup } from "@/lib/org";
import { Sidebar, MobileNav } from "@/components/shell/sidebar";
import { SearchBox } from "@/components/shell/search";
import { JobPump } from "@/components/client/job-pump";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (env.authMode !== "open" && (await needsSetup())) redirect("/setup");
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const db = await getDb();
  const [a] = await db.select({ n: count() }).from(schema.approvals).where(and(eq(schema.approvals.orgId, viewer.orgId), eq(schema.approvals.status, "pending")));
  return (
    <div className="flex min-h-screen">
      {!env.inProcessWorker && <JobPump />}
      <Sidebar signIn={env.authMode !== "open"} approvals={a?.n ?? 0} orgName={viewer.orgName} userName={viewer.name} role={viewer.role} />
      <div className="min-w-0 flex-1">
        <MobileNav />
        <div className="sticky top-0 z-20 flex items-center justify-end gap-3 border-b border-white/[0.04] bg-ink-950/60 px-6 py-2.5 backdrop-blur lg:px-10">
          <SearchBox />
        </div>
        <main className="mx-auto max-w-[1480px] px-6 py-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}

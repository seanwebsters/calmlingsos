import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { StudioPage } from "@/components/studio/studio-page";
import { Card, SectionTitle, Status } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marketing Studio" };

export default async function Marketing() {
  const viewer = await requireViewer();
  const db = await getDb();
  const campaigns = await db.select().from(schema.campaigns).where(eq(schema.campaigns.orgId, viewer.orgId)).orderBy(desc(schema.campaigns.createdAt));
  return (
    <StudioPage viewer={viewer} eyebrow="10 · Marketing Studio" title="Campaigns & launches" sub="Strategy → concepts → key visuals → review → proposed schedule. Nothing is published or paid for automatically." departments={["marketing"]} templateKeys={["campaign"]}
      aside={
        <Card>
          <SectionTitle title="Campaigns" action={<Link href="/calendar" className="link text-sm">Calendar →</Link>} />
          {campaigns.length ? campaigns.map((c) => (
            <Link key={c.id} href={c.productionId ? `/productions/${c.productionId}` : "/calendar"} className="block border-b border-white/[0.05] py-2 last:border-0">
              <div className="flex items-center justify-between"><span className="text-sm text-white">{c.name}</span><Status value={c.status} /></div>
              <div className="text-xs text-mist-400">{c.objective}</div>
            </Link>
          )) : <p className="text-sm text-mist-400">No campaigns yet.</p>}
        </Card>
      }
    />
  );
}

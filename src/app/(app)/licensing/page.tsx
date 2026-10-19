import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { listGeneratedAssets } from "@/lib/review/assets";
import { StudioPage } from "@/components/studio/studio-page";
import { OutreachRequest } from "@/components/studio/outreach";
import { GenTile } from "@/components/media";
import { Card, Notice, SectionTitle, Status } from "@/components/ui";
import { timeAgo } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Licensing Studio" };

export default async function Licensing() {
  const viewer = await requireViewer();
  const db = await getDb();
  const outreach = await db.select().from(schema.approvals).where(and(eq(schema.approvals.orgId, viewer.orgId), eq(schema.approvals.kind, "outreach"))).orderBy(desc(schema.approvals.createdAt));
  const docs = (await listGeneratedAssets(viewer.orgId, { kind: "document", latestOnly: true, limit: 60 })).filter((d) => d.role === "document");
  return (
    <StudioPage viewer={viewer} eyebrow="11 · Licensing Studio" title="Licensing & brand partnerships" sub="Strategic rationale, creative concept, character fit, mockups, activations and commercial assumptions – presentation-ready, never sent." departments={["licensing"]} templateKeys={["partnership_pitch"]}
      aside={
        <>
          <Notice tone="calm" title="The system never contacts partners">Outreach requires an explicit approval from someone with outreach authority. Approving records permission only – your team makes the contact.</Notice>
          <OutreachRequest />
          <Card>
            <SectionTitle title="Outreach approvals" />
            {outreach.length ? outreach.map((o) => <div key={o.id} className="flex items-center justify-between border-b border-white/[0.05] py-2 text-sm last:border-0"><span className="text-mist-100">{o.title}<span className="block text-xs text-mist-500">{timeAgo(o.createdAt)}</span></span><Status value={o.status} /></div>) : <p className="text-sm text-mist-400">None requested.</p>}
          </Card>
          <Card><SectionTitle title="Pitch documents" />{docs.length ? <div className="grid grid-cols-2 gap-2">{docs.slice(0, 8).map((d) => <GenTile key={d.id} a={d} />)}</div> : <p className="text-sm text-mist-400">None yet.</p>}</Card>
        </>
      }
    />
  );
}

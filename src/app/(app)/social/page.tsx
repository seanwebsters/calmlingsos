import { requireViewer } from "@/lib/auth/session";
import { listGeneratedAssets } from "@/lib/review/assets";
import { StudioPage } from "@/components/studio/studio-page";
import { GenTile } from "@/components/media";
import { Card, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Social Studio" };

export default async function Social() {
  const viewer = await requireViewer();
  const finals = await listGeneratedAssets(viewer.orgId, { role: "final_cut", latestOnly: true, limit: 12 });
  return (
    <StudioPage viewer={viewer} eyebrow="04 · Social Studio" title="Short-form production" sub="Research → concepts → your selection → scripts → storyboards → reference frames → image-to-video → voice → edit → QA → approval → export. Bulk mode: generate 30 concepts, select up to N, produce N." departments={["social"]} templateKeys={["social_video"]}
      aside={
        <Card>
          <SectionTitle title="Recent final drafts" sub="Character consistency is never guaranteed – every draft is human-reviewed" />
          {finals.length ? <div className="grid grid-cols-2 gap-2">{finals.map((a) => <GenTile key={a.id} a={a} />)}</div> : <p className="text-sm text-mist-400">No drafts yet.</p>}
        </Card>
      }
    />
  );
}

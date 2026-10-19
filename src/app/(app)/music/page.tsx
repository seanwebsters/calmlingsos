import { requireViewer } from "@/lib/auth/session";
import { listGeneratedAssets } from "@/lib/review/assets";
import { listReferences } from "@/lib/brain/references";
import { StudioPage } from "@/components/studio/studio-page";
import { GenTile, RefTile } from "@/components/media";
import { Card, Notice, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Music & Audio" };

export default async function Music() {
  const viewer = await requireViewer();
  const [audio, refs] = await Promise.all([listGeneratedAssets(viewer.orgId, { kind: "audio", latestOnly: true, limit: 24 }), listReferences(viewer.orgId, { mediaKind: "audio" })]);
  return (
    <StudioPage viewer={viewer} eyebrow="09 · Music & Audio" title="Songs, soundscapes & voice" sub="Song concept → lyrics → brand check → music video treatment → instrumental demo → review → export." departments={["music"]} templateKeys={["song_to_video"]}
      aside={
        <>
          <Notice tone="warn" title="Rights and consent">Every generated track records its provider and licence note in provenance – confirm commercial terms before release. Voice synthesis only uses voices assigned in approved character canon with a recorded consent note; voice cloning without documented consent is not supported.</Notice>
          <Card><SectionTitle title="Generated audio" />{audio.length ? <div className="grid grid-cols-3 gap-2">{audio.map((a) => <GenTile key={a.id} a={a} />)}</div> : <p className="text-sm text-mist-400">None yet.</p>}</Card>
          <Card><SectionTitle title="Music & voice references" />{refs.length ? <div className="grid grid-cols-3 gap-2">{refs.map((r) => <RefTile key={r.id} r={r} />)}</div> : <p className="text-sm text-mist-400">Upload music references or licensed voice recordings.</p>}</Card>
        </>
      }
    />
  );
}

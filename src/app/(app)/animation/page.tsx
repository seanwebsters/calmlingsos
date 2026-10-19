import { requireViewer } from "@/lib/auth/session";
import { listReferences } from "@/lib/brain/references";
import { listGeneratedAssets } from "@/lib/review/assets";
import { StudioPage } from "@/components/studio/studio-page";
import { GenTile, RefTile } from "@/components/media";
import { Card, Notice, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Animation Studio" };

export default async function Animation() {
  const viewer = await requireViewer();
  const [refs, frames, clips] = await Promise.all([listReferences(viewer.orgId, { limit: 200 }), listGeneratedAssets(viewer.orgId, { role: "animation_frame", latestOnly: true, limit: 12 }), listGeneratedAssets(viewer.orgId, { role: "concept_clip", latestOnly: true, limit: 12 })]);
  const anim = refs.filter((r) => r.assetType === "animation_clip" || r.mediaKind === "video");
  const models = refs.filter((r) => r.mediaKind === "model3d");
  return (
    <StudioPage viewer={viewer} eyebrow="05 · Animation Studio" title="Character animation" sub="Pose boards, expression sheets, loops and concept clips – always within each character's approved animation rules." departments={["animation"]} templateKeys={["animation_concepts"]}
      aside={
        <>
          <Notice tone="warn" title="Concepts are not rigged assets">Generated clips are flat video. They are never labelled as rigged, editable 3D animation.</Notice>
          <Card>
            <SectionTitle title="3D production handoff" sub="Import/export of GLB/GLTF is supported; rigging and final animation happen in your DCC tool" />
            <ul className="list-disc space-y-1 pl-5 text-sm text-mist-300">
              <li>Upload GLB/GLTF masters to the Reference Library – mesh, material and animation counts are extracted.</li>
              <li>Handoff pack: approved turnaround + expression sheet + animation rules + consistency checklist (export from the character's references and approved assets).</li>
              <li>Specify rig requirements (joint naming, scale in metres, Y-up, 30 fps) in Production canon so every handoff uses them.</li>
            </ul>
            {models.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2">{models.map((r) => <RefTile key={r.id} r={r} />)}</div>}
          </Card>
          <Card>
            <SectionTitle title="Animation references" />
            {anim.length ? <div className="grid grid-cols-3 gap-2">{anim.slice(0, 9).map((r) => <RefTile key={r.id} r={r} />)}</div> : <p className="text-sm text-mist-400">Upload existing animation to extract motion descriptions.</p>}
          </Card>
          <Card>
            <SectionTitle title="Recent frames & clips" />
            <div className="grid grid-cols-3 gap-2">{[...frames, ...clips].slice(0, 9).map((a) => <GenTile key={a.id} a={a} />)}</div>
          </Card>
        </>
      }
    />
  );
}

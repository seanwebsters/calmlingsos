import { requireViewer } from "@/lib/auth/session";
import { listCanon } from "@/lib/brain/canon";
import { listCharacters } from "@/lib/brain/characters";
import { StudioPage } from "@/components/studio/studio-page";
import { CanonBoard } from "@/components/canon/canon-board";
import { Card, SectionTitle, Status } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Story & World Studio" };

export default async function Story() {
  const viewer = await requireViewer();
  const [canon, chars] = await Promise.all([listCanon(viewer.orgId), listCharacters(viewer.orgId)]);
  const timeline = canon.filter((r) => (r.domain === "lore" || r.domain === "world") && r.timelineOrder !== null && r.canonStatus !== "rejected").sort((a, b) => a.timelineOrder! - b.timelineOrder!);
  const nodes = chars.filter((c) => c.approvedVersion);
  const edges = nodes.flatMap((c) => c.approvedVersion!.profile.relationships.filter((r) => nodes.some((n) => n.id === r.characterId)).map((r) => ({ from: c.id, to: r.characterId, label: r.nature })));
  const R = 140;
  const pos = Object.fromEntries(nodes.map((n, i) => [n.id, { x: 200 + R * Math.cos((2 * Math.PI * i) / Math.max(1, nodes.length) - Math.PI / 2), y: 180 + R * Math.sin((2 * Math.PI * i) / Math.max(1, nodes.length) - Math.PI / 2) }]));
  return (
    <StudioPage viewer={viewer} eyebrow="08 · Story & World Studio" title="Worldbuilding & continuity" sub="Backstories, episodic stories, arcs, new environments and new characters – proposed as DRAFT CANON and approved only by you." departments={["story"]} templateKeys={["story_development", "new_character"]}
      aside={
        <>
          <Card>
            <SectionTitle title="Relationship graph" sub="From approved character profiles" />
            {nodes.length < 2 ? <p className="text-sm text-mist-400">Approve at least two character profiles with relationships.</p> : (
              <svg viewBox="0 0 400 360" className="w-full">
                {edges.map((e, i) => (
                  <g key={i}>
                    <line x1={pos[e.from].x} y1={pos[e.from].y} x2={pos[e.to].x} y2={pos[e.to].y} stroke="rgba(126,165,255,0.35)" strokeWidth={1.5} />
                    <text x={(pos[e.from].x + pos[e.to].x) / 2} y={(pos[e.from].y + pos[e.to].y) / 2 - 4} fill="#9aa4c4" fontSize={9} textAnchor="middle">{e.label.slice(0, 24)}</text>
                  </g>
                ))}
                {nodes.map((n) => (
                  <g key={n.id}>
                    <circle cx={pos[n.id].x} cy={pos[n.id].y} r={22} fill="#141d3d" stroke={n.approvedVersion!.profile.colours[0]?.hex ?? "#7ea5ff"} strokeWidth={2} />
                    <text x={pos[n.id].x} y={pos[n.id].y + 38} fill="#e7ebf7" fontSize={11} textAnchor="middle">{n.name}</text>
                  </g>
                ))}
              </svg>
            )}
          </Card>
          <Card>
            <SectionTitle title="Timeline" sub="Lore & world records with a timeline order" />
            {timeline.length === 0 ? <p className="text-sm text-mist-400">Give lore records a timeline order to see them here.</p> : (
              <ol className="relative space-y-3 border-l border-white/10 pl-4">
                {timeline.map((t) => (
                  <li key={t.id}>
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-calm-300" />
                    <div className="flex items-center gap-2 text-sm"><span className="font-mono text-xs text-mist-500">{t.timelineOrder}</span><span className="text-white">{t.title}</span><Status value={t.canonStatus} /></div>
                    <p className="line-clamp-2 text-xs text-mist-400">{t.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      }
    >
      <CanonBoard viewer={viewer} domains={["lore", "world"]} />
    </StudioPage>
  );
}

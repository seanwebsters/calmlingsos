import Link from "next/link";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listReferences, DESIGNATIONS } from "@/lib/brain/references";
import { listCharacters } from "@/lib/brain/characters";
import { getOrgSettings } from "@/lib/org";
import { Uploader } from "@/components/references/uploader";
import { RefTile } from "@/components/media";
import { Empty, LinkButton, PageHeader } from "@/components/ui";
import { LiveRefresh } from "@/components/client/live";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reference Library" };

export default async function ReferencesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const [refs, chars, settings] = await Promise.all([listReferences(viewer.orgId, { q: sp.q, characterId: sp.character, designation: sp.designation, mediaKind: sp.kind, tag: sp.tag }), listCharacters(viewer.orgId), getOrgSettings(viewer.orgId)]);
  const q = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...sp, ...patch, upload: undefined };
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) u.set(k, v);
    return `/references?${u.toString()}`;
  };
  return (
    <div>
      <LiveRefresh scope="org" />
      <PageHeader eyebrow="03 · Reference Library" title="The source of truth" sub="Official renders, turnarounds, expression sheets, clips, guidelines and scripts. Only official and approved references are ever used as canon." actions={<LinkButton href="/canon">Calmlings Bible →</LinkButton>} />
      {can(viewer.role, "reference:upload") && (
        <div className="mb-8">
          <Uploader characters={chars.map((c) => ({ id: c.id, name: c.name }))} canClassify={can(viewer.role, "canon:approve")} defaultCharacter={sp.character} maxMb={settings.maxUploadMb} />
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form action="/references" className="mr-2">
          {Object.entries(sp).filter(([k, v]) => v && k !== "q" && k !== "upload").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input name="q" defaultValue={sp.q} placeholder="Filter by title or notes" className="field w-56 py-1.5 text-[13px]" />
        </form>
        <Chip href={q({ designation: undefined })} on={!sp.designation}>All</Chip>
        {DESIGNATIONS.map((d) => <Chip key={d.value} href={q({ designation: d.value })} on={sp.designation === d.value}>{d.label}</Chip>)}
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        <Chip href={q({ character: undefined })} on={!sp.character}>Every character</Chip>
        {chars.map((c) => <Chip key={c.id} href={q({ character: c.id })} on={sp.character === c.id}>{c.name}</Chip>)}
        <span className="mx-2 h-5 w-px bg-white/10" />
        {["image", "video", "audio", "document", "model3d", "data"].map((k) => <Chip key={k} href={q({ kind: sp.kind === k ? undefined : k })} on={sp.kind === k}>{k}</Chip>)}
      </div>
      {refs.length === 0 ? (
        <Empty title="No references match">Upload your official Calmlings material above. Until then, the interface shows neutral placeholders – never invented designs.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-7">{refs.map((r) => <RefTile key={r.id} r={r} />)}</div>
      )}
    </div>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return <Link href={href} className={cn("rounded-full border px-2.5 py-1 text-xs transition", on ? "border-calm-300/50 bg-calm-400/15 text-white" : "border-white/10 text-mist-400 hover:text-white")}>{children}</Link>;
}

import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { Lock } from "lucide-react";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { listCharacters } from "@/lib/brain/characters";
import { urlFor } from "@/lib/storage";
import { Badge, Empty, PageHeader, Placeholder, Progress, Status } from "@/components/ui";
import { NewCharacter } from "@/components/characters/new-character";

export const dynamic = "force-dynamic";
export const metadata = { title: "Character Universe" };

export default async function CharactersPage() {
  const viewer = await requireViewer();
  const chars = await listCharacters(viewer.orgId);
  const db = await getDb();
  const heroIds = chars.map((c) => c.heroAssetId).filter((x): x is string => Boolean(x));
  const heroes = heroIds.length ? await db.select({ a: schema.referenceAssets, v: schema.assetVersions }).from(schema.referenceAssets).innerJoin(schema.assetVersions, eq(schema.assetVersions.id, schema.referenceAssets.currentVersionId)).where(inArray(schema.referenceAssets.id, heroIds)) : [];
  const urls = Object.fromEntries(await Promise.all(chars.map(async (c) => [c.id, await urlFor(heroes.find((h) => h.a.id === c.heroAssetId)?.v.thumbnailKey ?? null)] as const)));
  return (
    <div>
      <PageHeader eyebrow="02 · Character Universe" title="The Calmlings encyclopedia" sub="Every character's approved canon, references and work. Uploaded references are the source of truth – placeholders mark what's missing." actions={<NewCharacter />} />
      {chars.length === 0 ? (
        <Empty title="No characters yet">Create a character, then upload official renders, turnarounds and expression sheets in the Reference Library.</Empty>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {chars.map((c) => (
            <Link key={c.id} href={`/characters/${c.id}`} className="group panel overflow-hidden p-0 transition hover:border-calm-300/25 animate-rise">
              <div className="relative bg-gradient-to-b from-ink-800 to-ink-900 p-4">
                {urls[c.id] ? <img src={urls[c.id]!} alt={c.name} className="aspect-square w-full object-contain transition duration-500 group-hover:scale-[1.02]" /> : <Placeholder label="Choose a hero render from approved references" />}
                {c.locked && (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-ink-950/80 px-2 py-0.5 text-[11px] text-calm-200">
                    <Lock className="size-3" /> Locked
                  </span>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-display text-xl text-white">{c.name}</div>
                    <div className="font-mono text-[11px] text-mist-500">{c.code}</div>
                  </div>
                  <Status value={c.canonStatus} />
                </div>
                <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-mist-300">{c.approvedVersion?.profile.personality || c.summary || "Personality not yet defined in canon."}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge>{c.referenceCount} references</Badge>
                  <Badge tone={c.masterCount ? "ok" : "warn"}>{c.masterCount} masters</Badge>
                  {c.pendingVersions > 0 && <Badge tone="warn">{c.pendingVersions} pending change</Badge>}
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px] text-mist-500">
                    <span>Production readiness</span>
                    <span>{Math.round(c.readiness.score * 100)}%</span>
                  </div>
                  <Progress value={c.readiness.score} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

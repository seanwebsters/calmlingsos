import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { urlFor } from "@/lib/storage";
import { GAME_EXPORTERS } from "@/lib/game/exporters";
import { StudioPage } from "@/components/studio/studio-page";
import { SpriteTool } from "@/components/studio/sprite-tool";
import { Badge, Card, Empty, SectionTitle, Status } from "@/components/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Game Studio" };

export default async function Game({ searchParams }: { searchParams: Promise<{ collection?: string; status?: string }> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const db = await getDb();
  const all = await db.select().from(schema.gameAssets).where(eq(schema.gameAssets.orgId, viewer.orgId)).orderBy(desc(schema.gameAssets.createdAt));
  const collections = [...new Set(all.map((a) => a.collection))];
  const shown = all.filter((a) => (!sp.collection || a.collection === sp.collection) && (!sp.status || a.status === sp.status));
  const withUrls = await Promise.all(shown.map(async (a) => ({ ...a, url: await urlFor(a.storageKey) })));
  return (
    <StudioPage viewer={viewer} eyebrow="06 · Game Studio" title="Sanctuary & garden game assets" sub="Every request carries a technical spec. Concepts become game-ready only when deterministic validation passes – looking good isn't enough." departments={["game"]} templateKeys={["game_asset"]}
      aside={
        <>
          <Card>
            <SectionTitle title="Engine integrations" sub="Provider-neutral exporters – engines can be added without rewriting the studio" />
            {GAME_EXPORTERS.map((e) => (
              <div key={e.key} className="flex items-center justify-between border-b border-white/[0.04] py-1.5 text-sm last:border-0">
                <span className="text-mist-200">{e.name}</span>
                <Badge tone={e.available ? "ok" : "neutral"}>{e.available ? "available" : "planned"}</Badge>
              </div>
            ))}
          </Card>
          <SpriteTool assets={withUrls.filter((a) => a.status === "technically_validated").map((a) => ({ id: a.id, name: a.name, url: a.url }))} />
        </>
      }
    >
      <Card>
        <SectionTitle title="Game asset browser" action={<a href={`/api/game-assets/export${sp.collection ? `?collection=${encodeURIComponent(sp.collection)}` : ""}`} className="link text-sm">Export validated bundle →</a>} />
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <Link href="/game" className={cn("rounded-full border px-2.5 py-1", !sp.collection ? "border-calm-300/50 text-white" : "border-white/10 text-mist-400")}>All collections</Link>
          {collections.map((c) => <Link key={c} href={`/game?collection=${encodeURIComponent(c)}`} className={cn("rounded-full border px-2.5 py-1", sp.collection === c ? "border-calm-300/50 text-white" : "border-white/10 text-mist-400")}>{c}</Link>)}
          <span className="mx-1" />
          {["technically_validated", "validation_failed", "concept"].map((s) => <Link key={s} href={`/game?${new URLSearchParams({ ...(sp.collection ? { collection: sp.collection } : {}), status: s })}`} className={cn("rounded-full border px-2.5 py-1", sp.status === s ? "border-calm-300/50 text-white" : "border-white/10 text-mist-400")}>{s.replace(/_/g, " ")}</Link>)}
        </div>
        {withUrls.length === 0 ? <Empty title="No game assets yet" /> : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {withUrls.map((a) => (
              <details key={a.id} className="overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/70">
                <summary className="cursor-pointer list-none">
                  {a.url && <img src={a.url} alt={a.name} className="checker aspect-square w-full object-contain" />}
                  <div className="space-y-1 p-2.5">
                    <div className="truncate font-mono text-[11px] text-white">{a.name}</div>
                    <Status value={a.status} />
                  </div>
                </summary>
                <div className="space-y-0.5 border-t border-white/[0.05] p-2.5 text-[11px]">
                  {a.validation?.checks.map((c) => <div key={c.name} className={c.passed ? "text-mist-300" : "text-bad"}>{c.passed ? "✓" : "✕"} {c.name}: {c.detail}</div>)}
                  <div className="pt-1 text-mist-500">{a.spec.targetEngine} · {a.spec.targetPlatform} · {a.collection}</div>
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </StudioPage>
  );
}

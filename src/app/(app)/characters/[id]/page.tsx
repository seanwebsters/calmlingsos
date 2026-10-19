import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { Lock } from "lucide-react";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getCharacter, listCharacters, readiness } from "@/lib/brain/characters";
import { listReferences } from "@/lib/brain/references";
import { changedFields, emptyProfile, PROFILE_FIELDS } from "@/lib/brain/profile";
import { listGeneratedAssets } from "@/lib/review/assets";
import { urlFor } from "@/lib/storage";
import { VIEW_ANGLES } from "@/lib/files/sniff";
import { Action } from "@/components/client/action";
import { ProfileEditor } from "@/components/characters/profile-editor";
import { GenTile, RefTile } from "@/components/media";
import { Badge, Card, Empty, KeyVal, LinkButton, PageHeader, Placeholder, Progress, SectionTitle, Status } from "@/components/ui";
import { cn, timeAgo, titleCase, usd } from "@/lib/cn";

export const dynamic = "force-dynamic";

const TABS = ["overview", "master references", "expressions", "animations", "voice", "personality", "stories", "game assets", "social content", "products", "version history"];

export default async function CharacterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const tab = (await searchParams).tab ?? "overview";
  const { character: c, versions, approved, latest } = await getCharacter(viewer.orgId, id);
  const refs = await listReferences(viewer.orgId, { characterId: id });
  const masters = refs.filter((r) => r.designation === "official_master");
  const approvedRefs = refs.filter((r) => r.designation === "official_master" || r.designation === "approved_supporting");
  const ready = readiness(approved?.profile ?? null, masters.length, approvedRefs.length - masters.length);
  const hero = refs.find((r) => r.id === c.heroAssetId);
  const profile = approved?.profile ?? latest?.profile ?? emptyProfile(c.name);
  const others = (await listCharacters(viewer.orgId)).filter((x) => x.id !== id).map((x) => ({ id: x.id, name: x.name }));
  const db = await getDb();
  const generated = (await listGeneratedAssets(viewer.orgId, { latestOnly: true, limit: 300 })).filter((g) => g.characterIds.includes(id));

  return (
    <div>
      <PageHeader
        eyebrow={`Character Universe · ${c.code}`}
        title={
          <span className="flex items-center gap-3">
            {c.name}
            {c.locked && <Lock className="size-6 text-calm-300" />}
          </span>
        }
        sub={approved?.profile.approvedDescription || c.summary || "No approved description yet."}
        actions={
          <>
            <Status value={c.canonStatus} />
            <LinkButton href={`/references?character=${id}&upload=1`} variant="primary">Upload references</LinkButton>
          </>
        }
      />
      <nav className="mb-6 flex flex-wrap gap-1 border-b border-white/[0.06]">
        {TABS.map((t) => (
          <Link key={t} href={`/characters/${id}?tab=${encodeURIComponent(t)}`} className={cn("-mb-px border-b-2 px-3 py-2 text-[12px] uppercase tracking-[0.1em] transition", tab === t ? "border-calm-300 text-white" : "border-transparent text-mist-400 hover:text-mist-200")}>
            {t}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <Card className="p-4">
            {hero?.thumbUrl ? <img src={(await urlFor(hero.version?.storageKey)) ?? hero.thumbUrl} alt={c.name} className="checker aspect-square w-full rounded-xl object-contain" /> : <Placeholder label="No hero render – pick one from approved references" />}
            {approvedRefs.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {approvedRefs.filter((r) => r.mediaKind === "image").slice(0, 8).map((r) => (
                  <Action key={r.id} endpoint={`/api/characters/${id}`} method="PATCH" body={{ heroAssetId: r.id }} variant="ghost" size="sm" className={cn("p-0", r.id === c.heroAssetId && "ring-2 ring-calm-300")}>
                    <img src={r.thumbUrl ?? ""} alt={r.title} className="size-12 rounded-md object-cover" />
                  </Action>
                ))}
              </div>
            )}
          </Card>
          <div className="space-y-6">
            <Card>
              <SectionTitle title="Production readiness" sub="A transparent checklist of approved canon" />
              <Progress value={ready.score} />
              <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
                {ready.checks.map((k) => (
                  <li key={k.label} className="flex items-center gap-2 text-sm">
                    <span className={cn("size-2 rounded-full", k.ok ? "bg-ok" : "bg-mist-600")} />
                    <span className={k.ok ? "text-mist-100" : "text-mist-400"}>{k.label}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <SectionTitle title="Approved canon" sub={approved ? `Profile v${approved.version}, approved ${timeAgo(approved.approvedAt)}` : "No approved profile yet – agents won't use this character until one is approved."} action={<LinkButton href={`/characters/${id}?tab=personality`} variant="secondary">Edit profile</LinkButton>} />
              {approved ? (
                <div className="space-y-1">
                  <KeyVal k="Personality" v={approved.profile.personality || "—"} />
                  <KeyVal k="Emotional purpose" v={approved.profile.emotionalPurpose || "—"} />
                  <KeyVal k="Silhouette" v={approved.profile.silhouette || "—"} />
                  <div className="flex flex-wrap gap-2 pt-2">
                    {approved.profile.colours.map((col) => (
                      <span key={col.hex + col.name} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-2 py-0.5 text-xs text-mist-200">
                        <span className="size-3 rounded-full" style={{ background: col.hex }} /> {col.name} <span className="font-mono text-mist-500">{col.hex}</span>
                      </span>
                    ))}
                  </div>
                  {approved.profile.forbiddenChanges.length > 0 && (
                    <div className="pt-3">
                      <div className="label mb-1 text-bad">Forbidden changes</div>
                      <ul className="list-disc pl-5 text-sm text-mist-200">{approved.profile.forbiddenChanges.map((f) => <li key={f}>{f}</li>)}</ul>
                    </div>
                  )}
                </div>
              ) : (
                <Empty title="Canon not yet approved">Fill in the profile from your official references, then approve it.</Empty>
              )}
            </Card>
            {c.locked && (
              <Card>
                <SectionTitle title="Character Lock" sub="These fields can only change through approved change requests" />
                <div className="flex flex-wrap gap-1.5">{c.lockedFields.map((f) => <Badge key={f} tone="calm">{PROFILE_FIELDS.find((p) => p.key === f)?.label ?? f}</Badge>)}</div>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "master references" && (
        <div className="space-y-6">
          <Card>
            <SectionTitle title="View coverage" sub="Which approved views exist. Empty slots are neutral placeholders – upload the real artwork." />
            <div className="grid grid-cols-3 gap-3 md:grid-cols-5 xl:grid-cols-9">
              {VIEW_ANGLES.map((v) => {
                const r = approvedRefs.find((x) => x.viewAngle === v && x.mediaKind === "image");
                return (
                  <div key={v}>
                    {r ? <Link href={`/references/${r.id}`}><img src={r.thumbUrl ?? ""} alt={v} className="checker aspect-square w-full rounded-lg object-contain" /></Link> : <Placeholder label="missing" />}
                    <div className="mt-1 text-center text-[11px] text-mist-400">{titleCase(v)}</div>
                  </div>
                );
              })}
            </div>
          </Card>
          <SectionTitle title="All references" sub={`${refs.length} linked · ${approvedRefs.length} approved`} />
          {refs.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{refs.map((r) => <RefTile key={r.id} r={r} />)}</div> : <Empty title="No references linked" action={<LinkButton href={`/references?character=${id}&upload=1`} variant="primary">Upload</LinkButton>} />}
        </div>
      )}

      {tab === "expressions" && <AssetSection title="Expressions" refs={refs.filter((r) => r.assetType === "expression_sheet")} gens={generated.filter((g) => ["expression_sheet", "animation_frame"].includes(g.role))} />}
      {tab === "animations" && <AssetSection title="Animations" note="Generated clips are video, not rigged or editable animation." refs={refs.filter((r) => r.assetType === "animation_clip" || r.mediaKind === "video")} gens={generated.filter((g) => ["concept_clip", "shot_video"].includes(g.role))} />}
      {tab === "voice" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionTitle title="Approved voice" />
            <KeyVal k="Direction" v={profile.voice || "Not defined"} />
            <KeyVal k="Provider assignment" v={profile.voiceAssignment ? `${profile.voiceAssignment.provider} · ${profile.voiceAssignment.voiceId}` : "None – voice lines for this character are skipped"} />
            <KeyVal k="Consent / licence" v={profile.voiceAssignment?.consentNote ?? "—"} />
          </Card>
          <AssetSection title="Voice recordings & lines" refs={refs.filter((r) => r.mediaKind === "audio")} gens={generated.filter((g) => g.role === "voice_line")} />
        </div>
      )}
      {tab === "personality" && (
        can(viewer.role, "canon:edit") ? (
          <ProfileEditor characterId={id} profile={latest?.profile ?? profile} lockedFields={c.lockedFields} locked={c.locked} characters={others} canLock={can(viewer.role, "character:lock")} />
        ) : (
          <Empty title="Read-only">Your role can't edit canon.</Empty>
        )
      )}
      {tab === "stories" && <Stories orgId={viewer.orgId} id={id} />}
      {tab === "game assets" && <GameAssets orgId={viewer.orgId} id={id} />}
      {tab === "social content" && <AssetSection title="Social content" refs={refs.filter((r) => r.assetType === "social_video")} gens={generated.filter((g) => ["final_cut", "reference_frame"].includes(g.role))} />}
      {tab === "products" && <Products orgId={viewer.orgId} id={id} />}
      {tab === "version history" && (
        <Card>
          <SectionTitle title="Version history" sub="Every save is a new version. Approved masters of canon are never overwritten." />
          <div className="divide-y divide-white/[0.05]">
            {versions.map((v) => {
              const diff = approved && v.id !== approved.id ? changedFields(approved.profile, v.profile) : [];
              return (
                <div key={v.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="w-12 font-mono text-sm text-white">v{v.version}</span>
                  <Status value={v.status} />
                  {v.source === "ai_proposal" && <Badge tone="violet">AI proposal</Badge>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-mist-100">{v.changeNote || "—"}</div>
                    <div className="text-xs text-mist-500">{timeAgo(v.createdAt)}{diff.length ? ` · differs from approved in: ${diff.map((d) => PROFILE_FIELDS.find((f) => f.key === d)?.label ?? d).join(", ")}` : ""}</div>
                  </div>
                  {can(viewer.role, "canon:approve") && (v.status === "draft" || v.status === "pending_approval") && (
                    <div className="flex gap-2">
                      <Action endpoint={`/api/character-versions/${v.id}/approve`} variant="ok" size="sm" confirm={`Make v${v.version} the official canon for ${c.name}?`}>Approve as canon</Action>
                      <Action endpoint={`/api/character-versions/${v.id}/reject`} variant="danger" size="sm" prompt="Why reject this version?" promptField="note">Reject</Action>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );

  async function Stories({ orgId, id }: { orgId: string; id: string }) {
    const records = await db.select().from(schema.canonRecords).where(and(eq(schema.canonRecords.orgId, orgId), sql`${schema.canonRecords.characterIds} @> ${JSON.stringify([id])}::jsonb`, eq(schema.canonRecords.superseded, false))).orderBy(desc(schema.canonRecords.createdAt));
    const docs = generated.filter((g) => g.kind === "document");
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Lore & world records" action={<Link href="/story" className="link text-sm">Story & World →</Link>} />
          {records.length ? records.map((r) => (
            <div key={r.id} className="border-b border-white/[0.05] py-2 last:border-0">
              <div className="flex items-center gap-2"><span className="text-sm text-white">{r.title}</span><Status value={r.canonStatus} /></div>
              <p className="line-clamp-2 text-xs text-mist-400">{r.body}</p>
            </div>
          )) : <p className="text-sm text-mist-400">No lore records reference this character.</p>}
        </Card>
        <Card>
          <SectionTitle title="Stories & documents" />
          {docs.length ? docs.map((d) => <Link key={d.id} href={`/assets/${d.id}`} className="flex items-center justify-between border-b border-white/[0.05] py-2 text-sm last:border-0"><span className="text-mist-100">{d.title}</span><Status value={d.status} /></Link>) : <p className="text-sm text-mist-400">No story documents yet.</p>}
        </Card>
      </div>
    );
  }

  async function GameAssets({ orgId, id }: { orgId: string; id: string }) {
    const rows = await db.select().from(schema.gameAssets).where(and(eq(schema.gameAssets.orgId, orgId), sql`${schema.gameAssets.characterIds} @> ${JSON.stringify([id])}::jsonb`));
    const withUrls = await Promise.all(rows.map(async (g) => ({ ...g, url: await urlFor(g.storageKey) })));
    return withUrls.length ? (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {withUrls.map((g) => (
          <div key={g.id} className="overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/70">
            {g.url ? <img src={g.url} alt={g.name} className="checker aspect-square w-full object-contain" /> : <Placeholder />}
            <div className="p-2.5"><div className="truncate font-mono text-[11px] text-white">{g.name}</div><Status value={g.status} /></div>
          </div>
        ))}
      </div>
    ) : <Empty title="No game assets yet" action={<LinkButton href="/game">Game Studio</LinkButton>} />;
  }

  async function Products({ orgId, id }: { orgId: string; id: string }) {
    const rows = await db.select().from(schema.productConcepts).where(and(eq(schema.productConcepts.orgId, orgId), sql`${schema.productConcepts.characterIds} @> ${JSON.stringify([id])}::jsonb`)).orderBy(desc(schema.productConcepts.createdAt));
    return rows.length ? (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-center justify-between"><span className="text-white">{p.name}</span><Status value={p.status} /></div>
            <div className="text-xs text-mist-400">{p.category} · iteration {p.iteration}</div>
            <div className="mt-2 text-sm text-mist-300">Est. retail {usd(p.targetRetailCents)} · est. unit cost {usd(p.estUnitCostCents)} {!p.quoteVerified && <Badge tone="warn">estimate</Badge>}</div>
          </Card>
        ))}
      </div>
    ) : <Empty title="No products yet" action={<LinkButton href="/product">Product Lab</LinkButton>} />;
  }
}

function AssetSection({ title, refs, gens, note }: { title: string; refs: Parameters<typeof RefTile>[0]["r"][]; gens: Parameters<typeof GenTile>[0]["a"][]; note?: string }) {
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle title={`${title}: approved & uploaded references`} sub={note} />
        {refs.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{refs.map((r) => <RefTile key={r.id} r={r} />)}</div> : <p className="text-sm text-mist-400">None uploaded.</p>}
      </div>
      <div>
        <SectionTitle title={`${title}: generated work`} />
        {gens.length ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{gens.map((g) => <GenTile key={g.id} a={g} />)}</div> : <p className="text-sm text-mist-400">Nothing generated yet.</p>}
      </div>
    </div>
  );
}

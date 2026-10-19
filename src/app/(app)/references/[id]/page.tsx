import Link from "next/link";
import { desc, eq, sql, and } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getReference, DESIGNATIONS } from "@/lib/brain/references";
import { listCharacters } from "@/lib/brain/characters";
import { ASSET_TYPES } from "@/lib/files/sniff";
import { urlFor } from "@/lib/storage";
import { Action } from "@/components/client/action";
import { LiveRefresh } from "@/components/client/live";
import { AnalysisEditor, MetaEditor, NewVersion } from "@/components/references/editors";
import { Badge, Card, KeyVal, PageHeader, SectionTitle, Status } from "@/components/ui";
import { timeAgo } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function ReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const { asset, versions, current, characters, tags } = await getReference(viewer.orgId, id);
  const allChars = await listCharacters(viewer.orgId);
  const url = await urlFor(current?.storageKey);
  const keyframes = await Promise.all((asset.technical.keyframeKeys ?? []).map((k) => urlFor(k)));
  const versionUrls = await Promise.all(versions.map(async (v) => ({ ...v, url: await urlFor(v.thumbnailKey ?? v.storageKey), dl: await urlFor(v.storageKey, { download: v.originalName }) })));
  const db = await getDb();
  const usedBy = current ? await db.select().from(schema.generatedAssets).where(and(eq(schema.generatedAssets.orgId, viewer.orgId), sql`${schema.generatedAssets.provenance} -> 'referenceAssetVersionIds' ? ${current.id}`)).orderBy(desc(schema.generatedAssets.createdAt)).limit(24) : [];
  const history = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.targetType, "reference_asset"), eq(schema.auditEvents.targetId, id))).orderBy(desc(schema.auditEvents.createdAt)).limit(20);
  const t = asset.technical;
  const canClassify = can(viewer.role, "reference:classify");
  const canApprove = can(viewer.role, "canon:approve");
  return (
    <div>
      {asset.analysisStatus === "queued" && <LiveRefresh scope={`reference:${id}`} />}
      <PageHeader eyebrow={`Reference · ${asset.id}`} title={asset.title} sub={`${asset.assetType.replace(/_/g, " ")} · ${asset.mediaKind} · uploaded ${timeAgo(asset.createdAt)}`} actions={<><Status value={asset.designation} />{asset.immutable && <Badge tone="calm">Immutable history</Badge>}</>} />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card className="p-3">
            <div className="checker flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl">
              {asset.mediaKind === "image" && url && <img src={url} alt={asset.title} className="max-h-[70vh] object-contain" />}
              {asset.mediaKind === "video" && url && <video src={url} controls className="max-h-[70vh] w-full" />}
              {asset.mediaKind === "audio" && url && <audio src={url} controls className="w-full max-w-lg" />}
              {(asset.mediaKind === "document" || asset.mediaKind === "data") && <pre className="max-h-[60vh] w-full overflow-auto whitespace-pre-wrap bg-ink-900 p-4 text-xs text-mist-200">{asset.analysis?.extractedText?.slice(0, 20000) ?? "No extractable text."}</pre>}
              {asset.mediaKind === "model3d" && <div className="p-8 text-center text-sm text-mist-300">3D file ({t.format}). Inspect in your DCC tool – summary below.</div>}
            </div>
            {keyframes.length > 0 && (
              <div className="mt-3 grid grid-cols-6 gap-2">
                {keyframes.map((k, i) => k && <img key={i} src={k} alt={`keyframe ${i}`} className="aspect-video w-full rounded object-cover" />)}
              </div>
            )}
          </Card>
          <Card>
            <SectionTitle title="Designation" sub="Only Official Master and Approved Supporting references are used as canon." />
            <div className="flex flex-wrap gap-2">
              {DESIGNATIONS.filter((d) => d.value !== "unclassified").map((d) => {
                const allowed = canClassify && (!d.canon || canApprove);
                return (
                  <Action key={d.value} endpoint={`/api/references/${id}/classify`} body={{ designation: d.value }} variant={asset.designation === d.value ? "primary" : "secondary"} size="sm" disabled={!allowed || asset.designation === d.value} confirm={d.value === "official_master" ? "Designate as OFFICIAL MASTER? Its history becomes immutable and agents will use it as the identity source of truth." : undefined}>
                    {d.label}
                  </Action>
                );
              })}
            </div>
            {!canApprove && <p className="mt-2 text-xs text-mist-500">Only a creative director or owner can designate official or approved references.</p>}
          </Card>
          <Card>
            <SectionTitle title="Machine analysis" sub="Editable. Never treated as canon until a human reviews it." action={canClassify && <Action endpoint={`/api/references/${id}/analysis`} body={{ reanalyze: true }} size="sm">Re-analyse</Action>} />
            <div className="mb-3 flex items-center gap-2 text-xs"><Status value={asset.analysisStatus === "done" ? "completed" : asset.analysisStatus === "none" ? "pending" : asset.analysisStatus} />{asset.analysisError && <span className="text-mist-400">{asset.analysisError} {asset.analysisStatus === "blocked" && <Link href="/settings" className="link">Settings →</Link>}</span>}</div>
            {asset.analysis ? <AnalysisEditor id={id} analysis={asset.analysis} reviewed={asset.analysisReviewed} canReview={canClassify} /> : <p className="text-sm text-mist-400">No analysis yet.</p>}
            {asset.analysis?.characterCandidates && asset.analysis.characterCandidates.length > 0 && (
              <div className="mt-4">
                <div className="label mb-1">Character identity candidates (machine)</div>
                {asset.analysis.characterCandidates.map((c, i) => <div key={i} className="text-sm text-mist-200">{c.name} · {(c.confidence * 100).toFixed(0)}% <span className="text-mist-500">– {c.reason}</span></div>)}
              </div>
            )}
            {asset.analysis?.sceneDescriptions && (
              <div className="mt-4 space-y-1">
                <div className="label mb-1">Scenes</div>
                {asset.analysis.sceneDescriptions.map((s, i) => <div key={i} className="text-sm text-mist-200"><span className="font-mono text-mist-500">{s.atSeconds}s</span> {s.description}</div>)}
                {asset.analysis.movement && <KeyVal k="Movement" v={asset.analysis.movement} />}
                {asset.analysis.editingRhythm && <KeyVal k="Editing rhythm" v={asset.analysis.editingRhythm} />}
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <SectionTitle title="Metadata" />
            {can(viewer.role, "reference:upload") ? (
              <MetaEditor id={id} initial={{ title: asset.title, assetType: asset.assetType, viewAngle: asset.viewAngle, rightsStatus: asset.rightsStatus, usageNotes: asset.usageNotes, notes: asset.notes, source: asset.source, characterIds: characters.map((c) => c.id), tags }} characters={allChars.map((c) => ({ id: c.id, name: c.name }))} assetTypes={ASSET_TYPES} />
            ) : (
              <div className="text-sm text-mist-300">{characters.map((c) => c.name).join(", ") || "No characters"} · {tags.join(", ")}</div>
            )}
          </Card>
          <Card>
            <SectionTitle title="Technical metadata" />
            <KeyVal k="File ID" v={<span className="font-mono text-xs">{asset.id}</span>} />
            <KeyVal k="Approval state" v={asset.approvalState} />
            {t.width && <KeyVal k="Dimensions" v={`${t.width}×${t.height}${t.aspectRatio ? ` (${t.aspectRatio})` : ""}`} />}
            {t.hasAlpha !== undefined && <KeyVal k="Transparency" v={t.hasAlpha ? "alpha channel" : "opaque"} />}
            {t.colourSpace && <KeyVal k="Colour space" v={t.colourSpace} />}
            {t.durationSeconds !== undefined && <KeyVal k="Duration" v={`${t.durationSeconds}s${t.fps ? ` · ${t.fps} fps` : ""}`} />}
            {t.videoCodec && <KeyVal k="Codecs" v={`${t.videoCodec}${t.audioCodec ? ` / ${t.audioCodec}` : ""}`} />}
            {t.pages && <KeyVal k="Pages" v={t.pages} />}
            {t.wordCount !== undefined && <KeyVal k="Words" v={t.wordCount} />}
            {Object.entries(t).filter(([k]) => ["meshes", "materials", "animations", "textures", "gltfVersion"].includes(k)).map(([k, v]) => <KeyVal key={k} k={k} v={String(v)} />)}
            {t.dominantColours && (
              <div className="mt-3 flex gap-1.5">{t.dominantColours.map((c) => <span key={c} title={c} className="h-6 flex-1 rounded" style={{ background: c }} />)}</div>
            )}
          </Card>
          <Card>
            <SectionTitle title="Versions" sub="New files are new versions – nothing is overwritten" />
            {versionUrls.map((v) => (
              <div key={v.id} className="flex items-center gap-3 border-b border-white/[0.05] py-2 last:border-0">
                {v.url && asset.mediaKind !== "document" ? <img src={v.url} alt="" className="size-10 rounded object-cover" /> : <span className="font-mono text-xs text-mist-500">v{v.version}</span>}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate text-mist-100">v{v.version} · {v.originalName}{v.id === asset.currentVersionId && <span className="ml-2 text-xs text-calm-300">current</span>}</div>
                  <div className="truncate font-mono text-[10px] text-mist-500">{(v.sizeBytes / 1024).toFixed(0)} KB · sha256 {v.sha256.slice(0, 16)}… · {timeAgo(v.createdAt)}</div>
                </div>
                {v.dl && <a href={v.dl} className="link text-xs">Download</a>}
              </div>
            ))}
            {can(viewer.role, "reference:upload") && <div className="mt-3"><NewVersion id={id} /></div>}
          </Card>
          <Card>
            <SectionTitle title="Used by generations" sub="Assets whose provenance cites the current version" />
            {usedBy.length ? usedBy.map((g) => <Link key={g.id} href={`/assets/${g.id}`} className="flex justify-between py-1 text-sm"><span className="truncate text-mist-100">{g.title}</span><Status value={g.status} /></Link>) : <p className="text-sm text-mist-400">Not used yet.</p>}
          </Card>
          <Card>
            <SectionTitle title="Audit trail" />
            {history.map((h) => <div key={h.id} className="py-1 text-xs text-mist-400"><span className="text-mist-200">{h.action}</span> · {timeAgo(h.createdAt)}</div>)}
            {can(viewer.role, "data:delete") && !asset.immutable && <div className="mt-3"><Action endpoint={`/api/references/${id}`} method="DELETE" variant="danger" size="sm" confirm="Delete this reference? It will be archived and hidden." redirectTo="/references">Delete</Action></div>}
          </Card>
        </div>
      </div>
    </div>
  );
}

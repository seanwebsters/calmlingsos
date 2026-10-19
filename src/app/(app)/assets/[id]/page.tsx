import Link from "next/link";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getAssetDetail } from "@/lib/review/assets";
import { Action } from "@/components/client/action";
import { LiveRefresh } from "@/components/client/live";
import { AnnotatableImage } from "@/components/review/annotate";
import { StructuredView } from "@/components/production/output";
import { Badge, Card, KeyVal, PageHeader, Placeholder, SectionTitle, Status } from "@/components/ui";
import { cn, timeAgo, titleCase, usd } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ with?: string; compare?: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const d = await getAssetDetail(viewer.orgId, id);
  const a = d.asset;
  const other = sp.with ? d.versions.find((v) => v.id === sp.with) : d.versions.length > 1 ? d.versions.find((v) => v.id === a.parentId) ?? d.versions.find((v) => v.id !== a.id) : null;
  const masterRef = d.references.find((r) => r.mediaKind === "image");
  const canApprove = can(viewer.role, "review:approve");
  const canComment = can(viewer.role, "review:comment");
  const report = a.consistencyReport as { overallScore?: number; identityDrift?: boolean; items?: { item: string; score: number; note: string }[]; summary?: string; provider?: string; qa?: { technical: { passed: boolean; checks: { name: string; passed: boolean; detail: string }[] }; creative: unknown; creativeNote: string } } | null;
  const media = (v: { kind: string; url: string | null; textContent: string | null }, big = false) =>
    v.kind === "image" && v.url ? <img src={v.url} alt="" className={cn("checker w-full rounded-xl object-contain", big ? "max-h-[72vh]" : "max-h-[46vh]")} />
    : v.kind === "video" && v.url ? <video src={v.url} controls className="w-full rounded-xl bg-black" />
    : v.kind === "audio" && v.url ? <audio src={v.url} controls className="w-full" />
    : v.textContent ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-paper-100 p-5 font-sans text-[13px] leading-relaxed text-ink-900">{v.textContent}</pre>
    : <Placeholder label={v.kind === "bundle" ? "ZIP bundle – download to inspect" : "No preview"} aspect="aspect-video" />;
  return (
    <div>
      {a.status === "changes_requested" && <LiveRefresh scope={`production:${a.productionId}`} />}
      <PageHeader
        eyebrow={`${titleCase(a.role)} · version ${a.version} of ${d.versions.length}${d.production ? ` · ${d.production.title}` : ""}`}
        title={a.title}
        actions={
          <>
            <Status value={a.status} />
            {a.locked && <Badge tone="calm">Locked version</Badge>}
            {d.production && <Link href={`/productions/${d.production.id}`} className="link text-sm">Production →</Link>}
          </>
        }
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {canApprove && <Action endpoint={`/api/assets/${id}/approve`} variant="ok" prompt="Approval note (optional):" promptField="comment">Approve</Action>}
        {canComment && <Action endpoint={`/api/assets/${id}/request_changes`} prompt="What needs to change?" promptField="comment">Request changes</Action>}
        {canApprove && <Action endpoint={`/api/assets/${id}/reject`} variant="danger" prompt="Why reject? (this teaches the system)" promptField="comment">Reject</Action>}
        {can(viewer.role, "production:run") && ["image", "video"].includes(a.kind) && !a.locked && <Action endpoint={`/api/assets/${id}/regenerate`} prompt="Regenerate with these notes:" promptField="comment">Regenerate version</Action>}
        {canApprove && <Action endpoint={`/api/assets/${id}/${a.locked ? "unlock" : "lock"}`} variant="ghost">{a.locked ? "Unlock version" : "Lock version"}</Action>}
        {can(viewer.role, "canon:approve") && ["image", "video"].includes(a.kind) && (a.status === "approved" || a.status === "published") && (a.promotedReferenceId ? <Link href={`/references/${a.promotedReferenceId}`} className="link self-center text-sm">In reference library →</Link> : <Action endpoint={`/api/assets/${id}/promote`} confirm="Promote to the reference library as an Approved Supporting reference?">Promote to reference library</Action>)}
        {can(viewer.role, "export:create") && (a.status === "approved" || a.status === "published") && <a href={`/api/assets/${id}/export`} className="inline-flex items-center rounded-lg border border-calm-300/30 bg-calm-400/10 px-3.5 py-2 text-sm text-calm-200 hover:bg-calm-400/20">Export with provenance</a>}
        {can(viewer.role, "export:create") && a.kind === "bundle" && <a href={`/api/assets/${id}/download`} className="inline-flex items-center rounded-lg bg-calm-400 px-3.5 py-2 text-sm font-medium text-ink-950">Download bundle</a>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {masterRef && a.kind === "image" ? (
            <Card>
              <SectionTitle title="Original reference vs generated output" sub="Human judgement decides identity – automated scores are advisory only" />
              <div className="grid gap-4 md:grid-cols-2">
                <div><div className="label mb-2">{masterRef.designation.replace(/_/g, " ")} · {masterRef.title} v{masterRef.version}</div>{masterRef.fullUrl && <img src={masterRef.fullUrl} alt="" className="checker max-h-[56vh] w-full rounded-xl object-contain" />}</div>
                <div><div className="label mb-2">Generated · v{a.version}</div>{d.url && <AnnotatableImage assetId={a.id} src={d.url} comments={d.comments.filter((c) => c.targetId === a.id)} canComment={canComment} />}</div>
              </div>
            </Card>
          ) : (
            <Card>{a.kind === "image" && d.url ? <AnnotatableImage assetId={a.id} src={d.url} comments={d.comments.filter((c) => c.targetId === a.id)} canComment={canComment} /> : media({ kind: a.kind, url: d.url, textContent: a.textContent }, true)}</Card>
          )}
          {other && (
            <Card>
              <SectionTitle title={`Compare versions: v${other.version} ↔ v${a.version}`} sub="Choose another version below to compare" />
              <div className="grid gap-4 md:grid-cols-2">
                <div><div className="mb-2 flex items-center gap-2"><span className="label">v{other.version}</span><Status value={other.status} /></div>{media(other)}<p className="mt-2 text-xs text-mist-500">{other.provenance.provider} / {other.provenance.model} · {timeAgo(other.createdAt)}</p></div>
                <div><div className="mb-2 flex items-center gap-2"><span className="label">v{a.version} (this)</span><Status value={a.status} /></div>{media({ kind: a.kind, url: d.url, textContent: a.textContent })}<p className="mt-2 text-xs text-mist-500">{String(a.provenance.parameters.notes ?? "")}</p></div>
              </div>
            </Card>
          )}
          <Card>
            <SectionTitle title="Lineage" sub="Every version of this deliverable" />
            <div className="flex gap-3 overflow-x-auto pb-2">
              {d.versions.map((v) => (
                <div key={v.id} className={cn("w-32 shrink-0 rounded-xl border p-2", v.id === a.id ? "border-calm-300/60" : "border-white/[0.06] hover:border-white/20")}>
                  <Link href={`/assets/${v.id}`} className="block">
                    {v.thumbUrl ? <img src={v.thumbUrl} alt="" className="aspect-square w-full rounded-lg object-cover" /> : <Placeholder label={`v${v.version}`} />}
                    <div className="mt-1 flex items-center justify-between text-[11px]"><span className="text-white">v{v.version}</span>{v.locked && <span className="text-calm-300">locked</span>}</div>
                    <Status value={v.status} className="mt-1" />
                  </Link>
                  {v.id !== a.id && <Link href={`/assets/${a.id}?with=${v.id}`} className="mt-1 block text-[11px] text-calm-300">compare</Link>}
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <SectionTitle title="Provenance" sub="Exact references and canon versions behind this output" />
            <KeyVal k="Provider / model" v={`${a.provenance.provider ?? "—"} / ${a.provenance.model ?? "—"}`} />
            <KeyVal k="Prompt version" v={a.provenance.promptVersion ?? "—"} />
            <KeyVal k="Generated" v={timeAgo(a.provenance.generatedAt)} />
            <KeyVal k="Cost (estimate)" v={usd(a.costCents)} />
            <KeyVal k="Parent" v={a.parentId ? <Link className="link" href={`/assets/${a.parentId}`}>previous version</Link> : "—"} />
            <div className="label mb-1 mt-4">Source references</div>
            {d.references.length ? d.references.map((r) => (
              <Link key={r.versionId} href={`/references/${r.assetId}`} className="flex items-center gap-2 py-1 text-sm">
                {r.url && <img src={r.url} alt="" className="size-8 rounded object-cover" />}
                <span className="flex-1 truncate text-mist-100">{r.title} <span className="text-mist-500">v{r.version}{r.current ? "" : " (older version)"}</span></span>
                <Status value={r.designation} />
              </Link>
            )) : <p className="text-sm text-mist-500">No reference images were used.</p>}
            <div className="label mb-1 mt-4">Canon versions</div>
            <div className="text-sm text-mist-300">{d.characterVersions.map((c) => `${c.name} profile v${c.version}`).join(", ") || "—"}</div>
            {d.canon.length > 0 && <div className="mt-1 text-xs text-mist-500">{d.canon.map((c) => `${c.title} v${c.version}`).join(" · ")}</div>}
            {a.provenance.prompt && (
              <details className="mt-4"><summary className="cursor-pointer text-xs text-calm-300">Prompt</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-ink-950 p-2 text-[11px] text-mist-400">{a.provenance.prompt}</pre></details>
            )}
            <details className="mt-2"><summary className="cursor-pointer text-xs text-calm-300">Parameters</summary><div className="mt-2 text-xs"><StructuredView value={a.provenance.parameters} /></div></details>
          </Card>
          {report?.items && (
            <Card>
              <SectionTitle title="Consistency check (advisory)" sub={`${report.provider ?? ""} · never proof of identity`} action={<Badge tone={report.identityDrift ? "bad" : "ok"}>{report.identityDrift ? "possible drift" : `${Math.round((report.overallScore ?? 0) * 100)}%`}</Badge>} />
              {report.items.map((i) => <div key={i.item} className="flex justify-between gap-3 border-b border-white/[0.04] py-1 text-sm last:border-0"><span className="text-mist-200">{i.item}</span><span className="text-right text-xs text-mist-400">{Math.round(i.score * 100)}% · {i.note}</span></div>)}
              {report.summary && <p className="mt-2 text-xs text-mist-400">{report.summary}</p>}
            </Card>
          )}
          {report?.qa && (
            <Card>
              <SectionTitle title="QA" action={<Badge tone={report.qa.technical.passed ? "ok" : "bad"}>{report.qa.technical.passed ? "technical pass" : "technical issues"}</Badge>} />
              {report.qa.technical.checks.map((c) => <div key={c.name} className="flex justify-between text-sm"><span className={c.passed ? "text-mist-200" : "text-bad"}>{c.passed ? "✓" : "✕"} {c.name}</span><span className="text-xs text-mist-400">{c.detail}</span></div>)}
              {report.qa.creativeNote && <p className="mt-2 text-xs text-warn">{report.qa.creativeNote}</p>}
              {!!report.qa.creative && <div className="mt-3 text-xs"><StructuredView value={report.qa.creative} /></div>}
            </Card>
          )}
          <Card>
            <SectionTitle title="Review history & comments" />
            {[...d.history.map((h) => ({ t: h.createdAt, el: <div key={h.id} className="text-sm"><span className="text-mist-100">{h.reviewer ?? "system"}</span> <span className="text-mist-400">{h.action.replace(/_/g, " ")}{h.toStatus ? ` → ${h.toStatus.replace(/_/g, " ")}` : ""}</span>{h.comment && <div className="text-xs text-mist-300">“{h.comment}”</div>}</div> })), ...d.comments.map((c, i) => ({ t: c.createdAt, el: <div key={c.id} className="text-sm"><span className="text-mist-100">{c.author ?? "—"}</span> <span className="text-mist-400">commented{c.annotation ? ` (region ${i + 1})` : ""} on v{d.versions.find((v) => v.id === c.targetId)?.version}</span><div className="text-xs text-mist-300">{c.body}</div></div> }))]
              .sort((x, y) => y.t.getTime() - x.t.getTime())
              .map((x, i) => <div key={i} className="border-b border-white/[0.04] py-2 last:border-0">{x.el}<div className="text-[10px] text-mist-600">{timeAgo(x.t)}</div></div>)}
            {!d.history.length && !d.comments.length && <p className="text-sm text-mist-400">No reviews yet.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

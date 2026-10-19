import type { Viewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { diffLines, getCanonRecord, listCanon } from "@/lib/brain/canon";
import { listCharacters } from "@/lib/brain/characters";
import { Action } from "@/components/client/action";
import { CanonForm } from "./canon-form";
import { Badge, Card, Empty, SectionTitle, Status } from "@/components/ui";
import { cn, timeAgo } from "@/lib/cn";

/** Canon records with DRAFT/AI-proposal review, comparison against official canon and approval. */
export async function CanonBoard({ viewer, domains, highlight }: { viewer: Viewer; domains: string[]; highlight?: string }) {
  const all = (await listCanon(viewer.orgId)).filter((r) => domains.includes(r.domain));
  const chars = await listCharacters(viewer.orgId);
  const name = (id: string) => chars.find((c) => c.id === id)?.name ?? id;
  const proposals = all.filter((r) => ["draft", "ai_proposal", "experimental"].includes(r.canonStatus));
  const official = all.filter((r) => r.canonStatus === "official");
  const canApprove = can(viewer.role, "canon:approve");
  const compare = await Promise.all(
    proposals.map(async (p) => {
      const { official: o } = await getCanonRecord(viewer.orgId, p.id);
      return { p, official: o && o.id !== p.id ? o : null, diff: o && o.id !== p.id ? diffLines(o.body, p.body) : null };
    }),
  );
  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle title="Draft canon awaiting a decision" sub="AI proposals and drafts never become canon on their own – only an authorised human can approve them." action={can(viewer.role, "canon:edit") && <CanonForm domains={domains} characters={chars.map((c) => ({ id: c.id, name: c.name }))} />} />
        {compare.length === 0 ? <p className="text-sm text-mist-400">Nothing pending.</p> : (
          <div className="space-y-3">
            {compare.map(({ p, official: o, diff }) => (
              <div key={p.id} id={p.id} className={cn("rounded-xl border p-4", highlight === p.id ? "border-calm-300/50" : "border-white/[0.06]", p.canonStatus === "ai_proposal" ? "bg-violet/[0.04]" : "bg-ink-900/60")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="violet">DRAFT CANON</Badge>
                  <Status value={p.canonStatus} />
                  <span className="text-white">{p.title}</span>
                  <span className="text-xs text-mist-500">{p.domain} · {p.kind.replace(/_/g, " ")} · v{p.version} · {timeAgo(p.createdAt)}</span>
                </div>
                {p.characterIds.length > 0 && <div className="mt-1 text-xs text-mist-400">Characters: {p.characterIds.map(name).join(", ")}</div>}
                {diff ? (
                  <div className="mt-3 rounded-lg bg-ink-950/70 p-3 font-mono text-xs">
                    <div className="mb-1 font-sans text-[11px] text-mist-500">Compared with official v{o!.version}</div>
                    {diff.map((l, i) => <div key={i} className={l.type === "added" ? "text-ok" : l.type === "removed" ? "text-bad line-through" : "text-mist-400"}>{l.type === "added" ? "+ " : l.type === "removed" ? "− " : "  "}{l.text}</div>)}
                  </div>
                ) : <p className="mt-2 whitespace-pre-wrap text-sm text-mist-200">{p.body}</p>}
                {canApprove && (
                  <div className="mt-3 flex gap-2">
                    <Action endpoint={`/api/canon/${p.id}/approve`} variant="ok" size="sm" confirm={`Make “${p.title}” official canon${o ? ` (superseding v${o.version})` : ""}?`}>Approve as canon</Action>
                    <Action endpoint={`/api/canon/${p.id}/reject`} variant="danger" size="sm" prompt="Why reject?" promptField="note">Reject</Action>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <SectionTitle title="Official canon" sub="Retrieved by every agent before work" />
        {official.length === 0 ? <Empty title="No official records yet">Write canon from your uploaded brand guidelines and lore – then approve it.</Empty> : (
          <div className="grid gap-3 md:grid-cols-2">
            {official.map((r) => (
              <div key={r.id} id={r.id} className={cn("rounded-xl border p-4", highlight === r.id ? "border-calm-300/50" : "border-white/[0.06] bg-ink-900/60")}>
                <div className="flex items-center justify-between gap-2"><span className="text-white">{r.title}</span><span className="text-xs text-mist-500">{r.domain} · {r.kind.replace(/_/g, " ")} · v{r.version}</span></div>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-mist-300">{r.body}</p>
                {can(viewer.role, "canon:edit") && <div className="mt-2"><CanonForm domains={domains} characters={chars.map((c) => ({ id: c.id, name: c.name }))} reviseId={r.id} initial={{ domain: r.domain, kind: r.kind, title: r.title, body: r.body, characterIds: r.characterIds, timelineOrder: r.timelineOrder }} /></div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

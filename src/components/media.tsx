import Link from "next/link";
import { FileText, Music2, Video } from "lucide-react";
import { Badge, Placeholder, Status } from "@/components/ui";
import { cn } from "@/lib/cn";

export function RefTile({ r }: { r: { id: string; title: string; designation: string; mediaKind: string; thumbUrl: string | null; viewAngle?: string | null; analysisStatus?: string; characters?: { id: string; name: string }[] } }) {
  return (
    <Link href={`/references/${r.id}`} className="group overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/70 transition hover:border-calm-300/25">
      <div className="checker relative aspect-square">
        {r.thumbUrl ? <img src={r.thumbUrl} alt={r.title} className="absolute inset-0 size-full object-contain" loading="lazy" /> : <MediaIcon kind={r.mediaKind} />}
        {r.mediaKind === "video" && <Video className="absolute right-2 top-2 size-4 text-white drop-shadow" />}
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="truncate text-[13px] text-white">{r.title}</div>
        <div className="flex flex-wrap gap-1">
          <Status value={r.designation} />
          {r.viewAngle && <Badge>{r.viewAngle.replace(/_/g, " ")}</Badge>}
        </div>
        {r.characters && r.characters.length > 0 && <div className="truncate text-[11px] text-mist-500">{r.characters.map((c) => c.name).join(", ")}</div>}
      </div>
    </Link>
  );
}

export function MediaIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = kind === "video" ? Video : kind === "audio" ? Music2 : FileText;
  return (
    <div className={cn("absolute inset-0 flex items-center justify-center bg-ink-850", className)}>
      <Icon className="size-8 text-mist-500" />
    </div>
  );
}

export function GenTile({ a }: { a: { id: string; title: string; kind: string; status: string; version: number; thumbUrl: string | null; consistencyScore?: number | null; locked?: boolean } }) {
  return (
    <Link href={`/assets/${a.id}`} className="group overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/70 transition hover:border-calm-300/25">
      <div className="checker relative aspect-square">
        {a.thumbUrl ? <img src={a.thumbUrl} alt={a.title} className="absolute inset-0 size-full object-cover" loading="lazy" /> : <MediaIcon kind={a.kind} />}
        <span className="absolute left-2 top-2 rounded bg-ink-950/80 px-1.5 text-[10px] text-mist-200">v{a.version}</span>
        {a.locked && <span className="absolute right-2 top-2 rounded bg-calm-400/90 px-1.5 text-[10px] font-semibold text-ink-950">LOCKED</span>}
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="truncate text-[13px] text-white">{a.title}</div>
        <div className="flex flex-wrap items-center gap-1">
          <Status value={a.status} />
          {typeof a.consistencyScore === "number" && <Badge tone={a.consistencyScore >= 0.75 ? "ok" : "warn"}>{Math.round(a.consistencyScore * 100)}% advisory</Badge>}
        </div>
      </div>
    </Link>
  );
}

export { Placeholder };

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { api } from "@/components/client/api";
import { Action, ErrorNote } from "@/components/client/action";
import { cn } from "@/lib/cn";

interface Media {
  id: string;
  thumbUrl: string | null;
  url: string | null;
  status: string;
  version: number;
  locked: boolean;
  consistencyScore: number | null;
}
interface Shot {
  id: string;
  index: number;
  description: string;
  camera: string;
  action: string;
  dialogue: string;
  durationSeconds: number;
  locked: boolean;
  continuity: string;
  frame: Media | null;
  video: Media | null;
  voice: Media | null;
  frameVersions: number;
}

export function ShotRow({ shot, canEdit, canApprove }: { shot: Shot; canEdit: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [s, setS] = useState({ description: shot.description, dialogue: shot.dialogue, camera: shot.camera, action: shot.action, durationSeconds: shot.durationSeconds });
  const [error, setError] = useState<Error | null>(null);
  return (
    <div className={cn("grid gap-3 rounded-xl border p-3 md:grid-cols-[120px_120px_1fr]", shot.locked ? "border-calm-300/40 bg-calm-400/[0.05]" : "border-white/[0.06] bg-ink-900/60")}>
      <MediaCell label="Frame" m={shot.frame} />
      <MediaCell label="Clip" m={shot.video} video />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-mist-500">SHOT {shot.index}</span>
          <span className="text-xs text-mist-400">{shot.durationSeconds}s · {shot.camera}</span>
          {shot.locked && <span className="inline-flex items-center gap-1 text-[11px] text-calm-300"><Lock className="size-3" />locked – kept on regeneration</span>}
          {shot.frame?.consistencyScore != null && <span className="text-[11px] text-mist-400">consistency {Math.round(shot.frame.consistencyScore * 100)}% (advisory)</span>}
        </div>
        {edit ? (
          <div className="mt-2 space-y-2">
            <textarea value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} rows={2} className="field text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <input value={s.camera} onChange={(e) => setS({ ...s, camera: e.target.value })} className="field text-xs" placeholder="Camera" />
              <input type="number" value={s.durationSeconds} onChange={(e) => setS({ ...s, durationSeconds: Number(e.target.value) })} className="field text-xs" />
            </div>
            <input value={s.action} onChange={(e) => setS({ ...s, action: e.target.value })} className="field text-xs" placeholder="Action" />
            <input value={s.dialogue} onChange={(e) => setS({ ...s, dialogue: e.target.value })} className="field text-xs" placeholder="Dialogue" />
            <div className="flex gap-2">
              <button onClick={async () => { try { await api(`/api/shots/${shot.id}`, { method: "PATCH", body: s }); setEdit(false); router.refresh(); } catch (e) { setError(e as Error); } }} className="rounded-md bg-calm-400 px-2.5 py-1 text-xs font-medium text-ink-950">Save shot</button>
              <button onClick={() => setEdit(false)} className="text-xs text-mist-400">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-mist-100">{shot.description}</p>
            <p className="text-xs text-mist-400">{shot.action}</p>
            {shot.dialogue && <p className="mt-1 text-sm italic text-paper-200">“{shot.dialogue}”</p>}
          </>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {canEdit && !edit && <button onClick={() => setEdit(true)} className="rounded-md border border-white/10 px-2 py-0.5 text-xs text-mist-200">Edit shot</button>}
          {canApprove && (
            <button onClick={async () => { try { await api(`/api/shots/${shot.id}`, { method: "PATCH", body: { locked: !shot.locked } }); router.refresh(); } catch (e) { setError(e as Error); } }} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-xs text-mist-200">
              {shot.locked ? <Unlock className="size-3" /> : <Lock className="size-3" />}
              {shot.locked ? "Unlock shot" : "Lock approved shot"}
            </button>
          )}
          {shot.frame && !shot.locked && !shot.frame.locked && <Action endpoint={`/api/assets/${shot.frame.id}/regenerate`} size="sm" prompt="What should change in this frame?" promptField="comment">Regenerate frame</Action>}
          {shot.video && !shot.locked && !shot.video.locked && <Action endpoint={`/api/assets/${shot.video.id}/regenerate`} size="sm" prompt="What should change in this clip?" promptField="comment">Regenerate clip</Action>}
          {shot.frameVersions > 1 && shot.frame && <Link href={`/assets/${shot.frame.id}?compare=1`} className="rounded-md px-2 py-0.5 text-xs text-calm-300">Compare {shot.frameVersions} versions</Link>}
        </div>
        <ErrorNote error={error} />
      </div>
    </div>
  );
}

function MediaCell({ label, m, video }: { label: string; m: Media | null; video?: boolean }) {
  if (!m) return <div className="flex aspect-[9/16] max-h-40 items-center justify-center rounded-lg border border-dashed border-white/10 text-[10px] uppercase tracking-wider text-mist-600">{label} pending</div>;
  return (
    <Link href={`/assets/${m.id}`} className="relative block overflow-hidden rounded-lg bg-ink-950">
      {video && m.url ? <video src={m.url} muted loop playsInline className="aspect-[9/16] max-h-40 w-full object-cover" onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} /> : m.thumbUrl ? <img src={m.thumbUrl} alt={label} className="aspect-[9/16] max-h-40 w-full object-cover" /> : null}
      <span className="absolute left-1 top-1 rounded bg-ink-950/80 px-1 text-[9px] text-mist-200">{label} v{m.version}</span>
      <span className={cn("absolute bottom-1 left-1 rounded px-1 text-[9px]", m.status === "approved" || m.status === "published" ? "bg-ok/80 text-ink-950" : "bg-ink-950/80 text-mist-300")}>{m.status.replace(/_/g, " ")}</span>
    </Link>
  );
}

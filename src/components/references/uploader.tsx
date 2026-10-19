"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/cn";

const TYPES = [
  ["", "Detect automatically"], ["character_render", "Official character render"], ["turnaround", "Turnaround"], ["expression_sheet", "Expression sheet"], ["animation_clip", "Animation clip"], ["social_video", "Existing social video"], ["storyboard", "Storyboard"], ["game_screenshot", "Game screenshot"], ["game_sprite", "Game sprite"], ["background_environment", "Background / environment"], ["brand_guidelines", "Brand guidelines"], ["script", "Script"], ["character_description", "Character description"], ["product_mockup", "Product mockup"], ["logo", "Logo"], ["music_reference", "Music reference"], ["voice_recording", "Voice recording"], ["model_3d", "3D model"],
];
const ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,.gif,.mp4,.mov,.m4v,.mp3,.wav,.pdf,.docx,.txt,.md,.json,.zip,.glb,.gltf,.csv";

export function Uploader({ characters, canClassify, defaultCharacter, maxMb }: { characters: { id: string; name: string }[]; canClassify: boolean; defaultCharacter?: string; maxMb: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ created: { id: string; title: string }[]; rejected: { name: string; reason: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState({ characterIds: defaultCharacter ? [defaultCharacter] : ([] as string[]), assetType: "", designation: "unclassified", viewAngle: "", rightsStatus: "owned", source: "upload", tags: "", notes: "", voiceConsent: false });

  const add = (list: FileList | null) => list && setFiles((f) => [...f, ...Array.from(list)]);

  function upload() {
    setBusy(true);
    setError(null);
    setResult(null);
    const form = new FormData();
    for (const f of files) form.append("files", f);
    form.set("meta", JSON.stringify({ ...meta, assetType: meta.assetType || undefined, viewAngle: meta.viewAngle || null, tags: meta.tags.split(",").map((t) => t.trim()).filter(Boolean) }));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/references");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    xhr.onload = () => {
      setBusy(false);
      const json = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 400) setError(json.error ?? `Upload failed (${xhr.status})`);
      else {
        setResult(json);
        setFiles([]);
        router.refresh();
      }
    };
    xhr.onerror = () => {
      setBusy(false);
      setError("Network error during upload.");
    };
    xhr.send(form);
  }

  const total = files.reduce((n, f) => n + f.size, 0);
  return (
    <div className="panel p-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={cn("flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition", over ? "border-calm-300 bg-calm-400/[0.06]" : "border-white/10 hover:border-white/20")}
      >
        <UploadCloud className="size-8 text-calm-300" />
        <div className="mt-2 font-display text-lg text-white">Drop official material here</div>
        <div className="mt-1 text-sm text-mist-400">Images, video, audio, PDFs, DOCX, text, JSON, GLB/GLTF – or a ZIP collection. Up to {maxMb} MB per file. Contents are verified, not just extensions.</div>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => add(e.target.files)} />
      </div>
      {files.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-sm"><span className="text-mist-200">{files.length} file(s) · {(total / 1e6).toFixed(1)} MB</span><button onClick={() => setFiles([])} className="text-xs text-mist-400">Clear</button></div>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-mist-200">
                {f.name}
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-3" /></button>
              </span>
            ))}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="md:col-span-2"><span className="label mb-1 block">Characters in these files</span>
              <div className="flex flex-wrap gap-1.5">
                {characters.map((c) => {
                  const on = meta.characterIds.includes(c.id);
                  return <button key={c.id} type="button" onClick={() => setMeta({ ...meta, characterIds: on ? meta.characterIds.filter((x) => x !== c.id) : [...meta.characterIds, c.id] })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-calm-300/50 bg-calm-400/15 text-white" : "border-white/10 text-mist-400")}>{c.name}</button>;
                })}
                {!characters.length && <span className="text-xs text-mist-500">Create characters first to link files to them.</span>}
              </div>
            </label>
            <label><span className="label mb-1 block">Asset type</span><select value={meta.assetType} onChange={(e) => setMeta({ ...meta, assetType: e.target.value })} className="field">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label><span className="label mb-1 block">View</span><select value={meta.viewAngle} onChange={(e) => setMeta({ ...meta, viewAngle: e.target.value })} className="field"><option value="">—</option>{["front", "side", "rear", "three_quarter", "face_closeup", "expression", "pose", "accessory", "environment_interaction"].map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</select></label>
            <label><span className="label mb-1 block">Designation</span>
              <select value={meta.designation} onChange={(e) => setMeta({ ...meta, designation: e.target.value })} className="field">
                <option value="unclassified">Unclassified (review later)</option>
                {canClassify && <option value="official_master">OFFICIAL MASTER REFERENCE</option>}
                {canClassify && <option value="approved_supporting">APPROVED SUPPORTING REFERENCE</option>}
                <option value="style_inspiration">STYLE INSPIRATION ONLY</option>
                <option value="experimental">EXPERIMENTAL</option>
                <option value="rejected">REJECTED</option>
                <option value="archived">ARCHIVED</option>
              </select>
            </label>
            <label><span className="label mb-1 block">Rights / usage</span><select value={meta.rightsStatus} onChange={(e) => setMeta({ ...meta, rightsStatus: e.target.value })} className="field"><option value="owned">Owned</option><option value="licensed">Licensed</option><option value="restricted">Restricted</option><option value="unknown">Unknown</option></select></label>
            <label><span className="label mb-1 block">Source</span><input value={meta.source} onChange={(e) => setMeta({ ...meta, source: e.target.value })} className="field" /></label>
            <label><span className="label mb-1 block">Tags (comma separated)</span><input value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} className="field" /></label>
            <label className="md:col-span-3"><span className="label mb-1 block">Notes</span><input value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} className="field" /></label>
            {meta.assetType === "voice_recording" && (
              <label className="flex items-center gap-2 text-sm text-mist-200 md:col-span-4"><input type="checkbox" checked={meta.voiceConsent} onChange={(e) => setMeta({ ...meta, voiceConsent: e.target.checked })} className="accent-calm-400" />I confirm documented consent/licence from the voice owner for this recording (required for any voice synthesis).</label>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button disabled={busy} onClick={upload} className="inline-flex items-center gap-2 rounded-lg bg-calm-400 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-calm-300 disabled:opacity-50">{busy && <Loader2 className="size-4 animate-spin" />}Upload {files.length}</button>
            {busy && <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full bg-calm-300" style={{ width: `${progress * 100}%` }} /></div>}
          </div>
        </div>
      )}
      {error && <div className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
      {result && (
        <div className="mt-3 text-sm">
          <div className="text-ok">Uploaded {result.created.length} file(s). Technical metadata extracted; AI analysis queued (if a vision provider is approved for proprietary references).</div>
          {result.rejected.map((r) => <div key={r.name} className="text-bad">✕ {r.name}: {r.reason}</div>)}
        </div>
      )}
    </div>
  );
}

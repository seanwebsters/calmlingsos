"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { cn } from "@/lib/cn";

type F = { name: string; label: string; type: "text" | "textarea" | "number" | "bool" | "select"; options?: [string, string][]; def?: string | number | boolean; hint?: string; wide?: boolean };

export const BRIEF_FIELDS: Record<string, F[]> = {
  social: [
    { name: "theme", label: "Content theme", type: "textarea", wide: true, def: "" },
    { name: "emotionalMessage", label: "Emotional message", type: "text", def: "" },
    { name: "platform", label: "Platform", type: "select", options: [["tiktok", "TikTok"], ["instagram_reels", "Instagram Reels"], ["youtube_shorts", "YouTube Shorts"], ["youtube", "YouTube"], ["square", "Square feed"]], def: "tiktok" },
    { name: "format", label: "Format", type: "text", def: "character comedy sketch" },
    { name: "durationSeconds", label: "Duration (s)", type: "number", def: 20 },
    { name: "visualStyle", label: "Visual style", type: "text", def: "as per approved references" },
    { name: "conceptCount", label: "Concepts to generate", type: "number", def: 10, hint: "Bulk mode: e.g. 30" },
    { name: "produceCount", label: "Concepts to produce", type: "number", def: 2, hint: "You select up to this many" },
    { name: "includeVideo", label: "Generate shot video (image-to-video)", type: "bool", def: true },
    { name: "includeVoice", label: "Voice lines (approved voices only)", type: "bool", def: false },
    { name: "includeMusic", label: "Music bed", type: "bool", def: false },
    { name: "burnCaptions", label: "Burn in captions", type: "bool", def: true },
    { name: "notes", label: "Notes", type: "textarea", wide: true, def: "" },
  ],
  game: [
    { name: "request", label: "What do you need?", type: "textarea", wide: true, def: "" },
    { name: "count", label: "Number of assets", type: "number", def: 4 },
    { name: "category", label: "Asset category", type: "select", options: [["collectible", "Collectible"], ["emote", "Emote"], ["expression", "Expression"], ["outfit", "Outfit"], ["prop", "Prop"], ["garden_object", "Garden object"], ["background", "Background"], ["environment", "Environmental asset"], ["ui_icon", "UI icon"], ["button", "Button"], ["badge", "Badge"], ["reward", "Reward graphic"], ["loading_screen", "Loading screen"], ["promo_art", "Promotional artwork"], ["character_concept", "Character concept"]], def: "collectible" },
    { name: "targetEngine", label: "Target engine", type: "select", options: [["Unity", "Unity"], ["Unreal", "Unreal"], ["Godot", "Godot"], ["Other", "Other"]], def: "Unity" },
    { name: "width", label: "Width (px)", type: "number", def: 512 },
    { name: "height", label: "Height (px)", type: "number", def: 512 },
    { name: "transparency", label: "Transparent background", type: "bool", def: true },
    { name: "fileFormat", label: "File format", type: "select", options: [["png", "PNG"], ["webp", "WebP"], ["jpeg", "JPEG"]], def: "png" },
    { name: "frames", label: "Animation frames", type: "number", def: 1, hint: ">1 builds a sprite sheet" },
    { name: "fps", label: "FPS", type: "number", def: 12 },
    { name: "namingPattern", label: "Naming convention", type: "text", def: "cal_{category}_{name}_{width}x{height}" },
    { name: "targetPlatform", label: "Target platform", type: "select", options: [["mobile", "Mobile"], ["desktop", "Desktop"], ["web", "Web"], ["console", "Console"]], def: "mobile" },
    { name: "maxFileKb", label: "Max file size (KB)", type: "number", def: 512 },
    { name: "collection", label: "Collection", type: "text", def: "Unsorted" },
  ],
  product: [
    { name: "request", label: "Product brief", type: "textarea", wide: true, def: "" },
    { name: "category", label: "Category", type: "select", options: [["plush", "Plush toys"], ["figurine", "Figurines"], ["blind_box", "Blind boxes"], ["collectible_toy", "Collectible toys"], ["trading_cards", "Trading cards"], ["apparel", "Apparel"], ["accessories", "Accessories"], ["stationery", "Stationery"], ["homeware", "Homeware"], ["wellness", "Wellness products"], ["gift_set", "Gift sets"], ["limited_edition", "Limited editions"]], def: "plush" },
    { name: "count", label: "Number of concepts", type: "number", def: 4 },
    { name: "rangeName", label: "Range name", type: "text", def: "" },
    { name: "targetAudience", label: "Target audience", type: "text", def: "" },
    { name: "pricePoint", label: "Price point", type: "text", def: "" },
  ],
  character: [
    { name: "request", label: "Describe the new character you want (based on your references)", type: "textarea", wide: true, def: "" },
    { name: "explorations", label: "Design explorations", type: "number", def: 3 },
  ],
  text: [
    { name: "request", label: "Brief", type: "textarea", wide: true, def: "" },
    { name: "count", label: "How many ideas / concepts", type: "number", def: 5 },
    { name: "partner", label: "Partner / brand (optional – never contacted)", type: "text", def: "" },
    { name: "notes", label: "Notes", type: "textarea", wide: true, def: "" },
  ],
  animation: [
    { name: "request", label: "What should we animate?", type: "textarea", wide: true, def: "" },
    { name: "kind", label: "Kind", type: "select", options: [["expression_sheet", "Expression sheet"], ["pose_board", "Pose board"], ["idle_loop", "Idle loop"], ["reaction", "Emotional reaction"], ["dance", "Dance"], ["physical_comedy", "Physical comedy"], ["environment_interaction", "Environment interaction"], ["game_animation_concept", "Game animation concept"]], def: "expression_sheet" },
    { name: "count", label: "Frames / poses", type: "number", def: 6 },
    { name: "aspect", label: "Aspect", type: "select", options: [["1:1", "1:1"], ["9:16", "9:16"], ["16:9", "16:9"]], def: "1:1" },
    { name: "makeClips", label: "Generate concept clips (video, not rigged)", type: "bool", def: false },
  ],
};

export function BriefForm({ templateKey, templateName, briefSchema, characters, references, defaultBudgetCents }: { templateKey: string; templateName: string; briefSchema: string; characters: { id: string; name: string; approved: boolean }[]; references?: { id: string; title: string }[]; defaultBudgetCents: number }) {
  const router = useRouter();
  const fields = BRIEF_FIELDS[briefSchema] ?? BRIEF_FIELDS.text;
  const [vals, setVals] = useState<Record<string, unknown>>(Object.fromEntries(fields.map((f) => [f.name, f.def])));
  const [title, setTitle] = useState("");
  const [cast, setCast] = useState<string[]>([]);
  const [budget, setBudget] = useState((defaultBudgetCents / 100).toFixed(2));
  const [due, setDue] = useState("");
  const [inspo, setInspo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const brief = { ...vals, ...(briefSchema === "character" ? { inspirationReferenceIds: inspo } : {}) };
          const { id } = await api<{ id: string }>("/api/productions", { body: { templateKey, title: title || `${templateName}: ${String(vals.theme ?? vals.request ?? "").slice(0, 60)}`, brief, characterIds: cast, budgetCents: Math.round(Number(budget) * 100), dueDate: due || null } });
          router.push(`/productions/${id}`);
        } catch (err) {
          setError(err as Error);
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <label className="md:col-span-2"><span className="label mb-1 block">Production title</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" className="field" /></label>
        <label><span className="label mb-1 block">Due date</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="field" /></label>
      </div>
      {briefSchema !== "character" && (
        <div>
          <span className="label mb-1.5 block">Characters (approved canon only is used)</span>
          <div className="flex flex-wrap gap-1.5">
            {characters.map((c) => {
              const on = cast.includes(c.id);
              return <button type="button" key={c.id} onClick={() => setCast(on ? cast.filter((x) => x !== c.id) : [...cast, c.id])} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-calm-300/50 bg-calm-400/15 text-white" : "border-white/10 text-mist-400 hover:text-white", !c.approved && "opacity-60")}>{c.name}{!c.approved && " · no canon"}</button>;
            })}
            {!characters.length && <span className="text-xs text-mist-500">No characters yet.</span>}
          </div>
        </div>
      )}
      {briefSchema === "character" && references && (
        <div>
          <span className="label mb-1.5 block">Reference / inspiration (style only – identities are never copied)</span>
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {references.map((r) => {
              const on = inspo.includes(r.id);
              return <button type="button" key={r.id} onClick={() => setInspo(on ? inspo.filter((x) => x !== r.id) : [...inspo, r.id])} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-calm-300/50 bg-calm-400/15 text-white" : "border-white/10 text-mist-400")}>{r.title}</button>;
            })}
          </div>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {fields.map((f) => (
          <label key={f.name} className={cn("block", f.wide && "md:col-span-3", f.type === "bool" && "flex items-center gap-2 pt-5")}>
            {f.type === "bool" ? (
              <>
                <input type="checkbox" checked={Boolean(vals[f.name])} onChange={(e) => setVals({ ...vals, [f.name]: e.target.checked })} className="accent-calm-400" />
                <span className="text-sm text-mist-200">{f.label}</span>
              </>
            ) : (
              <>
                <span className="label mb-1 block">{f.label}</span>
                {f.type === "textarea" ? <textarea required={f.name === "theme" || f.name === "request"} value={String(vals[f.name] ?? "")} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} rows={2} className="field" />
                  : f.type === "select" ? <select value={String(vals[f.name])} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} className="field">{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : <input type={f.type === "number" ? "number" : "text"} value={String(vals[f.name] ?? "")} onChange={(e) => setVals({ ...vals, [f.name]: f.type === "number" ? Number(e.target.value) : e.target.value })} className="field" />}
                {f.hint && <span className="mt-0.5 block text-[11px] text-mist-500">{f.hint}</span>}
              </>
            )}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label><span className="label mb-1 block">Production budget (USD)</span><input value={budget} onChange={(e) => setBudget(e.target.value)} className="field w-32" /></label>
        <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-calm-400 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-calm-300 disabled:opacity-50">{busy && <Loader2 className="size-4 animate-spin" />}Create plan</button>
        <span className="pb-2 text-xs text-mist-500">You'll review and approve the execution plan before anything is generated.</span>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

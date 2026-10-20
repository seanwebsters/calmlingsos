"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { cn } from "@/lib/cn";
import {
  OFFICE_THEMES,
  SKIN_PARTS,
  SKIN_PART_LABELS,
  type OfficeSkinView,
  type SkinPart,
} from "./themes";

const IDEAS = [
  "Light oak floors, white terrazzo, eucalyptus forest outside",
  "Japanese minimal studio, pale tatami, Kyoto rooftops at dawn",
  "Cosy treehouse loft, warm timber, misty rainforest canopy",
  "Soft pastel clouds, lilac carpet, dreamy sunset sky",
  "Sydney harbour view, polished concrete, sandstone rugs",
];

/** Theme presets plus the Nano Banana reskin form, shown over the 3D office. */
export function SkinPanel({
  skin,
  onChange,
  onClose,
}: {
  skin: OfficeSkinView;
  onChange: (s: OfficeSkinView) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(skin.prompt ?? "");
  const [parts, setParts] = useState<SkinPart[]>([...SKIN_PARTS]);
  const [reference, setReference] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(
    label: string,
    fn: () => Promise<{
      skin: OfficeSkinView;
      costCents?: number;
      failed?: string[];
    }>,
  ) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      const res = await fn();
      onChange(res.skin);
      if (res.costCents !== undefined)
        setNote(
          `Done – ${(res.costCents / 100).toFixed(2)} USD.${res.failed?.length ? ` Some parts failed: ${res.failed.join("; ")}` : ""}`,
        );
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(null);
    }
  }

  const setTheme = (theme: string) => {
    onChange({ ...skin, theme });
    void run("theme", () =>
      api("/api/office/skin", { body: { action: "theme", theme } }),
    );
  };

  const reskin = () => {
    const form = new FormData();
    form.set("prompt", prompt);
    form.set("parts", parts.join(","));
    form.set("theme", skin.theme);
    if (reference) form.set("reference", reference);
    void run("reskin", () => api("/api/office/skin", { form }));
  };

  const hasTextures = Boolean(skin.floorUrl || skin.wallUrl || skin.rugUrl);
  return (
    <div className="absolute inset-y-4 right-4 z-30 w-[340px] max-w-[calc(100%-2rem)] overflow-y-auto rounded-2xl border border-white/10 bg-ink-900/95 text-sm shadow-card backdrop-blur">
      <div className="flex flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg text-white">
            Customise the office
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-mist-400 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="label mb-2">Look</div>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(OFFICE_THEMES).map((t) => (
            <button
              key={t.key}
              onClick={() => setTheme(t.key)}
              disabled={Boolean(busy)}
              className={cn(
                "overflow-hidden rounded-xl border text-left transition",
                skin.theme === t.key
                  ? "border-calm-300/70 ring-2 ring-calm-400/30"
                  : "border-white/10 hover:border-white/25",
              )}
            >
              <div
                className="h-10"
                style={{
                  background: `linear-gradient(180deg, ${t.sky[0]}, ${t.sky[1]} 55%, ${t.floor} 56%)`,
                }}
              />
              <div className="px-2 py-1.5 text-xs text-mist-100">{t.label}</div>
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-calm-300" />
          <div className="label">Reskin with Nano Banana</div>
        </div>
        <p className="mt-1 text-xs text-mist-400">
          Describe a style and Nano Banana paints new textures for the office.
          It only paints surfaces and the window view, never characters.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="e.g. Light oak floors, white terrazzo, eucalyptus forest outside"
          className="field mt-2 resize-none"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {IDEAS.map((i) => (
            <button
              key={i}
              onClick={() => setPrompt(i)}
              className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-mist-400 hover:border-calm-300/30 hover:text-white"
            >
              {i.split(",")[0]}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SKIN_PARTS.map((p) => {
            const on = parts.includes(p);
            return (
              <button
                key={p}
                onClick={() =>
                  setParts(on ? parts.filter((x) => x !== p) : [...parts, p])
                }
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs",
                  on
                    ? "border-calm-300/50 bg-calm-400/15 text-white"
                    : "border-white/10 text-mist-400 hover:text-white",
                )}
              >
                {SKIN_PART_LABELS[p]}
              </button>
            );
          })}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => setReference(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={() =>
            reference ? setReference(null) : fileRef.current?.click()
          }
          className="mt-3 inline-flex items-center gap-1.5 self-start text-xs text-mist-300 hover:text-white"
        >
          <ImagePlus className="size-3.5" />
          {reference
            ? `Style image: ${reference.name} (remove)`
            : "Add a style image (optional)"}
        </button>
        <button
          onClick={reskin}
          disabled={Boolean(busy) || prompt.trim().length < 3 || !parts.length}
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-calm-400 px-4 py-2 font-medium text-ink-950 hover:bg-calm-300 disabled:opacity-40"
        >
          {busy === "reskin" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {busy === "reskin"
            ? "Nano Banana is painting…"
            : `Reskin ${parts.length} part${parts.length === 1 ? "" : "s"}`}
        </button>
        <div className="mt-1.5 text-[11px] text-mist-500">
          ≈ $0.04 per texture · uses your Google Gemini or fal.ai key
        </div>
        {note && (
          <div className="mt-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok">
            {note}
          </div>
        )}
        <ErrorNote error={error} />

        {hasTextures && (
          <div className="mt-5 border-t border-white/10 pt-3 text-xs text-mist-400">
            <div>
              Current skin:{" "}
              <span className="text-mist-200">“{skin.prompt}”</span>
            </div>
            {skin.model && <div className="mt-0.5">{skin.model}</div>}
            <button
              onClick={() =>
                void run("reset", () =>
                  api("/api/office/skin", { body: { action: "reset" } }),
                )
              }
              disabled={Boolean(busy)}
              className="mt-2 text-bad hover:underline"
            >
              Remove generated textures
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

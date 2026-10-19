/**
 * Provider-neutral game export adapters. Each exporter turns validated
 * assets into a package an engine pipeline can ingest. New engines plug in
 * here without touching the studio.
 */
export interface ExportItem {
  name: string;
  data: Buffer;
  width: number;
  height: number;
  frames?: { x: number; y: number; w: number; h: number }[];
}

export interface GameExporter {
  key: string;
  name: string;
  available: boolean;
  build?(items: ExportItem[]): Record<string, Buffer | string>;
}

/** TexturePacker-style JSON hash – readable by Phaser, PixiJS and common Unity/Godot importers. */
function atlasJson(items: ExportItem[]) {
  const frames: Record<string, unknown> = {};
  for (const it of items) {
    const fs = it.frames?.length ? it.frames : [{ x: 0, y: 0, w: it.width, h: it.height }];
    fs.forEach((f, i) => {
      frames[fs.length > 1 ? `${it.name.replace(/\.[^.]+$/, "")}_${i}` : it.name] = { frame: f, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h }, image: it.name };
    });
  }
  return JSON.stringify({ frames, meta: { app: "CALMLINGS OS", version: "1", format: "RGBA8888", scale: "1" } }, null, 2);
}

export const GAME_EXPORTERS: GameExporter[] = [
  { key: "generic", name: "Generic ZIP + atlas JSON", available: true, build: (items) => ({ ...Object.fromEntries(items.map((i) => [i.name, i.data])), "atlas.json": atlasJson(items) }) },
  { key: "unity", name: "Unity (direct project sync)", available: false },
  { key: "unreal", name: "Unreal (direct project sync)", available: false },
  { key: "godot", name: "Godot (direct project sync)", available: false },
  { key: "github", name: "GitHub (commit to game repo – requires approval)", available: false },
];

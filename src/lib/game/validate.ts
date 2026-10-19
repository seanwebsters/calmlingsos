/**
 * Deterministic game-asset technical validation. "Looks good" is not
 * "game-ready": an asset is only technically validated when every check
 * passes against its spec.
 */
import sharp from "sharp";
import type { GameAssetSpec } from "@/db/schema";

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

export function expectedName(spec: GameAssetSpec, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return spec.namingPattern.replace("{category}", spec.category.toLowerCase().replace(/[^a-z0-9]+/g, "_")).replace("{name}", slug).replace("{width}", String(spec.width)).replace("{height}", String(spec.height));
}

export function namingRegex(spec: GameAssetSpec): RegExp {
  const esc = spec.namingPattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === "{" || m === "}" ? m : `\\${m}`));
  const body = esc.replace("{category}", "[a-z0-9_]+").replace("{name}", "[a-z0-9_]+").replace("{width}", String(spec.width)).replace("{height}", String(spec.height));
  return new RegExp(`^${body}\\.(png|webp|jpe?g)$`);
}

/** Conform an image to the spec: exact canvas size, format, alpha preserved where required. */
export async function processToSpec(input: Buffer, spec: GameAssetSpec, frameCount = 1): Promise<Buffer> {
  const totalW = spec.animation.frames > 1 && spec.animation.layout === "horizontal" ? spec.width * frameCount : spec.width;
  let img = sharp(input).resize(totalW, spec.height, { fit: "contain", background: spec.transparency ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 255, g: 255, b: 255, alpha: 1 } });
  img = spec.transparency ? img.ensureAlpha() : img.flatten({ background: "#ffffff" });
  if (spec.fileFormat === "png") return img.png({ compressionLevel: 9, palette: false }).toBuffer();
  if (spec.fileFormat === "webp") return img.webp({ quality: 90, alphaQuality: 100 }).toBuffer();
  return img.jpeg({ quality: 88 }).toBuffer();
}

/** Lay N frames out as a sprite sheet (horizontal strip or near-square grid). */
export async function spriteSheet(frames: Buffer[], spec: GameAssetSpec): Promise<{ data: Buffer; columns: number; rows: number }> {
  const columns = spec.animation.layout === "grid" ? Math.ceil(Math.sqrt(frames.length)) : frames.length;
  const rows = Math.ceil(frames.length / columns);
  const cells = await Promise.all(frames.map((f) => sharp(f).resize(spec.width, spec.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()));
  const sheet = sharp({ create: { width: spec.width * columns, height: spec.height * rows, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(cells.map((c, i) => ({ input: c, left: (i % columns) * spec.width, top: Math.floor(i / columns) * spec.height })));
  const data = spec.fileFormat === "webp" ? await sheet.webp({ quality: 90 }).toBuffer() : await sheet.png({ compressionLevel: 9 }).toBuffer();
  return { data, columns, rows };
}

export async function validateGameAsset(data: Buffer, spec: GameAssetSpec, fileName: string, meta: { name: string; category: string; frames: number }): Promise<{ passed: boolean; checks: Check[] }> {
  const m = await sharp(data).metadata();
  const isSheet = spec.animation.frames > 1;
  const columns = isSheet ? (spec.animation.layout === "grid" ? Math.ceil(Math.sqrt(spec.animation.frames)) : spec.animation.frames) : 1;
  const rows = isSheet ? Math.ceil(spec.animation.frames / columns) : 1;
  const expW = spec.width * columns;
  const expH = spec.height * rows;
  const checks: Check[] = [];
  checks.push({ name: "Dimensions", passed: m.width === expW && m.height === expH, detail: `${m.width}×${m.height} (spec ${expW}×${expH})` });
  const fmt = m.format === "jpeg" ? "jpeg" : m.format;
  checks.push({ name: "File format", passed: fmt === spec.fileFormat, detail: `${m.format} (spec ${spec.fileFormat})` });
  if (spec.transparency) {
    let transparentPixels = 0;
    if (m.hasAlpha) {
      const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 3; i < raw.length; i += info.channels) if (raw[i] < 8) transparentPixels++;
    }
    const corners = m.hasAlpha ? await cornerAlpha(data) : 255;
    checks.push({ name: "Transparency", passed: Boolean(m.hasAlpha) && transparentPixels > 0 && corners < 8, detail: m.hasAlpha ? `${transparentPixels} transparent px; corner alpha ${corners}` : "no alpha channel – the generator did not return transparency" });
  } else checks.push({ name: "Transparency", passed: true, detail: "not required" });
  checks.push({ name: "Colour space", passed: !m.space || m.space === "srgb" || m.space === "b-w", detail: m.space ?? "unknown" });
  checks.push({ name: "Naming", passed: namingRegex(spec).test(fileName), detail: `${fileName} (pattern ${spec.namingPattern})` });
  const kb = data.length / 1024;
  checks.push({ name: "File size", passed: kb <= spec.maxFileKb, detail: `${kb.toFixed(1)} KB (max ${spec.maxFileKb} KB)` });
  checks.push({ name: "Frames", passed: meta.frames === spec.animation.frames, detail: `${meta.frames} of ${spec.animation.frames} frame(s)` });
  checks.push({ name: "Metadata", passed: Boolean(meta.name.trim() && meta.category.trim() && spec.targetEngine.trim()), detail: `name=${meta.name || "∅"} category=${meta.category || "∅"} engine=${spec.targetEngine || "∅"}` });
  return { passed: checks.every((c) => c.passed), checks };
}

async function cornerAlpha(data: Buffer): Promise<number> {
  const { data: raw, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => raw[(y * info.width + x) * info.channels + 3];
  return Math.max(at(0, 0), at(info.width - 1, 0), at(0, info.height - 1), at(info.width - 1, info.height - 1));
}

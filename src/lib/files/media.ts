/**
 * Local media tooling: image metadata/colours/thumbnails (sharp) and
 * video/audio probing, keyframes and rendering (bundled FFmpeg/ffprobe).
 */
import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("ffmpeg-static") as string;
}
export function ffprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("ffprobe-static") as { path: string }).path;
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "calmlings-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function hex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** Dominant colours by coarse histogram over a downsampled copy (ignores transparent pixels). */
export async function dominantColours(buf: Buffer, count = 6): Promise<string[]> {
  const { data, info } = await sharp(buf, { animated: false }).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((b) => hex(b.r / b.n, b.g / b.n, b.b / b.n));
}

export async function imageInfo(buf: Buffer) {
  const meta = await sharp(buf, { animated: false }).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0, hasAlpha: Boolean(meta.hasAlpha), format: meta.format ?? "unknown", colourSpace: meta.space ?? "unknown", pages: meta.pages ?? 1 };
}

export async function thumbnail(buf: Buffer, size = 720): Promise<Buffer> {
  return sharp(buf, { animated: false }).resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}

/** A JPEG/PNG copy suitable for sending to vision models (≤ 1568px, ≤ ~4MB). */
export async function visionCopy(buf: Buffer): Promise<{ data: Buffer; mimeType: string }> {
  const meta = await sharp(buf, { animated: false }).metadata();
  const img = sharp(buf, { animated: false }).resize(1568, 1568, { fit: "inside", withoutEnlargement: true });
  if (meta.hasAlpha) return { data: await img.png().toBuffer(), mimeType: "image/png" };
  return { data: await img.jpeg({ quality: 88 }).toBuffer(), mimeType: "image/jpeg" };
}

export interface ProbeResult {
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(ffprobePath(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { maxBuffer: 10 * 1024 * 1024 });
  const json = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }[] };
  const v = json.streams?.find((s) => s.codec_type === "video");
  const a = json.streams?.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    durationSeconds: Number(json.format?.duration ?? v?.duration ?? a?.duration ?? 0),
    width: v?.width,
    height: v?.height,
    fps: den ? Math.round((num / den) * 100) / 100 : undefined,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    hasAudio: Boolean(a),
  };
}

export async function probeBuffer(buf: Buffer, ext: string): Promise<ProbeResult> {
  return withTempDir(async (dir) => {
    const f = path.join(dir, `in.${ext}`);
    await fs.writeFile(f, buf);
    return probe(f);
  });
}

/** Evenly sampled keyframes as JPEGs. */
export async function keyframes(buf: Buffer, ext: string, count = 6): Promise<{ atSeconds: number; data: Buffer }[]> {
  return withTempDir(async (dir) => {
    const f = path.join(dir, `in.${ext}`);
    await fs.writeFile(f, buf);
    const info = await probe(f);
    if (!info.width) return [];
    const out: { atSeconds: number; data: Buffer }[] = [];
    const n = Math.max(1, Math.min(count, Math.floor(info.durationSeconds) || 1));
    for (let i = 0; i < n; i++) {
      const at = info.durationSeconds > 0 ? (info.durationSeconds * (i + 0.5)) / n : 0;
      const target = path.join(dir, `k${i}.jpg`);
      await run(ffmpegPath(), ["-y", "-ss", at.toFixed(2), "-i", f, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "3", target]);
      out.push({ atSeconds: Math.round(at * 10) / 10, data: await fs.readFile(target) });
    }
    return out;
  });
}

/** Extract the audio track as MP3 (for transcription). */
export async function extractAudio(buf: Buffer, ext: string): Promise<Buffer | null> {
  return withTempDir(async (dir) => {
    const f = path.join(dir, `in.${ext}`);
    await fs.writeFile(f, buf);
    const info = await probe(f);
    if (!info.hasAudio) return null;
    const out = path.join(dir, "audio.mp3");
    await run(ffmpegPath(), ["-y", "-i", f, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", out]);
    return fs.readFile(out);
  });
}

export function aspectRatio(w?: number, h?: number): string | undefined {
  if (!w || !h) return undefined;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  const r = `${w / g}:${h / g}`;
  const known: Record<string, string> = { "9:16": "9:16", "16:9": "16:9", "1:1": "1:1", "4:5": "4:5", "4:3": "4:3", "3:4": "3:4" };
  if (known[r]) return r;
  const ratio = w / h;
  const near = Object.keys(known).find((k) => {
    const [a, b] = k.split(":").map(Number);
    return Math.abs(a / b - ratio) < 0.02;
  });
  return near ? `≈${near}` : `${(ratio).toFixed(3)}:1`;
}

export async function runFfmpeg(args: string[], timeoutMs = 10 * 60_000) {
  return run(ffmpegPath(), args, { maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs });
}

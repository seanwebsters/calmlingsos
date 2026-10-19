/**
 * Timeline assembly with the bundled FFmpeg. Two honest render modes:
 *  - animatic: approved storyboard frames with a gentle push-in and crossfades
 *    (labelled ANIMATIC – it is not generated video);
 *  - cut: real generated shot clips conformed to the platform frame.
 * Voice lines are laid at their cue times over an optional music bed;
 * captions are burned in and also exported as SRT/VTT sidecars.
 * Animatic/caption/mixing approach adapted from the WEBSTER engine
 * (seanwebsters/ipgenerator).
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureFonts } from "./fonts";
import { probe, runFfmpeg } from "@/lib/files/media";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const ts = (s: number, sep: "," | ".") => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
export const toSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${ts(c.start, ",")} --> ${ts(c.end, ",")}\n${c.text}\n`).join("\n");
export const toVtt = (cues: Cue[]) => `WEBVTT\n\n${cues.map((c) => `${ts(c.start, ".")} --> ${ts(c.end, ".")}\n${c.text}\n`).join("\n")}`;

export function frameSize(aspect: string): { w: number; h: number } {
  if (aspect === "16:9") return { w: 1280, h: 720 };
  if (aspect === "1:1") return { w: 1080, h: 1080 };
  if (aspect === "4:5") return { w: 1080, h: 1350 };
  return { w: 720, h: 1280 };
}

export interface AssembleInput {
  dir: string;
  mode: "animatic" | "cut";
  aspect: string;
  /** For animatic: still image files. For cut: video clip files. */
  items: { file: string; durationSec: number }[];
  voice: { file: string; start: number }[];
  music: string | null;
  cues: Cue[];
  burnCaptions: boolean;
}

export interface AssembleOutput {
  video: string;
  srt: string;
  vtt: string;
  durationSec: number;
  meanVolumeDb: number | null;
}

export async function assemble(input: AssembleInput): Promise<AssembleOutput> {
  ensureFonts();
  const { w, h } = frameSize(input.aspect);
  const fps = 25;
  const fade = input.items.length > 1 ? 0.4 : 0;
  const srt = path.join(input.dir, "captions.srt");
  const vtt = path.join(input.dir, "captions.vtt");
  await fs.writeFile(srt, toSrt(input.cues));
  await fs.writeFile(vtt, toVtt(input.cues));

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  const filters: string[] = [];
  input.items.forEach((it, i) => {
    if (input.mode === "animatic") {
      args.push("-loop", "1", "-t", it.durationSec.toFixed(2), "-i", it.file);
      const frames = Math.max(1, Math.round(it.durationSec * fps));
      const zoom = i % 2 === 0 ? "on" : `(${frames}-on)`;
      filters.push(
        `[${i}:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='min(1+${zoom}*0.0004,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},format=yuv420p,setpts=PTS-STARTPTS,settb=AVTB[v${i}]`,
      );
    } else {
      args.push("-i", it.file);
      filters.push(`[${i}:v]trim=duration=${it.durationSec.toFixed(2)},setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuv420p,settb=AVTB[v${i}]`);
    }
  });
  let last = "v0";
  let offset = input.items[0].durationSec - fade;
  for (let i = 1; i < input.items.length; i++) {
    filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(2)}[x${i}]`);
    last = `x${i}`;
    offset += input.items[i].durationSec - fade;
  }
  const total = input.items.reduce((n, s) => n + s.durationSec, 0) - fade * (input.items.length - 1);
  if (input.burnCaptions && input.cues.length) {
    const style = `FontName=DejaVu Sans,FontSize=${input.aspect === "16:9" ? 15 : 12},PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1.4,Shadow=0,MarginV=${input.aspect === "16:9" ? 30 : 70}`;
    filters.push(`[${last}]subtitles=${srt.replace(/([:\\'])/g, "\\$1")}:force_style='${style}'[vout]`);
  } else filters.push(`[${last}]null[vout]`);

  // Audio: silent base so the output always has a track, then music bed and voice lines.
  let idx = input.items.length;
  args.push("-f", "lavfi", "-t", total.toFixed(2), "-i", "anullsrc=r=44100:cl=stereo");
  const base = idx++;
  const audioLabels: string[] = [`[${base}:a]`];
  if (input.music) {
    args.push("-i", input.music);
    filters.push(`[${idx}:a]aformat=channel_layouts=stereo,volume=${input.voice.length ? 0.35 : 0.8},atrim=duration=${total.toFixed(2)},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[bed]`);
    audioLabels.push("[bed]");
    idx++;
  }
  input.voice.forEach((v, i) => {
    args.push("-i", v.file);
    const ms = Math.round(v.start * 1000);
    filters.push(`[${idx}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms}[vo${i}]`);
    audioLabels.push(`[vo${i}]`);
    idx++;
  });
  filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);

  const out = path.join(input.dir, "final.mp4");
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-t", total.toFixed(2), "-movflags", "+faststart", out,
  );
  await runFfmpeg(args);
  const meanVolumeDb = await meanVolume(out);
  return { video: out, srt, vtt, durationSec: Math.round(total * 100) / 100, meanVolumeDb };
}

export async function meanVolume(file: string): Promise<number | null> {
  try {
    const { stderr } = await runFfmpeg(["-hide_banner", "-nostats", "-i", file, "-map", "0:a?", "-af", "volumedetect", "-f", "null", "-"]);
    const m = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Technical QA for a rendered deliverable against a platform spec. */
export async function technicalQa(file: string, spec: { aspect: string; maxDurationSec: number }) {
  const p = await probe(file);
  const { w, h } = frameSize(spec.aspect);
  const vol = await meanVolume(file);
  const checks = [
    { name: "Resolution", passed: p.width === w && p.height === h, detail: `${p.width}×${p.height} (expected ${w}×${h})` },
    { name: "Duration", passed: p.durationSeconds > 0 && p.durationSeconds <= spec.maxDurationSec + 0.5, detail: `${p.durationSeconds.toFixed(1)}s (max ${spec.maxDurationSec}s)` },
    { name: "Video codec", passed: p.videoCodec === "h264", detail: p.videoCodec ?? "none" },
    { name: "Audio track", passed: p.hasAudio, detail: p.audioCodec ?? "missing" },
    { name: "Loudness", passed: vol === null || (vol > -40 && vol < -5), detail: vol === null ? "not measured" : `mean ${vol.toFixed(1)} dB` },
  ];
  return { passed: checks.every((c) => c.passed), checks };
}

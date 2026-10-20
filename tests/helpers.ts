/**
 * Test harness: a fresh embedded Postgres (PGlite, in memory) and temp
 * storage per test file, plus deterministic provider test doubles.
 * Test doubles are only installable under the test runner – the app can
 * never route to them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

export function setupEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "calmlings-test-"));
  // TEST_DATABASE_URL=postgres://… runs the suite against a real PostgreSQL server.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "pglite:memory://";
  process.env.DATA_DIR = dir;
  process.env.CREDENTIALS_ENCRYPTION_KEY = "0".repeat(64);
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "FAL_KEY", "ELEVENLABS_API_KEY"]) delete process.env[k];
  return dir;
}

export async function freshDb() {
  const { resetDb, getDb } = await import("@/db");
  await resetDb();
  if (process.env.TEST_DATABASE_URL) {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
    await c.query("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
    await c.end();
  }
  const { setStorage } = await import("@/lib/storage");
  setStorage(undefined);
  return getDb();
}

export async function makeOrg(role: string = "owner") {
  const { bootstrap } = await import("@/lib/org");
  const { orgId, userId } = await bootstrap({ orgName: "Calmlings Test", name: "Director", email: `cd${Date.now()}${Math.random()}@test.dev`, password: "correct-horse-battery" });
  const viewer = { userId, name: "Director", email: "cd@test.dev", orgId, orgName: "Calmlings Test", role: role as "owner" };
  return { orgId, userId, viewer };
}

export async function pngOf(hex: string, size = 256, alpha = false): Promise<Buffer> {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const base = sharp({ create: { width: size, height: size, channels: 4, background: alpha ? { r: 0, g: 0, b: 0, alpha: 0 } : { r, g, b, alpha: 1 } } });
  if (!alpha) return base.png().toBuffer();
  const dot = await sharp({ create: { width: size / 2, height: size / 2, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
  return base.composite([{ input: dot, left: size / 4, top: size / 4 }]).png().toBuffer();
}

let cachedMp4: Buffer | null = null;
export function tinyMp4(): Buffer {
  if (cachedMp4) return cachedMp4;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpeg = require("ffmpeg-static") as string;
  const out = path.join(os.tmpdir(), `tiny-${process.pid}.mp4`);
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=25:duration=2", "-pix_fmt", "yuv420p", "-c:v", "libx264", out]);
  cachedMp4 = fs.readFileSync(out);
  return cachedMp4;
}

export function tinyMp3(): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpeg = require("ffmpeg-static") as string;
  const out = path.join(os.tmpdir(), `tiny-${process.pid}.mp3`);
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame", out]);
  return fs.readFileSync(out);
}

type Json = Record<string, unknown>;

/** Builds schema-valid fake output; specialised for the artifacts tests inspect. */
export function fakeFor(schema: Json, prompt: string): unknown {
  const props = (schema.properties ?? {}) as Record<string, Json>;
  const codes = [...prompt.matchAll(/(CHR-[A-Z0-9]+) = /g)].map((m) => m[1]);
  const conceptIds = [...new Set([...prompt.matchAll(/"id": "(c\d+)"/g)].map((m) => m[1]))];
  const cast = codes.length ? codes : [];
  if ("productions" in props && "canonGaps" in props) {
    const cast = [...new Set([...prompt.matchAll(/\((CHR-[A-Z0-9]+)/g)].map((m) => m[1]))];
    return { summary: "Two productions", productions: [{ templateKey: "social_video", title: "Blue TikToks", characters: [...cast.slice(0, 1), "Ghosty"], briefJson: JSON.stringify({ theme: "Rainy day calm", conceptCount: 5, produceCount: 5, platform: "tiktok" }), rationale: "Social" }, { templateKey: "product_range", title: "Plush", characters: cast.slice(0, 1), briefJson: "not json", rationale: "Product" }], questions: ["Which week?"], canonGaps: [] };
  }
  if ("concepts" in props && !("name" in props)) {
    const n = Number(prompt.match(/exactly (\d+) DISTINCT/)?.[1] ?? 3);
    return { concepts: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, title: `Concept ${i + 1}`, hook: "A tiny sigh", logline: "A calm moment", emotionalMessage: "It's okay to pause", characters: cast.slice(0, 1), format: "sketch", whyItWorks: "Relatable", canonQuestions: [] })) };
  }
  if ("scores" in props) return { scores: [...new Set([...prompt.matchAll(/"id": "(c\d+)"/g)].map((m) => m[1]))].map((id, i) => ({ conceptId: id, originality: 7 - i * 0.1, emotionalImpact: 8, shareability: 7, brandFit: 9, rationale: "Fits", risks: [] })), recommendation: "c1" };
  if ("scripts" in props) return { scripts: (conceptIds.length ? conceptIds : ["c1"]).map((id) => ({ conceptId: id, title: `Script ${id}`, durationSeconds: 6, hook: "Breathe", emotionalMessage: "Pause", beats: [{ atSeconds: 0, action: "Looks up", dialogue: "Hello", speaker: cast[0] ?? null }], endCard: "Calmlings" })) };
  if ("storyboards" in props) {
    const ids = [...new Set([...prompt.matchAll(/"conceptId": "(c\d+)"/g)].map((m) => m[1]))];
    return { storyboards: (ids.length ? ids : ["c1"]).map((id) => ({ conceptId: id, shots: [1, 2].map((k) => ({ index: k, description: `Shot ${k}`, camera: "medium", action: "breathes", dialogue: k === 1 ? "Hello" : "", speaker: k === 1 ? (cast[0] ?? null) : null, sound: "birds", durationSeconds: 3, characters: cast.slice(0, 1), continuity: "same scarf", framePrompt: "garden at dawn", motionPrompt: "gentle sway" })) })) };
  }
  if ("packs" in props) {
    const ids = [...new Set([...prompt.matchAll(/"conceptId": "(c\d+)"/g)].map((m) => m[1]))];
    return { packs: ids.map((id) => ({ conceptId: id, caption: "Take a breath", hashtags: ["#calmlings"], alternateHooks: ["Pause"], thumbnailText: "Breathe", onScreenCaptions: [{ startSeconds: 0, endSeconds: 2, text: "Hello" }] })) };
  }
  if ("passed" in props && "issues" in props) return { passed: true, summary: "On brand", issues: [] };
  if ("overallScore" in props) return { overallScore: 0.82, identityDrift: false, items: [{ item: "Colours", score: 0.9, note: "match" }], summary: "Close" };
  if ("items" in props && "category" in (((props.items as Json).items as Json).properties as Json)) {
    const n = Number(prompt.match(/exactly (\d+)/)?.[1] ?? 2);
    return { items: Array.from({ length: n }, (_, i) => ({ id: `g${i + 1}`, name: `Item ${i + 1}`, category: "collectible", description: "A shell", characters: cast.slice(0, 1), prompt: "a shell", notes: "" })) };
  }
  return generic(schema, "x");
}

function generic(s: Json, key: string, idx = 0): unknown {
  if (s.anyOf) return generic((s.anyOf as Json[]).find((o) => o.type !== "null") ?? (s.anyOf as Json[])[0], key, idx);
  if (s.enum) return (s.enum as unknown[])[0];
  if (s.type === "object" || s.properties) return Object.fromEntries(Object.entries((s.properties ?? {}) as Record<string, Json>).map(([k, v]) => [k, generic(v, k, idx)]));
  if (s.type === "array") return [0, 1].map((i) => generic(s.items as Json, key, i));
  if (s.type === "string") return key === "id" ? `i${idx + 1}` : key === "hex" ? "#336699" : `${key} ${idx + 1}`;
  if (s.type === "number" || s.type === "integer") return /maximum: 1\b/.test(String(s.description ?? "")) ? 0.8 : 3;
  if (s.type === "boolean") return true;
  if (s.type === "null") return null;
  return null;
}

export interface FakeLog {
  text: { prompt: string; images: number; context?: string }[];
  images: { prompt: string; refs: string[] }[];
  videos: number;
  speech: number;
  agentTurns: { lead: boolean; turn: number; context: string; tools: string[] }[];
}

export async function installFakes(opts: { failImagesTimes?: number } = {}) {
  const { setTestAdapters } = await import("@/lib/providers/gateway");
  const log: FakeLog = { text: [], images: [], videos: 0, speech: 0, agentTurns: [] };
  let imageFailures = opts.failImagesTimes ?? 0;
  const { ProviderError } = await import("@/lib/errors");
  setTestAdapters({
    anthropic: {
      key: "anthropic",
      test: async () => ({ ok: true, detail: "test" }),
      agentTurn: async (_k, model, req) => {
        const turn = (req.messages as { role: string }[]).filter((m) => m.role === "assistant").length;
        const lead = req.tools.some((t) => t.name === "delegate");
        log.agentTurns.push({ lead, turn, context: req.context ?? "", tools: req.tools.map((t) => t.name) });
        const call = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", id: `tu_${name}_${turn}_${Math.random().toString(36).slice(2, 7)}`, name, input });
        let content: Record<string, unknown>[];
        if (lead && turn === 0) content = [{ type: "text", text: "Planning the mission." }, call("search_canon", { characters: ["Blue"], topic: "rain" }), call("delegate", { agent: "comedy_writer", title: "Concepts", instructions: "Write 3 concepts" }), call("delegate", { agent: "short_form_scriptwriter", title: "Script", instructions: "Write a script" }), call("await_reports", {})];
        else if (lead && turn === 1) content = [call("request_approval", { question: "Go with concept 1?", context: "Reports are in." })];
        else if (lead) content = [{ type: "text", text: "Mission complete: two documents ready for review." }];
        else if (turn === 0) content = [call("write_document", { title: "Draft from specialist", markdown: "# Draft", characters: ["Blue"] })];
        else content = [{ type: "text", text: "Done – document saved." }];
        const toolCalls = content.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id), name: String(b.name), input: b.input as Record<string, unknown> }));
        return { append: [{ role: "assistant", content }], text: content.filter((b) => b.type === "text").map((b) => String(b.text)).join(""), toolCalls, done: toolCalls.length === 0, model, units: { input_tokens: 10, output_tokens: 10 }, costCents: 0.2 };
      },
      userMessage: (text: string) => ({ role: "user", content: text }),
      toolResults: (results) => [{ role: "user", content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content, is_error: r.isError })) }],
      text: async (_k, model, req) => {
        log.text.push({ prompt: req.prompt, images: req.images?.length ?? 0, context: req.context });
        const data = req.jsonSchema ? fakeFor(req.jsonSchema, `${req.prompt}\n${req.context ?? ""}`) : "ok";
        return { text: JSON.stringify(data), model, units: { input_tokens: 100, output_tokens: 50 }, costCents: 0.5 };
      },
    },
    google: {
      key: "google",
      test: async () => ({ ok: true, detail: "test" }),
      image: async (_k, model, req) => {
        if (imageFailures > 0) {
          imageFailures--;
          throw new ProviderError("google", "simulated outage", true);
        }
        log.images.push({ prompt: req.prompt, refs: (req.references ?? []).map((r) => r.label ?? "") });
        return { data: await pngOf("#88aaff", 128, Boolean(req.transparent)), mimeType: "image/png", model, units: { images: 1 }, costCents: 4 };
      },
    },
    fal: {
      key: "fal",
      test: async () => ({ ok: true, detail: "test" }),
      video: async (_k, model) => {
        log.videos++;
        return { data: tinyMp4(), mimeType: "video/mp4", model, units: { seconds: 2 }, costCents: 14 };
      },
    },
    elevenlabs: {
      key: "elevenlabs",
      test: async () => ({ ok: true, detail: "test" }),
      speech: async (_k, model) => {
        log.speech++;
        return { data: tinyMp3(), mimeType: "audio/mpeg", model, units: { characters: 5 }, costCents: 0.1 };
      },
    },
  });
  return log;
}

export async function clearFakes() {
  const { setTestAdapters } = await import("@/lib/providers/gateway");
  setTestAdapters(null);
}

/** Create an approved character with an approved master reference. */
export async function approvedCharacter(viewer: { orgId: string; userId: string } & Record<string, unknown>, name: string, colour: string) {
  const { createCharacter, saveProfile, approveVersion } = await import("@/lib/brain/characters");
  const { emptyProfile } = await import("@/lib/brain/profile");
  const { uploadReferences } = await import("@/lib/brain/references");
  const v = viewer as never;
  const id = await createCharacter(v, { name });
  const { versionId } = await saveProfile(v, id, { ...emptyProfile(name), personality: `${name} is gentle`, colours: [{ name: "Body", hex: colour }] }, "Initial canon");
  await approveVersion(v, versionId);
  const up = await uploadReferences(v, [{ name: `${name.toLowerCase()}-front.png`, data: await pngOf(colour) }], { characterIds: [id], designation: "official_master", viewAngle: "front", rightsStatus: "owned" });
  return { id, referenceId: up.created[0].id };
}

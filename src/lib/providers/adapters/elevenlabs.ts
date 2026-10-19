import "server-only";
import { ProviderError } from "@/lib/errors";
import type { ProviderAdapter } from "../types";
import { failFrom, fetchBinary, fetchJson } from "./http";

const BASE = "https://api.elevenlabs.io";
const h = (k: string) => ({ "xi-api-key": k, "content-type": "application/json" });

const defaultVoice = new Map<string, string>();
async function voiceFor(apiKey: string, voiceId?: string | null): Promise<string> {
  if (voiceId) return voiceId;
  const cached = defaultVoice.get(apiKey);
  if (cached) return cached;
  const json = await fetchJson<{ voices: { voice_id: string; category: string }[] }>("elevenlabs", `${BASE}/v1/voices`, { headers: h(apiKey) });
  const v = json.voices.find((x) => x.category === "premade") ?? json.voices[0];
  if (!v) throw new ProviderError("elevenlabs", "No voices are available on this ElevenLabs account. Add a licensed voice and assign it to the character.", false);
  defaultVoice.set(apiKey, v.voice_id);
  return v.voice_id;
}

export const elevenlabsAdapter: ProviderAdapter = {
  key: "elevenlabs",
  async test(apiKey) {
    try {
      const json = await fetchJson<{ subscription?: { tier?: string; character_count?: number; character_limit?: number } }>("elevenlabs", `${BASE}/v1/user`, { headers: h(apiKey), timeoutMs: 15_000 });
      const s = json.subscription;
      return { ok: true, detail: `Connected${s?.tier ? ` – ${s.tier} tier` : ""}${s?.character_limit ? `, ${s.character_count ?? 0}/${s.character_limit} characters used` : ""}.` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },

  async speech(apiKey, model, req) {
    const voice = await voiceFor(apiKey, req.voiceId);
    const out = await fetchBinary("elevenlabs", `${BASE}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { ...h(apiKey), accept: "audio/mpeg" },
      body: JSON.stringify({ text: req.text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    const rate = model.includes("flash") ? 9 : 18;
    return { data: out.data, mimeType: "audio/mpeg", model, units: { characters: req.text.length }, costCents: Math.round((req.text.length / 1000) * rate * 100) / 100 };
  },

  async soundEffect(apiKey, model, req) {
    const out = await fetchBinary("elevenlabs", `${BASE}/v1/sound-generation?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { ...h(apiKey), accept: "audio/mpeg" },
      body: JSON.stringify({ text: req.prompt, model_id: model, duration_seconds: Math.min(30, Math.max(1, req.seconds)) }),
    });
    return { data: out.data, mimeType: "audio/mpeg", model, units: { seconds: req.seconds }, costCents: req.seconds * 0.4 };
  },

  async music(apiKey, model, req) {
    const out = await fetchBinary("elevenlabs", `${BASE}/v1/music?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { ...h(apiKey), accept: "audio/mpeg" },
      body: JSON.stringify({ prompt: req.prompt, model_id: model, music_length_ms: Math.round(Math.min(300, Math.max(10, req.seconds)) * 1000) }),
    });
    return { data: out.data, mimeType: "audio/mpeg", model, units: { seconds: req.seconds }, costCents: (req.seconds / 60) * 50 };
  },

  async transcribe(apiKey, model, req) {
    const form = new FormData();
    form.set("model_id", model);
    form.set("file", new Blob([new Uint8Array(req.audio.data)], { type: req.audio.mimeType }), "audio");
    const res = await fetch(`${BASE}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: AbortSignal.timeout(300_000) }).catch((e) => {
      throw new ProviderError("elevenlabs", `Couldn't reach ElevenLabs: ${e}`, true);
    });
    if (!res.ok) await failFrom("elevenlabs", res);
    const json = (await res.json()) as { text: string };
    return { text: json.text, model, units: { bytes: req.audio.data.length }, costCents: 1 };
  },
};

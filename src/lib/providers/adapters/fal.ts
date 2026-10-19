import "server-only";
import { ProviderError } from "@/lib/errors";
import type { ProviderAdapter } from "../types";
import { fetchBinary, fetchJson, sleep } from "./http";

const auth = (k: string) => ({ authorization: `Key ${k}`, "content-type": "application/json" });
const dataUri = (mime: string, data: Buffer) => `data:${mime};base64,${data.toString("base64")}`;

/** Run a slow fal model through fal's queue: submit, poll, fetch result. */
async function falQueue<T>(apiKey: string, endpoint: string, input: Record<string, unknown>, timeoutMs = 12 * 60_000): Promise<T> {
  const job = await fetchJson<{ status_url: string; response_url: string }>("fal", `https://queue.fal.run/${endpoint}`, { method: "POST", headers: auth(apiKey), body: JSON.stringify(input) });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(process.env.VITEST ? 5 : 5000);
    const st = await fetch(job.status_url, { headers: auth(apiKey) }).catch(() => null);
    if (!st?.ok) continue;
    const s = (await st.json()) as { status: string };
    if (s.status === "COMPLETED") return fetchJson<T>("fal", job.response_url, { headers: auth(apiKey) });
    if (s.status === "FAILED" || s.status === "ERROR") throw new ProviderError("fal", `fal job failed: ${JSON.stringify(s).slice(0, 300)}`, false);
  }
  throw new ProviderError("fal", "fal job timed out.", true);
}

export const falAdapter: ProviderAdapter = {
  key: "fal",
  async test(apiKey) {
    const res = await fetch("https://api.fal.ai/v1/models?limit=1", { headers: { authorization: `Key ${apiKey}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res) return { ok: false, detail: "Couldn't reach fal.ai." };
    if (res.status === 401 || res.status === 403) return { ok: false, detail: `fal.ai rejected the key (${res.status}).` };
    if (!res.ok) return { ok: true, detail: `Key accepted format; model listing returned ${res.status}, so availability is unverified.` };
    return { ok: true, detail: "Connected." };
  },

  async image(apiKey, model, req) {
    const refs = req.references ?? [];
    const endpoint = refs.length ? `${model.replace(/\/edit$/, "")}/edit` : model.replace(/\/edit$/, "");
    const json = await fetchJson<{ images?: { url: string; content_type?: string }[] }>("fal", `https://fal.run/${endpoint}`, {
      method: "POST",
      headers: auth(apiKey),
      body: JSON.stringify({
        prompt: req.prompt + (req.transparent ? "\nPlain flat uniform background suitable for background removal." : ""),
        num_images: 1,
        aspect_ratio: req.aspectRatio,
        output_format: "png",
        ...(refs.length ? { image_urls: refs.map((r) => dataUri(r.mimeType, r.data)) } : {}),
      }),
      timeoutMs: 300_000,
    });
    const img = json.images?.[0];
    if (!img?.url) throw new ProviderError("fal", "fal.ai returned no image.", true);
    const file = await fetchBinary("fal", img.url);
    return { data: file.data, mimeType: img.content_type ?? file.mimeType, model, units: { images: 1 }, costCents: 4 };
  },

  async video(apiKey, model, req) {
    if (!req.startFrame && model.includes("image-to-video")) {
      throw new ProviderError("fal", "This video model needs an approved start frame (image-to-video). Generate and approve the shot's reference frame first.", false);
    }
    const duration = req.durationSeconds > 5 ? "10" : "5";
    const out = await falQueue<{ video?: { url: string } }>(apiKey, model, {
      prompt: req.prompt,
      duration,
      aspect_ratio: req.aspectRatio,
      ...(req.startFrame ? { image_url: dataUri(req.startFrame.mimeType, req.startFrame.data) } : {}),
    });
    if (!out.video?.url) throw new ProviderError("fal", "fal.ai returned no video.", true);
    const file = await fetchBinary("fal", out.video.url);
    return { data: file.data, mimeType: "video/mp4", model, units: { seconds: Number(duration) }, costCents: Number(duration) * 7 };
  },
};

import "server-only";
import { ProviderError } from "@/lib/errors";
import type { ProviderAdapter } from "../types";
import { fetchBinary, fetchJson, sleep } from "./http";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const headers = (k: string) => ({ "x-goog-api-key": k, "content-type": "application/json" });

interface InlineData {
  mimeType?: string;
  mime_type?: string;
  data: string;
}
interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string; inlineData?: InlineData; inline_data?: InlineData }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  modelVersion?: string;
}

export const googleAdapter: ProviderAdapter = {
  key: "google",
  async test(apiKey) {
    try {
      const json = await fetchJson<{ models: { name: string }[] }>("google", `${BASE}/models?pageSize=200`, { headers: headers(apiKey), timeoutMs: 15_000 });
      const ids = json.models.map((m) => m.name.replace(/^models\//, ""));
      return { ok: true, detail: `Connected – ${ids.length} models visible.`, availableModels: ids };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },

  async text(apiKey, model, req) {
    const parts: Record<string, unknown>[] = [
      ...(req.images ?? []).flatMap((img) => [...(img.label ? [{ text: `Image – ${img.label}:` }] : []), { inlineData: { mimeType: img.mimeType, data: img.data.toString("base64") } }]),
      { text: req.prompt },
    ];
    const json = await fetchJson<GenerateResponse>("google", `${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: [req.system, req.context].filter(Boolean).join("\n\n") }] },
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: req.maxTokens ?? 16000, ...(req.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema } : {}) },
      }),
      timeoutMs: 300_000,
    });
    if (json.promptFeedback?.blockReason) throw new ProviderError("google", `Gemini blocked the prompt (${json.promptFeedback.blockReason}).`, false);
    const c = json.candidates?.[0];
    if (c?.finishReason === "MAX_TOKENS") throw new ProviderError("google", "Gemini ran out of output room.", true);
    const text = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const units = { input_tokens: json.usageMetadata?.promptTokenCount ?? 0, output_tokens: json.usageMetadata?.candidatesTokenCount ?? 0 };
    const costCents = Math.round(((units.input_tokens * 1.25 + units.output_tokens * 10) / 1e6) * 10000) / 100;
    return { text: text.trim(), model: json.modelVersion ?? model, units, costCents };
  },

  async image(apiKey, model, req) {
    const parts: Record<string, unknown>[] = [];
    for (const ref of req.references ?? []) {
      if (ref.label) parts.push({ text: `Reference – ${ref.label}:` });
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data.toString("base64") } });
    }
    parts.push({ text: req.prompt + (req.transparent ? "\nRender on a plain, flat, uniform background suitable for background removal." : "") });
    const json = await fetchJson<GenerateResponse>("google", `${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: req.aspectRatio } } }),
      timeoutMs: 300_000,
    });
    if (json.promptFeedback?.blockReason) throw new ProviderError("google", `Image prompt was blocked (${json.promptFeedback.blockReason}).`, false);
    const img = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.inlineData ?? p.inline_data).find((d): d is InlineData => Boolean(d?.data));
    if (!img) throw new ProviderError("google", `Gemini returned no image (${json.candidates?.[0]?.finishReason ?? "no candidates"}).`, true);
    return { data: Buffer.from(img.data, "base64"), mimeType: img.mimeType ?? img.mime_type ?? "image/png", model, units: { images: 1 }, costCents: 3.9 };
  },

  async video(apiKey, model, req) {
    const instance: Record<string, unknown> = { prompt: req.prompt };
    if (req.startFrame) instance.image = { bytesBase64Encoded: req.startFrame.data.toString("base64"), mimeType: req.startFrame.mimeType };
    const seconds = req.durationSeconds <= 4 ? 4 : req.durationSeconds <= 6 ? 6 : 8;
    const op = await fetchJson<{ name: string }>("google", `${BASE}/models/${encodeURIComponent(model)}:predictLongRunning`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: req.aspectRatio === "1:1" ? "16:9" : req.aspectRatio, durationSeconds: seconds } }),
    });
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
      await sleep(process.env.VITEST ? 5 : 10_000);
      const st = await fetchJson<{ done?: boolean; error?: { message: string }; response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } } }>("google", `${BASE}/${op.name}`, { headers: headers(apiKey) });
      if (st.error) throw new ProviderError("google", `Veo failed: ${st.error.message}`, false);
      if (st.done) {
        const uri = st.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) throw new ProviderError("google", "Veo finished without a video (it may have been filtered).", false);
        const file = await fetchBinary("google", uri, { headers: { "x-goog-api-key": apiKey } });
        return { data: file.data, mimeType: "video/mp4", model, units: { seconds }, costCents: seconds * 40 };
      }
    }
    throw new ProviderError("google", "Veo job timed out.", true);
  },

  async embed(apiKey, model, req) {
    const json = await fetchJson<{ embeddings: { values: number[] }[] }>("google", `${BASE}/models/${encodeURIComponent(model)}:batchEmbedContents`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ requests: req.texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) }),
    });
    const chars = req.texts.reduce((n, t) => n + t.length, 0);
    return { vectors: json.embeddings.map((e) => e.values), model, units: { characters: chars }, costCents: (chars / 4) * 0.15 / 1e4 };
  },
};

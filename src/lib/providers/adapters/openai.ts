import "server-only";
import { ProviderError } from "@/lib/errors";
import type { ImageRequest, ProviderAdapter, ToolResult } from "../types";
import { failFrom, fetchBinary, fetchJson } from "./http";

const BASE = "https://api.openai.com/v1";
const auth = (k: string) => ({ authorization: `Bearer ${k}` });

const SIZES: Record<ImageRequest["aspectRatio"], string> = {
  "1:1": "1024x1024",
  "9:16": "1024x1536",
  "2:3": "1024x1536",
  "3:4": "1024x1536",
  "4:5": "1024x1536",
  "16:9": "1536x1024",
  "3:2": "1536x1024",
  "4:3": "1536x1024",
};

export const openaiAdapter: ProviderAdapter = {
  key: "openai",
  async test(apiKey) {
    try {
      const json = await fetchJson<{ data: { id: string }[] }>("openai", `${BASE}/models`, { headers: auth(apiKey), timeoutMs: 15_000 });
      return { ok: true, detail: `Connected – ${json.data.length} models visible.`, availableModels: json.data.map((m) => m.id) };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },

  async text(apiKey, model, req) {
    const userContent: unknown[] = [
      ...(req.images ?? []).map((img) => ({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data.toString("base64")}` } })),
      { type: "text", text: req.prompt },
    ];
    const json = await fetchJson<{ model: string; choices: { message: { content: string | null; refusal?: string | null }; finish_reason: string }[]; usage?: { prompt_tokens: number; completion_tokens: number } }>(
      "openai",
      `${BASE}/chat/completions`,
      {
        method: "POST",
        headers: { ...auth(apiKey), "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: [req.system, req.context].filter(Boolean).join("\n\n") },
            { role: "user", content: userContent },
          ],
          max_completion_tokens: req.maxTokens ?? 16000,
          ...(req.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: (req.schemaName ?? "output").replace(/[^a-zA-Z0-9_-]/g, "_"), schema: req.jsonSchema, strict: false } } } : {}),
        }),
        timeoutMs: 300_000,
      },
    );
    const choice = json.choices[0];
    if (choice?.message.refusal) throw new ProviderError("openai", `The model declined: ${choice.message.refusal}`, false);
    if (choice?.finish_reason === "length") throw new ProviderError("openai", "The model ran out of output room before finishing.", true);
    const units = { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 };
    // Approximate GPT-5 class pricing ($1.25 / $10 per M) – estimate only.
    const costCents = Math.round(((units.input_tokens * 1.25 + units.output_tokens * 10) / 1e6) * 10000) / 100;
    return { text: (choice?.message.content ?? "").trim(), model: json.model, units, costCents };
  },

  async agentTurn(apiKey, model, req) {
    const json = await fetchJson<{ model: string; choices: { message: { content: string | null; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]; refusal?: string | null }; finish_reason: string }[]; usage?: { prompt_tokens: number; completion_tokens: number } }>("openai", `${BASE}/chat/completions`, {
      method: "POST",
      headers: { ...auth(apiKey), "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: [req.system, req.context].filter(Boolean).join("\n\n") }, ...req.messages],
        tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
        max_completion_tokens: req.maxTokens ?? 16000,
      }),
      timeoutMs: 300_000,
    });
    const m = json.choices[0]?.message;
    if (!m) throw new ProviderError("openai", "OpenAI returned no message.", true);
    if (m.refusal) throw new ProviderError("openai", `The model declined: ${m.refusal}`, false);
    const toolCalls = (m.tool_calls ?? []).map((c) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {
        input = {};
      }
      return { id: c.id, name: c.function.name, input };
    });
    const units = { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 };
    return {
      append: [{ role: "assistant", content: m.content ?? "", ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) }],
      text: (m.content ?? "").trim(),
      toolCalls,
      done: toolCalls.length === 0,
      model: json.model,
      units,
      costCents: Math.round(((units.input_tokens * 1.25 + units.output_tokens * 10) / 1e6) * 10000) / 100,
    };
  },
  userMessage: (text: string) => ({ role: "user", content: text }),
  toolResults: (results: ToolResult[]) => results.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content })),

  async image(apiKey, model, req) {
    const size = SIZES[req.aspectRatio] ?? "1024x1024";
    let json: { data: { b64_json?: string }[] };
    if (req.references?.length) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", req.prompt);
      form.set("size", size);
      if (req.transparent) form.set("background", "transparent");
      for (const [i, ref] of req.references.slice(0, 10).entries()) {
        form.append("image[]", new Blob([new Uint8Array(ref.data)], { type: ref.mimeType }), `reference-${i}.${ref.mimeType.split("/")[1] ?? "png"}`);
      }
      const res = await fetch(`${BASE}/images/edits`, { method: "POST", headers: auth(apiKey), body: form, signal: AbortSignal.timeout(300_000) }).catch((e) => {
        throw new ProviderError("openai", `Couldn't reach OpenAI: ${e}`, true);
      });
      if (!res.ok) await failFrom("openai", res);
      json = await res.json();
    } else {
      json = await fetchJson("openai", `${BASE}/images/generations`, {
        method: "POST",
        headers: { ...auth(apiKey), "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: req.prompt, size, n: 1, output_format: "png", ...(req.transparent ? { background: "transparent" } : {}) }),
        timeoutMs: 300_000,
      });
    }
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("openai", "OpenAI returned no image.", true);
    return { data: Buffer.from(b64, "base64"), mimeType: "image/png", model, units: { images: 1 }, costCents: 6.3 };
  },

  async speech(apiKey, model, req) {
    const out = await fetchBinary("openai", `${BASE}/audio/speech`, {
      method: "POST",
      headers: { ...auth(apiKey), "content-type": "application/json" },
      body: JSON.stringify({ model, voice: req.voiceId || "alloy", input: req.text, response_format: "mp3", ...(req.direction ? { instructions: req.direction } : {}) }),
    });
    const minutes = Math.max(0.05, req.text.length / 900);
    return { data: out.data, mimeType: "audio/mpeg", model, units: { characters: req.text.length }, costCents: Math.round(minutes * 1.5 * 100) / 100 };
  },

  async transcribe(apiKey, model, req) {
    const form = new FormData();
    form.set("model", model);
    form.set("file", new Blob([new Uint8Array(req.audio.data)], { type: req.audio.mimeType }), "audio." + (req.audio.mimeType.split("/")[1] ?? "mp3"));
    const res = await fetch(`${BASE}/audio/transcriptions`, { method: "POST", headers: auth(apiKey), body: form, signal: AbortSignal.timeout(300_000) }).catch((e) => {
      throw new ProviderError("openai", `Couldn't reach OpenAI: ${e}`, true);
    });
    if (!res.ok) await failFrom("openai", res);
    const json = (await res.json()) as { text: string };
    return { text: json.text, model, units: { bytes: req.audio.data.length }, costCents: 0.5 };
  },

  async embed(apiKey, model, req) {
    const json = await fetchJson<{ data: { embedding: number[]; index: number }[]; usage: { total_tokens: number } }>("openai", `${BASE}/embeddings`, {
      method: "POST",
      headers: { ...auth(apiKey), "content-type": "application/json" },
      body: JSON.stringify({ model, input: req.texts }),
    });
    const vectors = json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return { vectors, model, units: { tokens: json.usage.total_tokens }, costCents: (json.usage.total_tokens * 0.02) / 1e4 };
  },
};

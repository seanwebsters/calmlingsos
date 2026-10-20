import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "@/lib/errors";
import type { AgentTurnRequest, AgentTurnResult, ProviderAdapter, TextRequest, TextResult, ToolResult } from "../types";

/** USD per million tokens [input, output]. Cache reads 0.1×, writes 1.25× input. */
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

function supportsServerFallback(model: string) {
  return /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/.test(model);
}

const clients = new Map<string, Anthropic>();
function client(apiKey: string) {
  let c = clients.get(apiKey);
  if (!c) {
    c = new Anthropic({ apiKey, maxRetries: 2 });
    clients.set(apiKey, c);
  }
  return c;
}

function mapError(err: unknown): never {
  if (err instanceof ProviderError) throw err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    throw new ProviderError("anthropic", `Anthropic rejected the API key (${err.status}).`, false, null, err.status ?? null);
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retry = Number(err.headers?.get?.("retry-after") ?? 30);
    throw new ProviderError("anthropic", "Anthropic rate limit reached.", true, (Number.isFinite(retry) ? retry : 30) * 1000, 429);
  }
  if (err instanceof Anthropic.BadRequestError) throw new ProviderError("anthropic", `Anthropic rejected the request: ${err.message.slice(0, 300)}`, false, null, 400);
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) throw new ProviderError("anthropic", `Anthropic is unavailable (${err.status}).`, true, null, err.status ?? null);
  if (err instanceof Anthropic.APIConnectionError) throw new ProviderError("anthropic", "Couldn't reach Anthropic.", true);
  throw err;
}

async function text(apiKey: string, model: string, req: TextRequest): Promise<TextResult> {
  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: "text", text: req.system }];
  if (req.context) system.push({ type: "text", text: req.context, cache_control: { type: "ephemeral" } });
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = [
    ...(req.images ?? []).flatMap((img): Anthropic.Beta.Messages.BetaContentBlockParam[] => [
      ...(img.label ? [{ type: "text" as const, text: `Image – ${img.label}:` }] : []),
      { type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType as "image/png", data: img.data.toString("base64") } },
    ]),
    { type: "text", text: req.prompt },
  ];
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content }];
  const units = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, web_searches: 0 };
  let out = "";
  let servedModel = model;
  try {
    for (let turn = 0; turn < 5; turn++) {
      const stream = client(apiKey).beta.messages.stream({
        model,
        max_tokens: req.maxTokens ?? 32000,
        system,
        messages,
        output_config: {
          effort: req.effort ?? "medium",
          ...(req.jsonSchema ? { format: { type: "json_schema", schema: req.jsonSchema } } : {}),
        },
        ...(req.webSearch ? { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }] } : {}),
        ...(supportsServerFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming);
      const msg = await stream.finalMessage();
      servedModel = msg.model;
      const u = msg.usage as unknown as Record<string, number | Record<string, number> | null>;
      units.input_tokens += Number(u.input_tokens ?? 0);
      units.output_tokens += Number(u.output_tokens ?? 0);
      units.cache_read_tokens += Number(u.cache_read_input_tokens ?? 0);
      units.cache_write_tokens += Number(u.cache_creation_input_tokens ?? 0);
      units.web_searches += Number((u.server_tool_use as Record<string, number> | null)?.web_search_requests ?? 0);
      if (msg.stop_reason === "refusal") throw new ProviderError("anthropic", "The model declined this request. Adjust the brief and retry.", false);
      if (msg.stop_reason === "max_tokens") throw new ProviderError("anthropic", "The model ran out of output room before finishing.", true);
      out += msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (msg.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: msg.content as unknown as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    }
  } catch (err) {
    mapError(err);
  }
  const [inP, outP] = PRICES[servedModel] ?? PRICES[model] ?? [5, 25];
  const usd = (units.input_tokens * inP + units.output_tokens * outP + units.cache_read_tokens * inP * 0.1 + units.cache_write_tokens * inP * 1.25) / 1e6 + units.web_searches * 0.01;
  return { text: out.trim(), model: servedModel, units, costCents: Math.round(usd * 10000) / 100 };
}

function costOf(model: string, u: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; web_searches?: number }) {
  const [inP, outP] = PRICES[model] ?? [5, 25];
  const usd = (u.input_tokens * inP + u.output_tokens * outP + u.cache_read_tokens * inP * 0.1 + u.cache_write_tokens * inP * 1.25) / 1e6 + (u.web_searches ?? 0) * 0.01;
  return Math.round(usd * 10000) / 100;
}

/**
 * One turn of a tool-using agent. The assistant content (including thinking
 * blocks) is returned unchanged so the history stays append-only.
 */
async function agentTurn(apiKey: string, model: string, req: AgentTurnRequest): Promise<AgentTurnResult> {
  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: "text", text: req.system }];
  if (req.context) system.push({ type: "text", text: req.context, cache_control: { type: "ephemeral" } });
  try {
    const stream = client(apiKey).beta.messages.stream({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system,
      messages: req.messages as Anthropic.Beta.Messages.BetaMessageParam[],
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema })),
      output_config: { effort: req.effort ?? "medium" },
      ...(supportsServerFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new ProviderError("anthropic", "The model declined this task. Rephrase the goal and retry.", false);
    const u = msg.usage as unknown as Record<string, number | null>;
    const units = { input_tokens: Number(u.input_tokens ?? 0), output_tokens: Number(u.output_tokens ?? 0), cache_read_tokens: Number(u.cache_read_input_tokens ?? 0), cache_write_tokens: Number(u.cache_creation_input_tokens ?? 0) };
    const toolCalls = msg.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : []));
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (msg.stop_reason === "max_tokens" && !toolCalls.length) throw new ProviderError("anthropic", "The agent ran out of output room.", true);
    return {
      append: [{ role: "assistant", content: msg.content }],
      text,
      toolCalls,
      done: toolCalls.length === 0 && msg.stop_reason !== "pause_turn",
      model: msg.model,
      units,
      costCents: costOf(msg.model, units),
    };
  } catch (err) {
    mapError(err);
  }
}

export const anthropicAdapter: ProviderAdapter = {
  key: "anthropic",
  async test(apiKey) {
    try {
      const page = await client(apiKey).models.list({ limit: 100 });
      const ids = page.data.map((m) => m.id);
      return { ok: true, detail: `Connected – ${ids.length} models visible.`, availableModels: ids };
    } catch (err) {
      try {
        mapError(err);
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
      return { ok: false, detail: String(err) };
    }
  },
  text,
  agentTurn,
  userMessage: (text: string) => ({ role: "user", content: text }),
  toolResults: (results: ToolResult[]) => [{ role: "user", content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content, is_error: r.isError })) }],
};

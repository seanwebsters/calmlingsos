import { ProviderError } from "@/lib/errors";

/** Map an HTTP failure to a ProviderError with the right retry semantics. */
export async function failFrom(provider: string, res: Response): Promise<never> {
  const body = (await res.text().catch(() => "")).slice(0, 400);
  const retryAfter = Number(res.headers.get("retry-after"));
  const retryable = res.status === 429 || res.status >= 500 || res.status === 408;
  const hint = res.status === 401 || res.status === 403 ? " – the API key was rejected." : res.status === 402 ? " – the account is out of credit." : "";
  throw new ProviderError(provider, `${provider} returned ${res.status}${hint} ${body}`.trim(), retryable, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null, res.status);
}

export async function fetchJson<T>(provider: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 120_000) });
  } catch (err) {
    throw new ProviderError(provider, `Couldn't reach ${provider}: ${String((err as Error).message ?? err)}`, true);
  }
  if (!res.ok) await failFrom(provider, res);
  return (await res.json()) as T;
}

export async function fetchBinary(provider: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ data: Buffer; mimeType: string; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 300_000) });
  } catch (err) {
    throw new ProviderError(provider, `Couldn't reach ${provider}: ${String((err as Error).message ?? err)}`, true);
  }
  if (!res.ok) await failFrom(provider, res);
  return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "application/octet-stream", headers: res.headers };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import { getStorage, verifyLocalSignature } from "@/lib/storage";
import { CONTENT_TYPES, fileHeaders } from "./headers";


/** Serves local-storage files behind short-lived HMAC-signed URLs. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  const dl = u.searchParams.get("dl") ?? "";
  if (!verifyLocalSignature(key, u.searchParams.get("exp") ?? "", u.searchParams.get("sig") ?? "", dl)) return new Response("Link expired or invalid", { status: 403 });
  const data = await getStorage().get(key);
  if (!data) return new Response("Not found", { status: 404 });
  const ext = key.split(".").pop()!.toLowerCase();
  const headers = fileHeaders(CONTENT_TYPES[ext], dl);
  const range = req.headers.get("range");
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [s, e] = range.slice(6).split("-");
    const start = Number(s || 0);
    const end = Math.min(e ? Number(e) : data.length - 1, data.length - 1);
    return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${data.length}`, "accept-ranges": "bytes", "content-length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "accept-ranges": "bytes", "content-length": String(data.length) } });
}

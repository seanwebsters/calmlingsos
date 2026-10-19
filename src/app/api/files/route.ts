import { getStorage, verifyLocalSignature } from "@/lib/storage";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf", zip: "application/zip", md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", json: "application/json", glb: "model/gltf-binary", gltf: "model/gltf+json", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", srt: "text/plain; charset=utf-8", csv: "text/csv" };

/** Serves local-storage files behind short-lived HMAC-signed URLs. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  const dl = u.searchParams.get("dl") ?? "";
  if (!verifyLocalSignature(key, u.searchParams.get("exp") ?? "", u.searchParams.get("sig") ?? "", dl)) return new Response("Link expired or invalid", { status: 403 });
  const data = await getStorage().get(key);
  if (!data) return new Response("Not found", { status: 404 });
  const ext = key.split(".").pop()!.toLowerCase();
  const headers: Record<string, string> = {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "cache-control": "private, max-age=3000",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self' data:",
  };
  if (dl) headers["content-disposition"] = `attachment; filename="${dl.replace(/[^a-zA-Z0-9._-]/g, "_")}"`;
  const range = req.headers.get("range");
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [s, e] = range.slice(6).split("-");
    const start = Number(s || 0);
    const end = Math.min(e ? Number(e) : data.length - 1, data.length - 1);
    return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${data.length}`, "accept-ranges": "bytes", "content-length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "accept-ranges": "bytes", "content-length": String(data.length) } });
}

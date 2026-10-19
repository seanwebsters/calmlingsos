export const CONTENT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf", zip: "application/zip", md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", json: "application/json", glb: "model/gltf-binary", gltf: "model/gltf+json", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", srt: "text/plain; charset=utf-8", csv: "text/csv" };

export function fileHeaders(contentType: string | undefined, download: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": contentType ?? "application/octet-stream",
    "cache-control": "private, max-age=3000",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self' data:",
  };
  if (download) h["content-disposition"] = `attachment; filename="${download.replace(/[^a-zA-Z0-9._-]/g, "_")}"`;
  return h;
}

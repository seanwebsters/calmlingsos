import "server-only";

/** Extract readable text from documents. Returns null when the format holds no text we can read. */
export async function extractText(buf: Buffer, mimeType: string): Promise<{ text: string; pages?: number } | null> {
  if (mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "text/csv") return { text: buf.toString("utf8") };
  if (mimeType === "application/json") {
    try {
      return { text: JSON.stringify(JSON.parse(buf.toString("utf8")), null, 2) };
    } catch {
      return { text: buf.toString("utf8") };
    }
  }
  if (mimeType === "application/pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text } = await pdfText(pdf, { mergePages: true });
    return { text: Array.isArray(text) ? text.join("\n") : text, pages: totalPages };
  }
  if (mimeType.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer: buf });
    return { text: res.value };
  }
  return null;
}

/** Summary of a glTF / GLB file without a full 3D runtime. */
export function inspectGltf(buf: Buffer, mimeType: string): Record<string, number | string> {
  let json: Record<string, unknown[] | Record<string, unknown>>;
  if (mimeType === "model/gltf-binary") {
    const jsonLen = buf.readUInt32LE(12);
    json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  } else {
    json = JSON.parse(buf.toString("utf8"));
  }
  const count = (k: string) => (Array.isArray(json[k]) ? (json[k] as unknown[]).length : 0);
  const asset = (json.asset ?? {}) as Record<string, string>;
  return { gltfVersion: asset.version ?? "unknown", generator: asset.generator ?? "unknown", meshes: count("meshes"), materials: count("materials"), textures: count("textures"), animations: count("animations"), nodes: count("nodes"), skins: count("skins") };
}

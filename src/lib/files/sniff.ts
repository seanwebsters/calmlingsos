/**
 * Content-based file type detection. The declared MIME type and extension
 * are never trusted on their own: the bytes must agree.
 */
export type MediaKind = "image" | "video" | "audio" | "document" | "model3d" | "archive" | "data";

export interface Sniffed {
  mimeType: string;
  ext: string;
  mediaKind: MediaKind;
}

const EXT_ALLOWED = ["png", "jpg", "jpeg", "webp", "svg", "gif", "mp4", "mov", "m4v", "mp3", "wav", "pdf", "docx", "txt", "md", "markdown", "json", "zip", "glb", "gltf", "csv"];
export const ACCEPT_ATTR = EXT_ALLOWED.map((e) => "." + e).join(",");

function ascii(buf: Buffer, start: number, len: number) {
  return buf.subarray(start, start + len).toString("latin1");
}

function isUtf8Text(buf: Buffer): boolean {
  const sample = buf.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.length < buf.length ? sample.subarray(0, sample.lastIndexOf(0x0a) > 0 ? sample.lastIndexOf(0x0a) : sample.length) : sample);
    return true;
  } catch {
    return false;
  }
}

export function sniff(buf: Buffer, filename: string): Sniffed | null {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (!EXT_ALLOWED.includes(ext)) return null;
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return { mimeType: "image/png", ext: "png", mediaKind: "image" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mimeType: "image/jpeg", ext: "jpg", mediaKind: "image" };
  if (ascii(buf, 0, 4) === "GIF8") return { mimeType: "image/gif", ext: "gif", mediaKind: "image" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return { mimeType: "image/webp", ext: "webp", mediaKind: "image" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WAVE") return { mimeType: "audio/wav", ext: "wav", mediaKind: "audio" };
  if (ascii(buf, 0, 5) === "%PDF-") return { mimeType: "application/pdf", ext: "pdf", mediaKind: "document" };
  if (ascii(buf, 0, 4) === "glTF") return { mimeType: "model/gltf-binary", ext: "glb", mediaKind: "model3d" };
  if (ascii(buf, 4, 4) === "ftyp") {
    const brand = ascii(buf, 8, 4);
    if (brand === "qt  ") return { mimeType: "video/quicktime", ext: "mov", mediaKind: "video" };
    if (/^M4A /.test(brand)) return { mimeType: "audio/mp4", ext: "m4a", mediaKind: "audio" };
    return { mimeType: "video/mp4", ext: "mp4", mediaKind: "video" };
  }
  if (ascii(buf, 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mimeType: "audio/mpeg", ext: "mp3", mediaKind: "audio" };
  if (buf.readUInt32BE(0) === 0x504b0304) {
    if (ext === "docx") return { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx", mediaKind: "document" };
    return { mimeType: "application/zip", ext: "zip", mediaKind: "archive" };
  }
  if (isUtf8Text(buf)) {
    const head = buf.subarray(0, 2048).toString("utf8").trimStart();
    if (ext === "svg" && /<svg[\s>]/i.test(buf.subarray(0, 64 * 1024).toString("utf8"))) return { mimeType: "image/svg+xml", ext: "svg", mediaKind: "image" };
    if (ext === "gltf") return { mimeType: "model/gltf+json", ext: "gltf", mediaKind: "model3d" };
    if (ext === "json" && (head.startsWith("{") || head.startsWith("["))) return { mimeType: "application/json", ext: "json", mediaKind: "data" };
    if (ext === "csv") return { mimeType: "text/csv", ext: "csv", mediaKind: "data" };
    if (ext === "md" || ext === "markdown") return { mimeType: "text/markdown", ext: "md", mediaKind: "document" };
    if (ext === "txt") return { mimeType: "text/plain", ext: "txt", mediaKind: "document" };
  }
  return null;
}

/** Best-guess asset type from file kind and name; always editable by the user. */
export function guessAssetType(mediaKind: MediaKind, filename: string): string {
  const n = filename.toLowerCase();
  const has = (...w: string[]) => w.some((x) => n.includes(x));
  if (mediaKind === "image") {
    if (has("turnaround", "turn-around")) return "turnaround";
    if (has("expression")) return "expression_sheet";
    if (has("storyboard", "board")) return "storyboard";
    if (has("sprite", "atlas")) return "game_sprite";
    if (has("screenshot", "screen")) return "game_screenshot";
    if (has("logo")) return "logo";
    if (has("background", "bg", "environment", "env")) return "background_environment";
    if (has("mockup", "product", "plush")) return "product_mockup";
    return "character_render";
  }
  if (mediaKind === "video") return has("anim") ? "animation_clip" : "social_video";
  if (mediaKind === "audio") return has("voice", "vo_", "vox") ? "voice_recording" : "music_reference";
  if (mediaKind === "document") {
    if (has("brand", "guideline")) return "brand_guidelines";
    if (has("script")) return "script";
    return "character_description";
  }
  if (mediaKind === "model3d") return "model_3d";
  return "other";
}

export const ASSET_TYPES: { value: string; label: string }[] = [
  { value: "character_render", label: "Official character render" },
  { value: "turnaround", label: "Turnaround" },
  { value: "expression_sheet", label: "Expression sheet" },
  { value: "animation_clip", label: "Animation clip" },
  { value: "social_video", label: "Existing social video" },
  { value: "storyboard", label: "Storyboard" },
  { value: "game_screenshot", label: "Game screenshot" },
  { value: "game_sprite", label: "Game sprite" },
  { value: "background_environment", label: "Background / environment" },
  { value: "brand_guidelines", label: "Brand guidelines" },
  { value: "script", label: "Script" },
  { value: "character_description", label: "Character description" },
  { value: "product_mockup", label: "Product mockup" },
  { value: "logo", label: "Logo" },
  { value: "music_reference", label: "Music reference" },
  { value: "voice_recording", label: "Voice recording" },
  { value: "model_3d", label: "3D model" },
  { value: "other", label: "Other" },
];

export const VIEW_ANGLES = ["front", "side", "rear", "three_quarter", "face_closeup", "expression", "pose", "accessory", "environment_interaction"] as const;

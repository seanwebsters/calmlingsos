import { getViewer } from "@/lib/auth/session";
import { getStorage, keyBelongsToOrg } from "@/lib/storage";
import { CONTENT_TYPES, fileHeaders } from "../headers";

/** Serves database-stored files to signed-in members of the owning organisation. */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in required", { status: 401 });
  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  if (!keyBelongsToOrg(key, viewer.orgId)) return new Response("Not found", { status: 404 });
  const data = await getStorage().get(key);
  if (!data) return new Response("Not found", { status: 404 });
  const ext = key.split(".").pop()!.toLowerCase();
  return new Response(new Uint8Array(data), { headers: { ...fileHeaders(CONTENT_TYPES[ext], u.searchParams.get("dl") ?? ""), "content-length": String(data.length) } });
}

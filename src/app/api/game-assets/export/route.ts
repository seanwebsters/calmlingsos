import { and, eq, inArray } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { getDb, schema } from "@/db";
import { route } from "@/lib/http";
import { getStorage } from "@/lib/storage";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";

/** Export bundle of technically validated game assets for a collection. */
export const GET = route("export:create", async ({ req, viewer }) => {
  const collection = new URL(req.url).searchParams.get("collection");
  const db = await getDb();
  const rows = await db.select().from(schema.gameAssets).where(and(eq(schema.gameAssets.orgId, viewer.orgId), inArray(schema.gameAssets.status, ["technically_validated", "approved"]), collection ? eq(schema.gameAssets.collection, collection) : undefined));
  if (!rows.length) throw new AppError("No technically validated assets to export.");
  const files: Record<string, Uint8Array> = {};
  for (const r of rows) {
    const d = r.storageKey ? await getStorage().get(r.storageKey) : null;
    if (d) files[`${r.collection}/${r.name}`] = new Uint8Array(d);
  }
  files["manifest.json"] = strToU8(JSON.stringify(rows.map((r) => ({ name: r.name, collection: r.collection, status: r.status, spec: r.spec, validation: r.validation })), null, 2));
  await audit({ orgId: viewer.orgId, actorUserId: viewer.userId, action: "game.exported", targetType: "game_collection", targetId: collection ?? "all", data: { count: rows.length } });
  return new Response(new Uint8Array(zipSync(files)), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="game-assets-${collection ?? "all"}.zip"` } });
});

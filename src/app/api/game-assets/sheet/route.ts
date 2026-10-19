import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { getDb, schema } from "@/db";
import { body, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";
import { AppError } from "@/lib/errors";
import { GAME_EXPORTERS } from "@/lib/game/exporters";

/** Sprite sheet / atlas preparation from validated assets (with optional resize). Returns a ZIP. */
export const POST = route("export:create", async ({ req, viewer }) => {
  const b = await body(req, z.object({ ids: z.array(z.string()).min(1).max(256), cell: z.number().int().min(8).max(2048).optional(), columns: z.number().int().min(1).max(64).optional(), padding: z.number().int().min(0).max(32).default(2) }));
  const db = await getDb();
  const rows = await db.select().from(schema.gameAssets).where(and(eq(schema.gameAssets.orgId, viewer.orgId), inArray(schema.gameAssets.id, b.ids)));
  if (!rows.length) throw new AppError("No assets selected.");
  const cell = b.cell ?? Math.max(...rows.map((r) => r.spec.width));
  const cols = b.columns ?? Math.ceil(Math.sqrt(rows.length));
  const rowsN = Math.ceil(rows.length / cols);
  const pad = b.padding;
  const tiles = await Promise.all(rows.map(async (r) => sharp((await getStorage().get(r.storageKey!))!).resize(cell, cell, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()));
  const W = cols * (cell + pad) + pad;
  const H = rowsN * (cell + pad) + pad;
  const frames = rows.map((_, i) => ({ x: pad + (i % cols) * (cell + pad), y: pad + Math.floor(i / cols) * (cell + pad), w: cell, h: cell }));
  const sheet = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(tiles.map((t, i) => ({ input: t, left: frames[i].x, top: frames[i].y }))).png({ compressionLevel: 9 }).toBuffer();
  const exporter = GAME_EXPORTERS[0];
  const atlas = exporter.build!([{ name: "atlas.png", data: sheet, width: W, height: H, frames }]);
  const names = Object.fromEntries(rows.map((r, i) => [r.name.replace(/\.[^.]+$/, ""), frames[i]]));
  const zip = zipSync({ "atlas.png": new Uint8Array(sheet), "atlas.json": strToU8(String(atlas["atlas.json"])), "frames-by-name.json": strToU8(JSON.stringify(names, null, 2)) });
  return new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="calmlings-atlas.zip"' } });
});

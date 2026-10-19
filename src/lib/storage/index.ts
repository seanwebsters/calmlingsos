/**
 * Object storage. Keys are always namespaced by organisation
 * (`orgs/<orgId>/…`) so tenants can never address each other's files.
 *  - local: files under DATA_DIR/storage, served through short-lived HMAC-signed URLs
 *  - s3:    any S3-compatible store (AWS S3, Cloudflare R2, MinIO…) with presigned GETs
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env";
import { hmac, safeEqual } from "@/lib/crypto";
import { IntegrationRequiredError } from "@/lib/errors";

export interface StorageProvider {
  readonly name: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  /** A URL the browser can fetch for `ttlSeconds`. */
  signedUrl(key: string, opts?: { ttlSeconds?: number; download?: string }): Promise<string>;
}

export function orgKey(orgId: string, ...parts: string[]): string {
  const clean = parts.map((p) => p.replace(/[^a-zA-Z0-9._-]/g, "_"));
  return ["orgs", orgId, ...clean].join("/");
}

export function keyBelongsToOrg(key: string, orgId: string): boolean {
  return key.startsWith(`orgs/${orgId}/`) && !key.includes("..");
}

class LocalStorage implements StorageProvider {
  readonly name = "local" as const;
  private root = path.join(env.dataDir, "storage");
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, data);
  }
  async get(key: string) {
    try {
      return await fs.promises.readFile(this.resolve(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async remove(key: string) {
    await fs.promises.rm(this.resolve(key), { force: true });
  }
  async signedUrl(key: string, opts: { ttlSeconds?: number; download?: string } = {}) {
    return localSignedUrl(key, opts);
  }
}

export function localSignedUrl(key: string, opts: { ttlSeconds?: number; download?: string } = {}) {
  const exp = Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 3600);
  const dl = opts.download ?? "";
  const sig = hmac(`${key}\n${exp}\n${dl}`);
  const q = new URLSearchParams({ key, exp: String(exp), sig });
  if (dl) q.set("dl", dl);
  return `/api/files?${q.toString()}`;
}

export function verifyLocalSignature(key: string, exp: string, sig: string, dl = ""): boolean {
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(hmac(`${key}\n${exp}\n${dl}`), sig);
}

class S3Storage implements StorageProvider {
  readonly name = "s3" as const;
  private client: AwsClient;
  private base: string;
  constructor() {
    const s = env.s3;
    if (!s.endpoint || !s.bucket || !s.accessKeyId || !s.secretAccessKey) {
      throw new IntegrationRequiredError("storage:s3", "STORAGE_BACKEND=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
    }
    this.client = new AwsClient({ accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, service: "s3", region: s.region });
    const ep = s.endpoint.replace(/\/$/, "");
    this.base = s.forcePathStyle ? `${ep}/${s.bucket}` : ep.replace("://", `://${s.bucket}.`);
  }
  private url(key: string) {
    return `${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  async put(key: string, data: Buffer, contentType: string) {
    const res = await this.client.fetch(this.url(key), { method: "PUT", body: new Uint8Array(data), headers: { "content-type": contentType } });
    if (!res.ok) throw new Error(`Object storage upload failed (${res.status})`);
  }
  async get(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Object storage read failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  async remove(key: string) {
    await this.client.fetch(this.url(key), { method: "DELETE" });
  }
  async signedUrl(key: string, opts: { ttlSeconds?: number; download?: string } = {}) {
    const u = new URL(this.url(key));
    u.searchParams.set("X-Amz-Expires", String(opts.ttlSeconds ?? 3600));
    if (opts.download) u.searchParams.set("response-content-disposition", `attachment; filename="${opts.download.replace(/"/g, "")}"`);
    const signed = await this.client.sign(u.toString(), { method: "GET", aws: { signQuery: true } });
    return signed.url;
  }
}

const g = globalThis as unknown as { __calmlingsStorage?: StorageProvider };

export function getStorage(): StorageProvider {
  if (!g.__calmlingsStorage) g.__calmlingsStorage = env.storageBackend === "s3" ? new S3Storage() : new LocalStorage();
  return g.__calmlingsStorage;
}

export function setStorage(s: StorageProvider | undefined) {
  g.__calmlingsStorage = s;
}

export async function urlFor(key: string | null | undefined, opts?: { ttlSeconds?: number; download?: string }): Promise<string | null> {
  if (!key) return null;
  return getStorage().signedUrl(key, opts);
}

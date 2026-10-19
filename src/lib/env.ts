/**
 * Typed access to server configuration. Secrets are read only on the server;
 * nothing here is ever imported by client components.
 */
import "server-only";
import path from "node:path";

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

const isProd = process.env.NODE_ENV === "production";

export const env = {
  isProd,
  isTest: process.env.NODE_ENV === "test" || Boolean(process.env.VITEST),
  /** postgres://… for PostgreSQL; unset (or pglite:<dir>) for the embedded PGlite database. */
  databaseUrl: opt("DATABASE_URL"),
  dataDir: path.resolve(opt("DATA_DIR") ?? opt("RAILWAY_VOLUME_MOUNT_PATH") ?? ".data"),

  /** Signs asset URLs and session cookies. Required in production. */
  get appSecret(): string {
    const v = opt("APP_SECRET");
    if (v) return v;
    if (isProd && process.env.NEXT_PHASE !== "phase-production-build") {
      throw new Error("APP_SECRET must be set in production (32+ random bytes, e.g. `openssl rand -hex 32`).");
    }
    return "dev-only-insecure-app-secret-change-me";
  },
  /** 32-byte key (hex or base64) used to encrypt provider credentials stored in the database. */
  credentialsKey: opt("CREDENTIALS_ENCRYPTION_KEY"),

  storageBackend: (opt("STORAGE_BACKEND") ?? "local") as "local" | "s3",
  s3: {
    endpoint: opt("S3_ENDPOINT"),
    region: opt("S3_REGION") ?? "auto",
    bucket: opt("S3_BUCKET"),
    accessKeyId: opt("S3_ACCESS_KEY_ID"),
    secretAccessKey: opt("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: opt("S3_FORCE_PATH_STYLE") !== "false",
  },

  /** Optional ClamAV daemon for malware scanning of uploads (host:port). */
  clamavAddress: opt("CLAMAV_ADDRESS"),

  /** Run the background worker inside the web process (default on). */
  inProcessWorker: opt("IN_PROCESS_WORKER") !== "off",

  /** Provider keys from the environment (take precedence over stored credentials). */
  providerEnv: {
    anthropic: opt("ANTHROPIC_API_KEY"),
    openai: opt("OPENAI_API_KEY"),
    google: opt("GEMINI_API_KEY") ?? opt("GOOGLE_API_KEY"),
    fal: opt("FAL_KEY") ?? opt("FAL_API_KEY"),
    elevenlabs: opt("ELEVENLABS_API_KEY"),
  } as Record<string, string | undefined>,

  publicUrl: opt("PUBLIC_URL") ?? opt("RAILWAY_PUBLIC_DOMAIN") ?? null,
};

/** Human-readable problems with this deployment's persistence, shown in Mission Control. */
export function deploymentWarnings(): string[] {
  const w: string[] = [];
  if (!env.databaseUrl || env.databaseUrl.startsWith("pglite:")) {
    w.push(
      isProd
        ? "Running on the embedded PGlite database. Set DATABASE_URL to a managed PostgreSQL instance for production."
        : "Using the embedded PGlite database in DATA_DIR (fine for local work). Set DATABASE_URL for PostgreSQL.",
    );
  }
  if (env.storageBackend === "local" && isProd) w.push("Files are stored on local disk. Mount a persistent volume at DATA_DIR or configure S3-compatible storage.");
  if (!env.credentialsKey) w.push("CREDENTIALS_ENCRYPTION_KEY is not set, so provider keys can only be supplied through environment variables.");
  if (!env.clamavAddress) w.push("No malware scanner is configured (CLAMAV_ADDRESS). Uploads are type-validated but not virus-scanned.");
  return w;
}

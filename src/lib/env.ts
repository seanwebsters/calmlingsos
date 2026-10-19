/**
 * Typed access to server configuration. Secrets are read only on the server;
 * nothing here is ever imported by client components.
 */
import "server-only";
import path from "node:path";
import { randomBytes } from "node:crypto";

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

const isProd = process.env.NODE_ENV === "production";
/** Serverless hosts (Vercel): read-only filesystem except /tmp, no long-lived processes. */
const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let ephemeralSecret: string | null = null;

export const env = {
  isProd,
  serverless,
  isTest: process.env.NODE_ENV === "test" || Boolean(process.env.VITEST),
  /** postgres://… for PostgreSQL; unset (or pglite:<dir>) for the embedded PGlite database. */
  databaseUrl: opt("DATABASE_URL") ?? opt("POSTGRES_URL"),
  dataDir: path.resolve(opt("DATA_DIR") ?? opt("RAILWAY_VOLUME_MOUNT_PATH") ?? (serverless ? "/tmp/calmlings-os" : ".data")),

  /** Signs asset URLs and session cookies. Required in production. */
  get appSecret(): string {
    const v = opt("APP_SECRET");
    if (v) return v;
    if (isProd && process.env.NEXT_PHASE !== "phase-production-build") {
      // Never fall back to a guessable secret. A per-process random secret keeps the app
      // working; only signed local-disk file links are affected (they expire on restart).
      if (!ephemeralSecret) {
        ephemeralSecret = randomBytes(32).toString("hex");
        console.warn(JSON.stringify({ level: "warn", scope: "env", message: "APP_SECRET is not set – using a temporary random secret. Set APP_SECRET (openssl rand -hex 32)." }));
      }
      return ephemeralSecret;
    }
    return "dev-only-insecure-app-secret-change-me";
  },
  /** 32-byte key (hex or base64) used to encrypt provider credentials stored in the database. */
  credentialsKey: opt("CREDENTIALS_ENCRYPTION_KEY"),

  /** local disk, any S3-compatible store, or the database (default on serverless hosts without S3). */
  storageBackend: (opt("STORAGE_BACKEND") ?? (opt("S3_BUCKET") ? "s3" : serverless ? "db" : "local")) as "local" | "s3" | "db",
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

  /**
   * Sign-in: "open" (default) – no login; everyone who can reach the app acts as the
   * studio owner. "required" – email/password sign-in with roles.
   */
  authMode: (opt("AUTH_MODE") === "required" ? "required" : "open") as "open" | "required",

  /** Run the background worker inside the web process (default on). */
  inProcessWorker: opt("IN_PROCESS_WORKER") ? opt("IN_PROCESS_WORKER") !== "off" : !serverless,
  /** Secret for /api/jobs/tick when called by a scheduler (Authorization: Bearer …). */
  cronSecret: opt("CRON_SECRET"),

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
      serverless
        ? "TEMPORARY DATABASE: no DATABASE_URL is set, so this deployment uses a built-in database in /tmp. Everything resets when the server restarts, and each serverless instance has its own copy (you may be asked to set up again). Add a PostgreSQL DATABASE_URL (e.g. Vercel → Storage → Neon Postgres) and redeploy."
        : isProd
          ? "Running on the embedded PGlite database. Set DATABASE_URL to a managed PostgreSQL instance for production."
          : "Using the embedded PGlite database in DATA_DIR (fine for local work). Set DATABASE_URL for PostgreSQL.",
    );
  }
  if (env.storageBackend === "local" && isProd) w.push("Files are stored on local disk. Mount a persistent volume at DATA_DIR or configure S3-compatible storage.");
  if (env.storageBackend === "db") w.push("Files are stored inside the database (fine to start; configure S3-compatible storage for large libraries).");
  if (serverless) w.push("Serverless host: uploads are limited to ~4 MB per request and background jobs run in short bursts while the app is open. Long video generation is more reliable on a host with a persistent worker (Railway/Docker).");
  if (env.authMode === "open") w.push("Sign-in is off (AUTH_MODE=open): anyone who can reach this URL has full owner access. Set AUTH_MODE=required to require sign-in.");
  if (isProd && !opt("APP_SECRET")) w.push("APP_SECRET is not set – a temporary secret is in use. Set APP_SECRET (openssl rand -hex 32).");
  if (!env.credentialsKey) w.push("CREDENTIALS_ENCRYPTION_KEY is not set, so provider keys can only be supplied through environment variables.");
  if (!env.clamavAddress) w.push("No malware scanner is configured (CLAMAV_ADDRESS). Uploads are type-validated but not virus-scanned.");
  return w;
}

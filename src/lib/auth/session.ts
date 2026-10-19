import "server-only";
import { cookies } from "next/headers";
import { and, asc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { randomToken, sha256 } from "@/lib/crypto";
import { forbidden, unauthorized } from "@/lib/errors";
import { can, type Permission, type Role } from "./permissions";

export const SESSION_COOKIE = "cos_session";
const SESSION_DAYS = 14;

export interface Viewer {
  userId: string;
  name: string;
  email: string;
  orgId: string;
  orgName: string;
  role: Role;
}

export async function createSession(userId: string, orgId: string): Promise<string> {
  const db = await getDb();
  const token = randomToken();
  await db.insert(schema.sessions).values({
    id: newId("ses"),
    tokenHash: sha256(token),
    userId,
    orgId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
  });
  return token;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.isProd && !process.env.INSECURE_COOKIES, path: "/", maxAge: SESSION_DAYS * 86400 });
}

export async function viewerFromToken(token: string | undefined | null): Promise<Viewer | null> {
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ s: schema.sessions, u: schema.users, o: schema.organisations, m: schema.memberships })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.organisations, eq(schema.organisations.id, schema.sessions.orgId))
    .innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.users.id), eq(schema.memberships.orgId, schema.organisations.id)))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r || r.u.disabled) return null;
  return { userId: r.u.id, name: r.u.name, email: r.u.email, orgId: r.o.id, orgName: r.o.name, role: r.m.role as Role };
}

export async function getViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  const fromSession = await viewerFromToken(jar.get(SESSION_COOKIE)?.value);
  if (fromSession || env.authMode !== "open") return fromSession;
  return openModeViewer();
}

/**
 * AUTH_MODE=open: no sign-in. Requests act as the owner of the studio, which is
 * created automatically the first time the app is opened.
 */
async function openModeViewer(): Promise<Viewer> {
  const db = await getDb();
  const find = async () => {
    const [r] = await db
      .select({ u: schema.users, o: schema.organisations, m: schema.memberships })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.memberships.orgId))
      .where(eq(schema.memberships.role, "owner"))
      .orderBy(asc(schema.memberships.createdAt))
      .limit(1);
    return r ? { userId: r.u.id, name: r.u.name, email: r.u.email, orgId: r.o.id, orgName: r.o.name, role: "owner" as Role } : null;
  };
  const existing = await find();
  if (existing) return existing;
  const { bootstrap } = await import("@/lib/org");
  try {
    await bootstrap({ orgName: "Calmlings Studio", name: "Creative Director", email: "studio@calmlings.local", password: randomToken(24) });
  } catch {
    // Another request created it at the same time.
  }
  const created = await find();
  if (!created) throw new Error("Could not create the default studio.");
  return created;
}

export async function requireViewer(permission?: Permission): Promise<Viewer> {
  const v = await getViewer();
  if (!v) throw unauthorized();
  if (permission && !can(v.role, permission)) throw forbidden(`Your role (${v.role.replace("_", " ")}) can't do this – it needs “${permission}”.`);
  return v;
}

export function assertCan(v: Viewer, permission: Permission) {
  if (!can(v.role, permission)) throw forbidden(`Your role (${v.role.replace("_", " ")}) can't do this – it needs “${permission}”.`);
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

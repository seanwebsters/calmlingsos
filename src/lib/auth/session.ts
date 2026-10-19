import "server-only";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
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
  return viewerFromToken(jar.get(SESSION_COOKIE)?.value);
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

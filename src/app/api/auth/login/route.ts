import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { verifyPassword } from "@/lib/crypto";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { audit } from "@/lib/audit";

const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  try {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(await req.json());
    const key = email.toLowerCase();
    const a = attempts.get(key);
    if (a && a.until > Date.now()) throw new AppError("Too many attempts. Try again in a few minutes.", 429, "rate_limited");
    const db = await getDb();
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, key));
    const ok = user && !user.disabled && (await verifyPassword(password, user.passwordHash));
    if (!ok) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
      throw new AppError("Email or password is incorrect.", 401, "unauthorized");
    }
    attempts.delete(key);
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id));
    if (!m) throw new AppError("This account isn't a member of any studio.", 403, "forbidden");
    await setSessionCookie(await createSession(user.id, m.orgId));
    await audit({ orgId: m.orgId, actorUserId: user.id, action: "auth.login", targetType: "user", targetId: user.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

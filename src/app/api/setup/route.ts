import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/org";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { errorResponse } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const { orgId, userId } = await bootstrap(await req.json());
    await setSessionCookie(await createSession(userId, orgId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError } from "./errors";
import { requireViewer, type Viewer } from "./auth/session";
import type { Permission } from "./auth/permissions";

type Ctx<P> = { params: Promise<P> };

/**
 * Route handler wrapper: authentication, permission check, consistent JSON
 * errors. Integration and budget errors keep their codes so the UI can show
 * a setup action instead of a generic failure.
 */
export function route<P = Record<string, string>>(
  permission: Permission | null,
  handler: (args: { req: Request; viewer: Viewer; params: P }) => Promise<unknown>,
) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const viewer = await requireViewer(permission ?? undefined);
      const params = (await ctx?.params) ?? ({} as P);
      const out = await handler({ req, viewer, params });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json({ error: err.message, code: err.code, details: err.details ?? null }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Some fields are invalid.", code: "validation", details: err.issues }, { status: 400 });
  }
  console.error(JSON.stringify({ level: "error", scope: "api", message: String(err), stack: (err as Error)?.stack }));
  return NextResponse.json({ error: "Something went wrong on the server.", code: "internal" }, { status: 500 });
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("Expected a JSON body.");
  }
  return schema.parse(raw);
}

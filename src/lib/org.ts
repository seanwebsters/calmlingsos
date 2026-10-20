import "server-only";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { OrgSettings } from "@/db/schema";
import { newId, slugify } from "./ids";
import { hashPassword } from "./crypto";
import { audit } from "./audit";
import { AppError, conflict } from "./errors";

export const DEFAULT_SETTINGS: OrgSettings = {
  defaultProductionBudgetCents: 2500,
  monthlyBudgetCents: 50000,
  retentionDays: 0,
  maxUploadMb: 250,
  requirePlanApproval: true,
};

export async function getOrgSettings(orgId: string): Promise<OrgSettings> {
  const db = await getDb();
  const [o] = await db.select({ settings: schema.organisations.settings }).from(schema.organisations).where(eq(schema.organisations.id, orgId));
  return { ...DEFAULT_SETTINGS, ...(o?.settings ?? {}) };
}

export const settingsSchema = z.object({
  defaultProductionBudgetCents: z.number().int().min(0).max(10_000_000),
  monthlyBudgetCents: z.number().int().min(0).max(100_000_000),
  retentionDays: z.number().int().min(0).max(3650),
  maxUploadMb: z.number().int().min(1).max(2048),
  requirePlanApproval: z.boolean(),
  officeSkin: z
    .object({ theme: z.string().max(40), prompt: z.string().max(1000).nullable(), floorKey: z.string().nullable(), wallKey: z.string().nullable(), rugKey: z.string().nullable(), provider: z.string().nullable(), model: z.string().nullable(), generatedAt: z.string().nullable() })
    .optional(),
});

export async function updateOrgSettings(orgId: string, userId: string, patch: Partial<OrgSettings>) {
  const current = await getOrgSettings(orgId);
  const next = settingsSchema.parse({ ...current, ...patch });
  const db = await getDb();
  await db.update(schema.organisations).set({ settings: next }).where(eq(schema.organisations.id, orgId));
  await audit({ orgId, actorUserId: userId, action: "org.settings_updated", targetType: "organisation", targetId: orgId, data: patch });
  return next;
}

export async function needsSetup(): Promise<boolean> {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(schema.users);
  return (r?.n ?? 0) === 0;
}

export const setupSchema = z.object({
  orgName: z.string().min(2).max(120),
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
});

/** First-run setup: creates the organisation and its owner. Refuses once any user exists. */
export async function bootstrap(raw: unknown): Promise<{ orgId: string; userId: string }> {
  const input = setupSchema.parse(raw);
  if (!(await needsSetup())) throw conflict("This installation is already set up. Sign in instead.");
  const db = await getDb();
  const orgId = newId("org");
  const userId = newId("usr");
  await db.transaction(async (tx) => {
    await tx.insert(schema.organisations).values({ id: orgId, name: input.orgName, slug: slugify(input.orgName) || orgId, settings: DEFAULT_SETTINGS });
    await tx.insert(schema.users).values({ id: userId, email: input.email.toLowerCase(), name: input.name, passwordHash: await hashPassword(input.password) });
    await tx.insert(schema.memberships).values({ id: newId("mem"), orgId, userId, role: "owner" });
    await audit({ orgId, actorUserId: userId, action: "org.created", targetType: "organisation", targetId: orgId }, tx);
  });
  return { orgId, userId };
}

export const memberSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(10).max(200),
  role: z.enum(["owner", "creative_director", "producer", "contributor", "viewer"]),
});

export async function addMember(orgId: string, actorId: string, raw: unknown) {
  const input = memberSchema.parse(raw);
  const db = await getDb();
  const email = input.email.toLowerCase();
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) {
    const id = newId("usr");
    await db.insert(schema.users).values({ id, email, name: input.name, passwordHash: await hashPassword(input.password) });
    [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  }
  const existing = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id));
  if (existing.some((m) => m.orgId === orgId)) throw new AppError("That person is already a member.");
  await db.insert(schema.memberships).values({ id: newId("mem"), orgId, userId: user.id, role: input.role });
  await audit({ orgId, actorUserId: actorId, action: "member.added", targetType: "user", targetId: user.id, data: { role: input.role } });
  return user.id;
}

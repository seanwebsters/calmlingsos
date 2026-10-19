import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { ReactNode } from "react";
import { getDb, schema } from "@/db";
import type { Viewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listCharacters } from "@/lib/brain/characters";
import { listReferences } from "@/lib/brain/references";
import { getOrgSettings } from "@/lib/org";
import { listTemplates } from "@/lib/workflows/registry";
import { BriefForm } from "./brief-form";
import { Card, Empty, PageHeader, SectionTitle, Status } from "@/components/ui";
import { timeAgo, usd } from "@/lib/cn";

export async function StudioPage({ viewer, eyebrow, title, sub, departments, templateKeys, children, aside }: { viewer: Viewer; eyebrow: string; title: string; sub: string; departments: string[]; templateKeys: string[]; children?: ReactNode; aside?: ReactNode }) {
  const db = await getDb();
  const [chars, templates, settings, productions] = await Promise.all([
    listCharacters(viewer.orgId),
    listTemplates(viewer.orgId),
    getOrgSettings(viewer.orgId),
    db.select().from(schema.productions).where(and(eq(schema.productions.orgId, viewer.orgId), inArray(schema.productions.department, departments))).orderBy(desc(schema.productions.updatedAt)).limit(30),
  ]);
  const mine = templates.filter((t) => templateKeys.includes(t.key) || (!t.builtIn && departments.includes(t.department)));
  const refs = mine.some((t) => t.briefSchema === "character") ? (await listReferences(viewer.orgId, { limit: 200 })).filter((r) => r.mediaKind === "image" && r.designation !== "rejected") : undefined;
  return (
    <div>
      <PageHeader eyebrow={eyebrow} title={title} sub={sub} />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {can(viewer.role, "production:create") ? (
            mine.map((t) => (
              <Card key={t.key}>
                <SectionTitle title={t.name} sub={t.description} action={<Link href={`/agents?tab=workflows&key=${t.key}`} className="link text-xs">Pipeline →</Link>} />
                <BriefForm templateKey={t.key} templateName={t.name} briefSchema={t.briefSchema} characters={chars.map((c) => ({ id: c.id, name: c.name, approved: Boolean(c.approvedVersionId) }))} references={refs?.map((r) => ({ id: r.id, title: r.title }))} defaultBudgetCents={settings.defaultProductionBudgetCents} />
              </Card>
            ))
          ) : (
            <Empty title="Read-only">Your role can view productions but not start them.</Empty>
          )}
          {children}
        </div>
        <div className="space-y-6">
          <Card>
            <SectionTitle title="Productions" />
            {productions.length === 0 ? <p className="text-sm text-mist-400">None yet.</p> : (
              <div className="divide-y divide-white/[0.05]">
                {productions.map((p) => (
                  <Link key={p.id} href={`/productions/${p.id}`} className="flex items-center gap-3 py-2.5 hover:bg-white/[0.02]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-white">{p.title}</div>
                      <div className="text-xs text-mist-500">{timeAgo(p.updatedAt)} · {usd(p.spentCents)}</div>
                    </div>
                    <Status value={p.status} />
                  </Link>
                ))}
              </div>
            )}
          </Card>
          {aside}
        </div>
      </div>
    </div>
  );
}

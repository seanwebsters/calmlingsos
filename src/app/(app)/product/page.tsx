import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listGeneratedAssets } from "@/lib/review/assets";
import { StudioPage } from "@/components/studio/studio-page";
import { ProductCard } from "@/components/studio/product-card";
import { Card, Empty, Notice, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product Lab" };

export default async function Product() {
  const viewer = await requireViewer();
  const db = await getDb();
  const rows = await db.select().from(schema.productConcepts).where(eq(schema.productConcepts.orgId, viewer.orgId)).orderBy(desc(schema.productConcepts.iteration), desc(schema.productConcepts.createdAt));
  const latest = [...new Map(rows.map((r) => [r.lineageId, r])).values()];
  const renders = await listGeneratedAssets(viewer.orgId, { role: "product_render", latestOnly: true, limit: 200 });
  const ranges = [...new Set(latest.map((p) => p.rangeName ?? "Unranged"))];
  return (
    <StudioPage viewer={viewer} eyebrow="07 · Product Lab" title="Physical Calmlings products" sub="Concepts → brand check → renders → packaging → unit economics → feasibility → your approval → pitch-ready concept packs." departments={["product"]} templateKeys={["product_range"]}
      aside={<Notice tone="warn" title="All commercial figures are estimates">Unit costs, MOQs, retail prices and margins stay labelled ESTIMATE until you record a supplier quote.</Notice>}
    >
      <Card>
        <SectionTitle title="Product concepts" sub="Latest iteration of each concept; edits create a new iteration" />
        {latest.length === 0 ? <Empty title="No product concepts yet" /> : ranges.map((range) => (
          <div key={range} className="mb-6">
            <div className="label mb-2">{range}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {latest.filter((p) => (p.rangeName ?? "Unranged") === range).map((p) => (
                <ProductCard key={p.id} p={p} render={renders.find((r) => r.productionId === p.productionId && r.title === p.name) ?? null} iterations={rows.filter((r) => r.lineageId === p.lineageId).length} canEdit={can(viewer.role, "production:create")} canApprove={can(viewer.role, "review:approve")} />
              ))}
            </div>
          </div>
        ))}
      </Card>
    </StudioPage>
  );
}

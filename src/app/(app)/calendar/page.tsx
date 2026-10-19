import Link from "next/link";
import { and, eq, gte, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { Action } from "@/components/client/action";
import { CalendarAdd } from "@/components/studio/calendar-add";
import { Card, PageHeader, Status } from "@/components/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Production Calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const base = sp.m ? new Date(`${sp.m}-01T00:00:00`) : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const db = await getDb();
  const items = await db.select().from(schema.calendarItems).where(and(eq(schema.calendarItems.orgId, viewer.orgId), gte(schema.calendarItems.date, start), lt(schema.calendarItems.date, end)));
  const prods = await db.select().from(schema.productions).where(and(eq(schema.productions.orgId, viewer.orgId), gte(schema.productions.dueDate, start), lt(schema.productions.dueDate, end)));
  const offset = (start.getDay() + 6) % 7;
  const days = new Date(end.getTime() - 86400_000).getDate();
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prev = fmt(new Date(start.getFullYear(), start.getMonth() - 1, 1));
  const next = fmt(new Date(start.getFullYear(), start.getMonth() + 1, 1));
  const today = new Date();
  return (
    <div>
      <PageHeader eyebrow="13 · Production Calendar" title={start.toLocaleDateString("en-GB", { month: "long", year: "numeric" })} sub="Deadlines, proposed publishing dates and milestones. Proposed items are suggestions from agents – nothing publishes automatically." actions={<><Link href={`/calendar?m=${prev}`} className="link text-sm">← Prev</Link><Link href={`/calendar?m=${next}`} className="link text-sm">Next →</Link></>} />
      {can(viewer.role, "production:create") && <div className="mb-6"><CalendarAdd /></div>}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.06]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="bg-ink-900 px-2 py-1.5 text-[11px] uppercase tracking-wider text-mist-500">{d}</div>)}
        {Array.from({ length: offset }, (_, i) => <div key={`e${i}`} className="min-h-28 bg-ink-950/60" />)}
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1;
          const its = items.filter((x) => x.date.getDate() === day);
          const ps = prods.filter((x) => x.dueDate!.getDate() === day);
          const isToday = today.getFullYear() === start.getFullYear() && today.getMonth() === start.getMonth() && today.getDate() === day;
          return (
            <div key={day} className={cn("min-h-28 bg-ink-900 p-1.5", isToday && "bg-calm-400/[0.06]")}>
              <div className={cn("mb-1 text-xs", isToday ? "font-semibold text-calm-300" : "text-mist-500")}>{day}</div>
              {its.map((x) => (
                <div key={x.id} className={cn("mb-1 rounded px-1.5 py-0.5 text-[11px]", x.kind === "deadline" ? "bg-bad/15 text-bad" : x.status === "proposed" ? "bg-violet/15 text-violet" : "bg-calm-400/15 text-calm-200")} title={x.notes}>
                  {x.title}
                  {x.status === "proposed" && can(viewer.role, "review:approve") && <Action endpoint="/api/calendar" method="PATCH" body={{ id: x.id, status: "scheduled" }} size="sm" variant="ghost" className="ml-1 px-1 py-0 text-[10px]">confirm</Action>}
                </div>
              ))}
              {ps.map((p) => <Link key={p.id} href={`/productions/${p.id}`} className="mb-1 block rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">Due: {p.title}</Link>)}
            </div>
          );
        })}
      </div>
      <Card className="mt-6">
        <div className="label mb-2">This month</div>
        {items.length ? items.sort((a, b) => a.date.getTime() - b.date.getTime()).map((x) => <div key={x.id} className="flex items-center gap-3 py-1 text-sm"><span className="w-16 text-xs text-mist-500">{x.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span><span className="flex-1 text-mist-100">{x.title}</span><span className="text-xs text-mist-500">{x.platform ?? x.kind}</span><Status value={x.status} /></div>) : <p className="text-sm text-mist-400">Nothing scheduled.</p>}
      </Card>
    </div>
  );
}

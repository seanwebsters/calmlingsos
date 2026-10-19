import Link from "next/link";
import { requireViewer } from "@/lib/auth/session";
import { CANON_DOMAINS } from "@/lib/brain/canon";
import { CanonBoard } from "@/components/canon/canon-board";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calmlings Bible" };

export default async function CanonPage({ searchParams }: { searchParams: Promise<{ domain?: string; record?: string }> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const domain = sp.domain && sp.domain in CANON_DOMAINS ? sp.domain : null;
  return (
    <div>
      <PageHeader eyebrow="The Calmlings Brain" title="The Calmlings Bible" sub="Structured canon for world, lore, brand and production. Characters live in Character Universe. Every record is versioned; only approved records are canon." />
      <div className="mb-6 flex gap-2">
        <Link href="/canon" className={cn("rounded-full border px-3 py-1 text-xs", !domain ? "border-calm-300/50 text-white" : "border-white/10 text-mist-400")}>All</Link>
        {Object.entries(CANON_DOMAINS).map(([k, d]) => <Link key={k} href={`/canon?domain=${k}`} className={cn("rounded-full border px-3 py-1 text-xs", domain === k ? "border-calm-300/50 text-white" : "border-white/10 text-mist-400")}>{d.label}</Link>)}
      </div>
      <CanonBoard viewer={viewer} domains={domain ? [domain] : Object.keys(CANON_DOMAINS)} highlight={sp.record} />
    </div>
  );
}

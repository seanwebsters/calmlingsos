import type { ReactNode } from "react";
import { titleCase } from "@/lib/cn";

/** Readable rendering of any typed agent artifact (structured JSON). */
export function StructuredView({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null || value === undefined || value === "") return <span className="text-mist-500">—</span>;
  if (typeof value === "string") return <span className="whitespace-pre-wrap text-mist-100">{value}</span>;
  if (typeof value === "number" || typeof value === "boolean") return <span className="font-mono text-calm-200">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null)) return <ul className="list-disc space-y-0.5 pl-5">{value.map((v, i) => <li key={i}><StructuredView value={v} depth={depth + 1} /></li>)}</ul>;
    return (
      <div className="space-y-2">
        {value.map((v, i) => (
          <div key={i} className="rounded-lg border border-white/[0.06] bg-ink-900/60 p-3">
            <StructuredView value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([k]) => !k.startsWith("_") && k !== "pack");
  return (
    <dl className={depth ? "space-y-1.5" : "space-y-3"}>
      {entries.map(([k, v]) => (
        <div key={k} className={typeof v === "object" && v !== null ? "" : "grid grid-cols-[160px_minmax(0,1fr)] gap-3"}>
          <dt className="text-[11px] uppercase tracking-wider text-mist-500">{titleCase(k.replace(/([A-Z])/g, " $1"))}</dt>
          <dd className="text-sm">
            <StructuredView value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

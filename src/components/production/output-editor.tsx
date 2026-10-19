"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

/** Every agent deliverable is editable by a human; edits are validated against the step's schema. */
export function OutputEditor({ stepId, output }: { stepId: string; output: Record<string, unknown> }) {
  const router = useRouter();
  const clean = Object.fromEntries(Object.entries(output).filter(([k]) => !k.startsWith("_") && k !== "pack" && k !== "persisted" && k !== "originalityNote" && k !== "ranking"));
  const [text, setText] = useState(JSON.stringify(clean, null, 2));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-calm-300 hover:underline">Edit output</button>;
  return (
    <div className="mt-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} className="field font-mono text-xs" />
      <div className="mt-2 flex gap-2">
        <button
          onClick={async () => {
            setError(null);
            try {
              await api(`/api/steps/${stepId}/output`, { body: { output: JSON.parse(text) } });
              setOpen(false);
              router.refresh();
            } catch (e) {
              setError(e as Error);
            }
          }}
          className="rounded-lg bg-calm-400 px-3 py-1.5 text-xs font-medium text-ink-950"
        >
          Save edit
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-mist-400">Cancel</button>
      </div>
      <p className="mt-1 text-[11px] text-mist-500">Downstream steps that already ran keep their outputs; re-run them to use your edit.</p>
      <ErrorNote error={error} />
    </div>
  );
}

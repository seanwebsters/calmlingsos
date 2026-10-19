"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

export function NewCharacter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-calm-400 px-3.5 py-2 text-sm font-medium text-ink-950 hover:bg-calm-300">
        <Plus className="size-4" /> New character
      </button>
    );
  return (
    <form
      className="panel flex flex-wrap items-end gap-2 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          const { id } = await api<{ id: string }>("/api/characters", { body: { name: f.get("name"), summary: f.get("summary") } });
          router.push(`/characters/${id}?tab=personality`);
        } catch (err) {
          setError(err as Error);
        }
      }}
    >
      <input name="name" required placeholder="Official name" className="field w-44" />
      <input name="summary" placeholder="One-line summary (optional)" className="field w-64" />
      <button className="rounded-lg bg-calm-400 px-3 py-2 text-sm font-medium text-ink-950">Create</button>
      <button type="button" onClick={() => setOpen(false)} className="px-2 text-sm text-mist-400">Cancel</button>
      <div className="w-full"><ErrorNote error={error} /></div>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

export function CalendarAdd() {
  const router = useRouter();
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="panel flex flex-wrap items-end gap-2 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        try {
          await api("/api/calendar", { body: { ...f, platform: f.platform || null } });
          (e.target as HTMLFormElement).reset();
          router.refresh();
        } catch (err) {
          setError(err as Error);
        }
      }}
    >
      <input name="title" required placeholder="Title" className="field w-64" />
      <select name="kind" className="field w-36"><option value="publish">Publish slot</option><option value="deadline">Deadline</option><option value="milestone">Milestone</option><option value="review">Review</option></select>
      <input name="date" type="date" required className="field w-40" />
      <input name="platform" placeholder="Platform (optional)" className="field w-40" />
      <button className="rounded-lg border border-white/10 px-3 py-2 text-sm text-mist-100">Add</button>
      <div className="w-full"><ErrorNote error={error} /></div>
    </form>
  );
}

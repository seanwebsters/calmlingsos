"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

export function OutreachRequest() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="panel space-y-2 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/approvals", { body: { action: "request_outreach", title: `Outreach: ${title}`, summary, targetType: "partner", targetId: title } });
          setTitle("");
          setSummary("");
          router.refresh();
        } catch (err) {
          setError(err as Error);
        }
      }}
    >
      <div className="font-display text-lg text-white">Request outreach approval</div>
      <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Partner (e.g. a global travel brand)" className="field" />
      <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What would be shared, by whom, and why" rows={3} className="field" />
      <button className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-mist-100">Request approval</button>
      <ErrorNote error={error} />
    </form>
  );
}

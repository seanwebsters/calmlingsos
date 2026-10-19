"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

export function SetupForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="panel space-y-4 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await api("/api/setup", { body: Object.fromEntries(f) });
          router.push("/settings?welcome=1");
        } catch (err) {
          setError(err as Error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input name="orgName" label="Studio name" defaultValue="Calmlings Studio" />
      <Input name="name" label="Your name" />
      <Input name="email" label="Email" type="email" />
      <Input name="password" label="Password (10+ characters)" type="password" />
      <button disabled={busy} className="w-full rounded-lg bg-calm-400 py-2.5 text-sm font-medium text-ink-950 hover:bg-calm-300 disabled:opacity-50">
        {busy ? "Creating…" : "Create studio"}
      </button>
      <ErrorNote error={error} />
    </form>
  );
}

function Input({ label, ...p }: React.ComponentProps<"input"> & { label: string }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      <input {...p} required className="field" />
    </label>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  return (
    <form
      className="panel space-y-4 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api("/api/auth/login", { body: Object.fromEntries(new FormData(e.currentTarget)) });
          router.push("/mission");
          router.refresh();
        } catch (err) {
          setError(err as Error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block">
        <span className="label mb-1.5 block">Email</span>
        <input name="email" type="email" required className="field" autoComplete="email" />
      </label>
      <label className="block">
        <span className="label mb-1.5 block">Password</span>
        <input name="password" type="password" required className="field" autoComplete="current-password" />
      </label>
      <button disabled={busy} className="w-full rounded-lg bg-calm-400 py-2.5 text-sm font-medium text-ink-950 hover:bg-calm-300 disabled:opacity-50">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <ErrorNote error={error} />
    </form>
  );
}

import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/org";
import { env } from "@/lib/env";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (env.authMode === "open") redirect("/mission");
  if (await needsSetup()) redirect("/setup");
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-calm-300 to-calm-600 shadow-glow">
            <span className="font-display text-xl font-semibold text-ink-950">C</span>
          </div>
          <h1 className="font-display text-3xl text-white">CALMLINGS OS</h1>
          <p className="mt-1 text-sm text-mist-400">Proprietary studio system – authorised access only.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}

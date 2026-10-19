import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/org";
import { deploymentWarnings } from "@/lib/env";
import { SetupForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <div className="grid gap-10 md:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="label mb-3 text-calm-300">Setup · step 1 of 2</div>
          <h1 className="font-display text-5xl leading-[1.05] text-white">Welcome to CALMLINGS OS.</h1>
          <p className="mt-4 max-w-md text-mist-300">
            One Calmlings universe, one shared creative brain, dozens of specialist agents – with humans holding canon authority and every final approval.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-mist-300">
            <li>1. Create your studio workspace and owner account.</li>
            <li>2. Connect providers in Settings & Integrations (keys stay on the server).</li>
            <li>3. Upload your official references – they are the source of truth.</li>
          </ul>
          {deploymentWarnings().length > 0 && (
            <div className="mt-8 space-y-2 text-xs text-mist-400">
              {deploymentWarnings().map((w) => (
                <div key={w} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">{w}</div>
              ))}
            </div>
          )}
        </div>
        <SetupForm />
      </div>
    </main>
  );
}

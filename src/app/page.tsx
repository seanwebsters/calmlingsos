import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/org";
import { getViewer } from "@/lib/auth/session";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (env.authMode === "open") redirect("/mission");
  if (await needsSetup()) redirect("/setup");
  redirect((await getViewer()) ? "/mission" : "/login");
}

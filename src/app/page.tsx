import { redirect } from "next/navigation";
import { needsSetup } from "@/lib/org";
import { getViewer } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await needsSetup()) redirect("/setup");
  redirect((await getViewer()) ? "/mission" : "/login");
}

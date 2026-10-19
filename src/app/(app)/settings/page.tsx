import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireViewer } from "@/lib/auth/session";
import { can, permissionsFor, ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { providerStatuses } from "@/lib/providers/gateway";
import { canEncryptCredentials } from "@/lib/crypto";
import { deploymentWarnings, env } from "@/lib/env";
import { getOrgSettings } from "@/lib/org";
import { ProviderCard } from "@/components/settings/provider-card";
import { AddMember, OrgSettingsForm } from "@/components/settings/org-forms";
import { Action } from "@/components/client/action";
import { Badge, Card, KeyVal, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { timeAgo } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings & Integrations" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const [providers, settings] = await Promise.all([providerStatuses(viewer.orgId), getOrgSettings(viewer.orgId)]);
  const db = await getDb();
  const members = await db.select({ m: schema.memberships, u: schema.users }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, viewer.orgId));
  const auditRows = can(viewer.role, "audit:read") ? await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.orgId, viewer.orgId)).orderBy(desc(schema.auditEvents.createdAt)).limit(40) : [];
  const dbKind = env.databaseUrl && /^postgres/.test(env.databaseUrl) ? "PostgreSQL" : "Embedded PGlite";
  const canStore = canEncryptCredentials();
  return (
    <div>
      <PageHeader eyebrow="16 · Settings & Integrations" title="Studio setup" sub="Provider credentials stay on the server – environment variables or AES-256-GCM encrypted storage. Nothing is faked when an integration is missing." />
      {sp.welcome && <div className="mb-6"><Notice tone="ok" title="Studio created – setup step 2 of 2">Connect at least one text provider (Anthropic, OpenAI or Google) so agents can plan and write, and an image provider for visual work. Then upload your official references.</Notice></div>}
      <div className="space-y-8">
        <section>
          <SectionTitle title="AI providers" sub="Capabilities are declared per model; ‘Test connection’ discovers which models your account can actually use." />
          {!canStore && <div className="mb-4"><Notice tone="warn" title="Stored keys are disabled">Set CREDENTIALS_ENCRYPTION_KEY (32 random bytes, hex) on the server to save keys here, or provide keys as environment variables ({providers.map((p) => p.definition.envVar).join(", ")}).</Notice></div>}
          <div className="grid gap-4 xl:grid-cols-2">
            {providers.map((p) => (
              <ProviderCard key={p.key} canManage={can(viewer.role, "providers:manage")} canStore={canStore} p={{ key: p.key, name: p.name, connected: p.connected, credentialSource: p.credentialSource, keyHint: p.keyHint, enabled: p.enabled, allowProprietaryReferences: p.allowProprietaryReferences, models: p.models, status: p.status, lastCheckedAt: p.lastCheckedAt?.toISOString() ?? null, lastError: p.lastError, implemented: p.implemented, envVar: p.definition.envVar, consoleUrl: p.definition.consoleUrl, privacyNote: p.definition.privacyNote, rateLimitNote: p.definition.rateLimitNote, capabilities: p.definition.capabilities, modelList: p.definition.models }} />
            ))}
          </div>
        </section>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <SectionTitle title="Database, storage & jobs" />
            <KeyVal k="Database" v={<>{dbKind} <Badge tone={dbKind === "PostgreSQL" ? "ok" : "warn"}>{dbKind === "PostgreSQL" ? "production-ready" : "local"}</Badge></>} />
            <KeyVal k="Object storage" v={env.storageBackend === "s3" ? `S3-compatible (${env.s3.bucket})` : env.storageBackend === "db" ? "Inside the database" : `Local disk (${env.dataDir})`} />
            <KeyVal k="Asset URLs" v="Short-lived signed URLs" />
            <KeyVal k="Background worker" v={env.inProcessWorker ? "In-process (plus optional `npm run worker`)" : env.serverless ? "Runs in short bursts while the studio is open (/api/jobs/tick)" : "External `npm run worker` processes"} />
            <KeyVal k="Malware scanning" v={env.clamavAddress ? `ClamAV at ${env.clamavAddress}` : "Not configured (uploads are content-validated only)"} />
            <KeyVal k="Analytics" v="CSV import · platform connectors not configured" />
            <KeyVal k="Search" v="Anthropic web search (when connected) for research agents" />
            {deploymentWarnings().map((w) => <p key={w} className="mt-2 text-xs text-warn">{w}</p>)}
          </Card>
          <Card>
            <SectionTitle title="Studio policies" />
            {can(viewer.role, "org:manage") ? <OrgSettingsForm s={settings} /> : <p className="text-sm text-mist-400">Only owners can change policies.</p>}
          </Card>
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <SectionTitle title="Team & roles" />
            {members.map(({ m, u }) => <div key={m.id} className="flex items-center justify-between border-b border-white/[0.05] py-2 text-sm last:border-0"><span className="text-mist-100">{u.name} <span className="text-mist-500">{u.email}</span></span><Badge tone="calm">{ROLE_LABELS[m.role as Role] ?? m.role}</Badge></div>)}
            {can(viewer.role, "members:manage") && <div className="mt-4"><AddMember /></div>}
            <details className="mt-4"><summary className="cursor-pointer text-xs text-calm-300">Role permissions</summary><div className="mt-2 space-y-1 text-xs">{(Object.keys(ROLE_LABELS) as Role[]).map((r) => <div key={r}><span className="text-mist-200">{ROLE_LABELS[r]}:</span> <span className="text-mist-500">{permissionsFor(r).join(", ") || "read only"}</span></div>)}</div></details>
          </Card>
          <Card>
            <SectionTitle title="Security, data & recovery" />
            <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-mist-300">
              <li>Sessions are random tokens stored as SHA-256 hashes; passwords use scrypt.</li>
              <li>Every record is scoped to your organisation; storage keys are namespaced per organisation.</li>
              <li>Backups: snapshot PostgreSQL (e.g. <code>pg_dump</code> nightly) and version your object storage bucket. With PGlite, back up DATA_DIR.</li>
              <li>Reference files are only sent to providers you approve for proprietary IP; no model is trained or fine-tuned on uploads.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              {can(viewer.role, "org:manage") && <a href="/api/org" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-mist-100">Export all records (JSON)</a>}
              {can(viewer.role, "data:delete") && <Action endpoint="/api/org" body={{ action: "purge" }} variant="danger" confirm={`Purge files of rejected generations older than ${settings.retentionDays || "∞"} days?`}>Run retention purge</Action>}
            </div>
          </Card>
        </div>
        {auditRows.length > 0 && (
          <Card>
            <SectionTitle title="Audit log" sub="Append-only record of canon, approval, credential, export and access events" />
            <div className="grid gap-x-6 md:grid-cols-2">
              {auditRows.map((a) => <div key={a.id} className="flex justify-between gap-3 border-b border-white/[0.04] py-1.5 text-xs"><span className="text-mist-200">{a.action} <span className="text-mist-500">{a.targetType}:{a.targetId.slice(0, 18)}</span></span><span className="text-mist-500">{a.actorAgent ?? (a.actorUserId ? "user" : "system")} · {timeAgo(a.createdAt)}</span></div>)}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

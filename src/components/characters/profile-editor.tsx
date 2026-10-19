"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import type { CharacterProfile } from "@/db/schema";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";
import { cn } from "@/lib/cn";

const TEXT_FIELDS: { key: keyof CharacterProfile; label: string; rows?: number }[] = [
  { key: "officialName", label: "Official name", rows: 1 },
  { key: "approvedDescription", label: "Approved description", rows: 3 },
  { key: "personality", label: "Personality", rows: 3 },
  { key: "emotionalPurpose", label: "Emotional purpose", rows: 2 },
  { key: "appearance", label: "Appearance (describe what the masters show – don't invent)", rows: 3 },
  { key: "silhouette", label: "Silhouette", rows: 2 },
  { key: "proportions", label: "Proportions", rows: 2 },
  { key: "facialFeatures", label: "Facial features", rows: 2 },
  { key: "expressionRange", label: "Expression range", rows: 2 },
  { key: "bodyLanguage", label: "Body language", rows: 2 },
  { key: "animationRules", label: "Animation rules", rows: 3 },
  { key: "voice", label: "Approved voice (direction)", rows: 2 },
  { key: "backstory", label: "Backstory", rows: 4 },
];

export function ProfileEditor({ characterId, profile, lockedFields, locked, characters, canLock }: { characterId: string; profile: CharacterProfile; lockedFields: string[]; locked: boolean; characters: { id: string; name: string }[]; canLock: boolean }) {
  const router = useRouter();
  const [p, setP] = useState<CharacterProfile>(profile);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [lockSet, setLockSet] = useState<string[]>(lockedFields);
  const [lockOn, setLockOn] = useState(locked);
  const set = <K extends keyof CharacterProfile>(k: K, v: CharacterProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const isLocked = (k: string) => lockOn && lockSet.includes(k);

  async function save() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ version: number; status: string; lockedFieldsTouched: string[] }>(`/api/characters/${characterId}/profile`, { body: { profile: p, changeNote: note } });
      setResult(r.status === "pending_approval" ? `Saved v${r.version} as a change request – it touches locked fields (${r.lockedFieldsTouched.join(", ")}) and needs approval.` : `Saved v${r.version} as a draft. Approve it in Version History to make it canon.`);
      router.refresh();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }

  async function saveLock() {
    setError(null);
    try {
      await api(`/api/characters/${characterId}/lock`, { body: { locked: lockOn, fields: lockSet } });
      setResult(lockOn ? `Character Lock on for ${lockSet.length} fields.` : "Character Lock off.");
      router.refresh();
    } catch (e) {
      setError(e as Error);
    }
  }

  const LockToggle = ({ k }: { k: string }) =>
    canLock ? (
      <button type="button" title={lockSet.includes(k) ? "Locked field" : "Lock this field"} onClick={() => setLockSet((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))} className={cn("rounded p-0.5", lockSet.includes(k) ? "text-calm-300" : "text-mist-600 hover:text-mist-300")}>
        <Lock className="size-3" />
      </button>
    ) : null;

  return (
    <div className="space-y-6">
      {canLock && (
        <div className="panel-quiet flex flex-wrap items-center gap-3 p-4">
          <Lock className="size-4 text-calm-300" />
          <div className="flex-1 text-sm">
            <div className="text-white">Character Lock</div>
            <div className="text-xs text-mist-400">When on, any change to a locked field becomes a change request that a canon authority must approve. Click the lock icons to choose fields.</div>
          </div>
          <label className="flex items-center gap-2 text-sm text-mist-200">
            <input type="checkbox" checked={lockOn} onChange={(e) => setLockOn(e.target.checked)} className="accent-calm-400" /> Lock enabled
          </label>
          <button onClick={saveLock} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-mist-100 hover:bg-white/[0.06]">Save lock</button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {TEXT_FIELDS.map((f) => (
          <label key={f.key} className={cn("block", (f.rows ?? 2) >= 3 && "md:col-span-2")}>
            <span className="mb-1.5 flex items-center gap-1.5">
              <span className="label">{f.label}</span>
              <LockToggle k={f.key} />
              {isLocked(f.key) && <span className="text-[10px] text-calm-300">locked – edits need approval</span>}
            </span>
            {f.rows === 1 ? (
              <input value={String(p[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value as never)} className="field" />
            ) : (
              <textarea value={String(p[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value as never)} rows={f.rows ?? 2} className="field" />
            )}
          </label>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-1.5"><span className="label">Colours</span><LockToggle k="colours" /></div>
          <div className="space-y-2">
            {p.colours.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="color" value={c.hex} onChange={(e) => set("colours", p.colours.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} className="h-9 w-10 rounded border border-white/10 bg-transparent" />
                <input value={c.name} onChange={(e) => set("colours", p.colours.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className="field w-32" />
                <input value={c.usage ?? ""} onChange={(e) => set("colours", p.colours.map((x, j) => (j === i ? { ...x, usage: e.target.value } : x)))} placeholder="Usage (e.g. body, cheeks)" className="field flex-1" />
                <button onClick={() => set("colours", p.colours.filter((_, j) => j !== i))} className="text-mist-500 hover:text-bad"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <button onClick={() => set("colours", [...p.colours, { name: "", hex: "#7ea5ff" }])} className="inline-flex items-center gap-1 text-xs text-calm-300"><Plus className="size-3" /> Add colour</button>
          </div>
        </div>
        <ListEditor label="Forbidden visual changes" lockKey="forbiddenChanges" values={p.forbiddenChanges} onChange={(v) => set("forbiddenChanges", v)} LockToggle={LockToggle} placeholder="e.g. Never add a mouth with teeth" />
        <ListEditor label="Storytelling themes" lockKey="storytellingThemes" values={p.storytellingThemes} onChange={(v) => set("storytellingThemes", v)} LockToggle={LockToggle} placeholder="e.g. Patience" />
        <div>
          <div className="mb-2 flex items-center gap-1.5"><span className="label">Relationships</span><LockToggle k="relationships" /></div>
          {p.relationships.map((r, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <select value={r.characterId} onChange={(e) => set("relationships", p.relationships.map((x, j) => (j === i ? { ...x, characterId: e.target.value } : x)))} className="field w-40">
                {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input value={r.nature} onChange={(e) => set("relationships", p.relationships.map((x, j) => (j === i ? { ...x, nature: e.target.value } : x)))} placeholder="Nature of relationship" className="field flex-1" />
              <button onClick={() => set("relationships", p.relationships.filter((_, j) => j !== i))} className="text-mist-500 hover:text-bad"><Trash2 className="size-4" /></button>
            </div>
          ))}
          {characters.length > 0 && <button onClick={() => set("relationships", [...p.relationships, { characterId: characters[0].id, nature: "" }])} className="inline-flex items-center gap-1 text-xs text-calm-300"><Plus className="size-3" /> Add relationship</button>}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1.5"><span className="label">Character consistency checklist</span><LockToggle k="consistencyChecklist" /></div>
        <div className="grid gap-2 md:grid-cols-2">
          {p.consistencyChecklist.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-36 shrink-0 text-sm text-mist-200">{c.item}</span>
              <input value={c.rule} onChange={(e) => set("consistencyChecklist", p.consistencyChecklist.map((x, j) => (j === i ? { ...x, rule: e.target.value } : x)))} placeholder="Rule (from the official masters)" className="field" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1.5"><span className="label">Voice provider assignment</span><LockToggle k="voiceAssignment" /></div>
        {p.voiceAssignment ? (
          <div className="grid gap-2 md:grid-cols-[140px_1fr_1.4fr_auto]">
            <select value={p.voiceAssignment.provider} onChange={(e) => set("voiceAssignment", { ...p.voiceAssignment!, provider: e.target.value })} className="field">
              <option value="elevenlabs">ElevenLabs</option>
              <option value="openai">OpenAI</option>
            </select>
            <input value={p.voiceAssignment.voiceId} onChange={(e) => set("voiceAssignment", { ...p.voiceAssignment!, voiceId: e.target.value })} placeholder="Provider voice ID" className="field" />
            <input value={p.voiceAssignment.consentNote} onChange={(e) => set("voiceAssignment", { ...p.voiceAssignment!, consentNote: e.target.value })} placeholder="Consent / licence record (required)" className="field" />
            <button onClick={() => set("voiceAssignment", null)} className="text-mist-500 hover:text-bad"><Trash2 className="size-4" /></button>
          </div>
        ) : (
          <button onClick={() => set("voiceAssignment", { provider: "elevenlabs", voiceId: "", consentNote: "" })} className="text-xs text-calm-300">+ Assign a licensed voice (consent required; no voice cloning without the voice owner's documented consent)</button>
        )}
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-ink-850/95 p-3 shadow-card backdrop-blur">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change note (what changed and why)" className="field flex-1" />
        <button disabled={busy} onClick={save} className="rounded-lg bg-calm-400 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-calm-300 disabled:opacity-50">{busy ? "Saving…" : "Save as new version"}</button>
        {result && <div className="w-full text-xs text-ok">{result}</div>}
        <div className="w-full"><ErrorNote error={error} /></div>
      </div>
    </div>
  );
}

function ListEditor({ label, lockKey, values, onChange, LockToggle, placeholder }: { label: string; lockKey: string; values: string[]; onChange: (v: string[]) => void; LockToggle: (p: { k: string }) => React.ReactNode; placeholder: string }) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5"><span className="label">{label}</span><LockToggle k={lockKey} /></div>
      <ul className="mb-2 space-y-1">
        {values.map((v, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1 text-sm text-mist-100">
            <span className="flex-1">{v}</span>
            <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="text-mist-500 hover:text-bad"><Trash2 className="size-3.5" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { e.preventDefault(); onChange([...values, draft.trim()]); setDraft(""); } }} placeholder={placeholder} className="field" />
        <button onClick={() => { if (draft.trim()) { onChange([...values, draft.trim()]); setDraft(""); } }} className="rounded-lg border border-white/10 px-3 text-sm text-mist-200">Add</button>
      </div>
    </div>
  );
}

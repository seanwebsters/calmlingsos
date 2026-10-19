import { z } from "zod";
import type { CharacterProfile } from "@/db/schema";

/** Character bible fields that can be placed under Character Lock. */
export const PROFILE_FIELDS: { key: keyof CharacterProfile; label: string; group: "identity" | "visual" | "performance" | "story" }[] = [
  { key: "officialName", label: "Official name", group: "identity" },
  { key: "approvedDescription", label: "Approved description", group: "identity" },
  { key: "personality", label: "Personality", group: "identity" },
  { key: "emotionalPurpose", label: "Emotional purpose", group: "identity" },
  { key: "appearance", label: "Appearance", group: "visual" },
  { key: "colours", label: "Colours", group: "visual" },
  { key: "silhouette", label: "Silhouette", group: "visual" },
  { key: "proportions", label: "Proportions", group: "visual" },
  { key: "facialFeatures", label: "Facial features", group: "visual" },
  { key: "expressionRange", label: "Expression range", group: "performance" },
  { key: "bodyLanguage", label: "Body language", group: "performance" },
  { key: "animationRules", label: "Animation rules", group: "performance" },
  { key: "voice", label: "Approved voice", group: "performance" },
  { key: "voiceAssignment", label: "Voice provider assignment", group: "performance" },
  { key: "relationships", label: "Relationships", group: "story" },
  { key: "backstory", label: "Backstory", group: "story" },
  { key: "storytellingThemes", label: "Storytelling themes", group: "story" },
  { key: "forbiddenChanges", label: "Forbidden visual changes", group: "visual" },
  { key: "consistencyChecklist", label: "Consistency checklist", group: "visual" },
];

/** The default consistency checklist items; rules are left blank for the creative director to define. */
export const CONSISTENCY_ITEMS = ["Silhouette", "Colours", "Facial geometry", "Eye placement", "Mouth treatment", "Proportions", "Surface finish", "Accessory rules", "Personality consistency"];

export function emptyProfile(name: string): CharacterProfile {
  return {
    officialName: name,
    approvedDescription: "",
    personality: "",
    emotionalPurpose: "",
    appearance: "",
    colours: [],
    silhouette: "",
    proportions: "",
    facialFeatures: "",
    expressionRange: "",
    bodyLanguage: "",
    animationRules: "",
    voice: "",
    voiceAssignment: null,
    relationships: [],
    backstory: "",
    storytellingThemes: [],
    forbiddenChanges: [],
    consistencyChecklist: CONSISTENCY_ITEMS.map((item) => ({ item, rule: "" })),
  };
}

export const profileSchema = z.object({
  officialName: z.string().min(1).max(120),
  approvedDescription: z.string().max(8000),
  personality: z.string().max(8000),
  emotionalPurpose: z.string().max(8000),
  appearance: z.string().max(8000),
  colours: z.array(z.object({ name: z.string().max(80), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/), usage: z.string().max(200).optional() })).max(40),
  silhouette: z.string().max(4000),
  proportions: z.string().max(4000),
  facialFeatures: z.string().max(4000),
  expressionRange: z.string().max(4000),
  bodyLanguage: z.string().max(4000),
  animationRules: z.string().max(8000),
  voice: z.string().max(4000),
  voiceAssignment: z.object({ provider: z.string().max(40), voiceId: z.string().min(1).max(200), consentNote: z.string().min(3, "Record the consent/licence for this voice.").max(1000) }).nullable().default(null),
  relationships: z.array(z.object({ characterId: z.string(), nature: z.string().max(400) })).max(100),
  backstory: z.string().max(20000),
  storytellingThemes: z.array(z.string().max(200)).max(50),
  forbiddenChanges: z.array(z.string().max(400)).max(100),
  consistencyChecklist: z.array(z.object({ item: z.string().max(120), rule: z.string().max(1000) })).max(40),
});

/** Which profile fields differ between two versions. */
export function changedFields(a: CharacterProfile | null, b: CharacterProfile): (keyof CharacterProfile)[] {
  if (!a) return PROFILE_FIELDS.map((f) => f.key);
  return PROFILE_FIELDS.map((f) => f.key).filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}

/** Render a profile as canon text for agents. Empty fields are omitted, never invented. */
export function profileToText(code: string, p: CharacterProfile, version: number): string {
  const lines = [`CHARACTER ${code} – ${p.officialName} (approved profile v${version})`];
  const add = (label: string, v: string | undefined) => v && v.trim() && lines.push(`${label}: ${v.trim()}`);
  add("Approved description", p.approvedDescription);
  add("Personality", p.personality);
  add("Emotional purpose", p.emotionalPurpose);
  add("Appearance", p.appearance);
  if (p.colours.length) lines.push(`Colours: ${p.colours.map((c) => `${c.name} ${c.hex}${c.usage ? ` (${c.usage})` : ""}`).join("; ")}`);
  add("Silhouette", p.silhouette);
  add("Proportions", p.proportions);
  add("Facial features", p.facialFeatures);
  add("Expression range", p.expressionRange);
  add("Body language", p.bodyLanguage);
  add("Animation rules", p.animationRules);
  add("Voice", p.voice);
  if (p.voiceAssignment) lines.push(`Voice assignment: ${p.voiceAssignment.provider} voice ${p.voiceAssignment.voiceId}`);
  add("Backstory", p.backstory);
  if (p.storytellingThemes.length) lines.push(`Storytelling themes: ${p.storytellingThemes.join("; ")}`);
  if (p.forbiddenChanges.length) lines.push(`FORBIDDEN CHANGES (never do these): ${p.forbiddenChanges.join("; ")}`);
  const rules = p.consistencyChecklist.filter((c) => c.rule.trim());
  if (rules.length) lines.push(`Consistency rules: ${rules.map((r) => `${r.item}: ${r.rule}`).join("; ")}`);
  const empty = PROFILE_FIELDS.filter((f) => f.key !== "voiceAssignment").filter((f) => {
    const v = p[f.key];
    return Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim();
  }).map((f) => f.label);
  if (empty.length) lines.push(`Not yet defined in canon (do NOT invent; flag for the creative director instead): ${empty.join(", ")}`);
  return lines.join("\n");
}

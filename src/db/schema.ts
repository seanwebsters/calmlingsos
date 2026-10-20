/**
 * CALMLINGS OS relational schema.
 *
 * Conventions
 *  - Every row has a stable, prefixed text id (see lib/ids.ts).
 *  - Every tenant-owned row carries `org_id`; services always filter on it.
 *  - Canon-bearing records carry an explicit status – nothing becomes canon
 *    without a human approval recorded in `approvals` / `audit_events`.
 *  - Generated assets record full provenance (references, canon versions,
 *    provider, model, prompt version, parameters, cost, parents).
 */

import { customType, boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, primaryKey, doublePrecision } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();
const updated = () => ts("updated_at").notNull().defaultNow();
const json = <T>(name: string) => jsonb(name).$type<T>();

/* ------------------------------------------------------------------ */
/* Tenancy, users, auth                                                */
/* ------------------------------------------------------------------ */

export interface OrgSettings {
  /** Hard ceiling for any single production unless a human raises it. */
  defaultProductionBudgetCents: number;
  /** Monthly ceiling across the organisation. */
  monthlyBudgetCents: number;
  /** Days to keep rejected/archived generations before purge (0 = forever). */
  retentionDays: number;
  /** Max upload size in MB. */
  maxUploadMb: number;
  /** Require a human to approve every plan before generation starts. */
  requirePlanApproval: boolean;
}

export const organisations = pgTable("organisations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: json<OrgSettings>("settings").notNull(),
  createdAt: created(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: created(),
});

/** Role is one of the code-defined roles in lib/auth/permissions.ts. */
export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: created(),
});

/* ------------------------------------------------------------------ */
/* The Calmlings Brain – characters and canon                          */
/* ------------------------------------------------------------------ */

/** official | draft | experimental | rejected | ai_proposal | archived */
export type CanonStatus = "official" | "draft" | "experimental" | "rejected" | "ai_proposal" | "archived";

export interface CharacterProfile {
  officialName: string;
  approvedDescription: string;
  personality: string;
  emotionalPurpose: string;
  appearance: string;
  colours: { name: string; hex: string; usage?: string }[];
  silhouette: string;
  proportions: string;
  facialFeatures: string;
  expressionRange: string;
  bodyLanguage: string;
  animationRules: string;
  voice: string;
  /** Licensed provider voice used for this character. Requires recorded consent. */
  voiceAssignment: { provider: string; voiceId: string; consentNote: string } | null;
  relationships: { characterId: string; nature: string }[];
  backstory: string;
  storytellingThemes: string[];
  forbiddenChanges: string[];
  consistencyChecklist: { item: string; rule: string }[];
}

export const characters = pgTable(
  "characters",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    /** Human-facing character ID, e.g. CHR-BLUE. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    canonStatus: text("canon_status").$type<CanonStatus>().notNull().default("draft"),
    /** Character Lock: changes to locked fields require explicit approval. */
    locked: boolean("locked").notNull().default(false),
    lockedFields: json<string[]>("locked_fields").notNull().default([]),
    /** The currently approved profile version (null until one is approved). */
    approvedVersionId: text("approved_version_id"),
    heroAssetId: text("hero_asset_id"),
    summary: text("summary").notNull().default(""),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("characters_org_code").on(t.orgId, t.code)],
);

export const characterVersions = pgTable(
  "character_versions",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    profile: json<CharacterProfile>("profile").notNull(),
    /** draft | pending_approval | approved | superseded | rejected */
    status: text("status").notNull(),
    /** human | ai_proposal */
    source: text("source").notNull().default("human"),
    changeNote: text("change_note").notNull().default(""),
    createdBy: text("created_by"),
    approvedBy: text("approved_by"),
    approvedAt: ts("approved_at"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("character_versions_char_version").on(t.characterId, t.version)],
);

/**
 * World, brand, production and lore canon. Versioned: an edit creates a new
 * row with `previousId` pointing at the record it supersedes.
 */
export const canonRecords = pgTable(
  "canon_records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    /** Stable identity across versions. */
    lineageId: text("lineage_id").notNull(),
    previousId: text("previous_id"),
    version: integer("version").notNull().default(1),
    /** world | brand | production | lore */
    domain: text("domain").notNull(),
    /** e.g. environment, location, prop, world_rule, palette, lighting, mission, tone_of_voice, social_format, game_spec, naming_convention, lore_event */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    data: json<Record<string, unknown>>("data").notNull().default({}),
    canonStatus: text("canon_status").$type<CanonStatus>().notNull().default("draft"),
    /** True once a newer version of this lineage has been approved. */
    superseded: boolean("superseded").notNull().default(false),
    characterIds: json<string[]>("character_ids").notNull().default([]),
    /** For lore timelines. */
    timelineOrder: integer("timeline_order"),
    createdBy: text("created_by"),
    approvedBy: text("approved_by"),
    approvedAt: ts("approved_at"),
    createdAt: created(),
  },
  (t) => [index("canon_org_domain").on(t.orgId, t.domain), index("canon_lineage").on(t.lineageId)],
);

/* ------------------------------------------------------------------ */
/* Reference library                                                   */
/* ------------------------------------------------------------------ */

export type ReferenceDesignation = "official_master" | "approved_supporting" | "style_inspiration" | "experimental" | "rejected" | "archived" | "unclassified";

export interface MachineAnalysis {
  provider: string | null;
  model: string | null;
  analysedAt: string;
  machineGenerated: true;
  description?: string;
  characterCandidates?: { characterId: string | null; name: string; confidence: number; reason: string }[];
  composition?: string;
  styleObservations?: string[];
  consistencyRules?: string[];
  sceneDescriptions?: { atSeconds: number; description: string }[];
  movement?: string;
  editingRhythm?: string;
  transcript?: string;
  extractedText?: string;
  notes?: string;
}

export interface TechnicalMetadata {
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  format?: string;
  colourSpace?: string;
  dominantColours?: string[];
  durationSeconds?: number;
  aspectRatio?: string;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  keyframeKeys?: string[];
  pages?: number;
  wordCount?: number;
  entries?: number;
}

export const referenceAssets = pgTable(
  "reference_assets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    assetType: text("asset_type").notNull(),
    /** Media family derived from the file: image | video | audio | document | model3d | archive | data */
    mediaKind: text("media_kind").notNull(),
    designation: text("designation").$type<ReferenceDesignation>().notNull().default("unclassified"),
    /** pending | approved | rejected */
    approvalState: text("approval_state").notNull().default("pending"),
    viewAngle: text("view_angle"),
    source: text("source").notNull().default("upload"),
    /** owned | licensed | restricted | unknown */
    rightsStatus: text("rights_status").notNull().default("unknown"),
    usageNotes: text("usage_notes").notNull().default(""),
    notes: text("notes").notNull().default(""),
    currentVersionId: text("current_version_id"),
    /** none | queued | done | failed | blocked */
    analysisStatus: text("analysis_status").notNull().default("none"),
    analysisError: text("analysis_error"),
    analysis: json<MachineAnalysis | null>("analysis"),
    /** True once a human has reviewed (and possibly edited) the machine analysis. */
    analysisReviewed: boolean("analysis_reviewed").notNull().default(false),
    technical: json<TechnicalMetadata>("technical").notNull().default({}),
    /** Set when the file was extracted from an uploaded ZIP collection. */
    collectionId: text("collection_id"),
    /** Generated asset this reference was promoted from (if any). */
    promotedFromId: text("promoted_from_id"),
    /** Official masters are immutable: new files become new versions, never overwrite. */
    immutable: boolean("immutable").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: created(),
    updatedAt: updated(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("ref_org").on(t.orgId), index("ref_designation").on(t.orgId, t.designation)],
);

export const assetVersions = pgTable(
  "asset_versions",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull().references(() => referenceAssets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull(),
    thumbnailKey: text("thumbnail_key"),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    note: text("note").notNull().default(""),
    createdBy: text("created_by"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("asset_versions_asset_version").on(t.assetId, t.version)],
);

export const assetCharacters = pgTable(
  "asset_characters",
  {
    assetId: text("asset_id").notNull().references(() => referenceAssets.id, { onDelete: "cascade" }),
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.characterId] })],
);

export const assetProjects = pgTable(
  "asset_projects",
  {
    assetId: text("asset_id").notNull().references(() => referenceAssets.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.projectId] })],
);

export const assetTags = pgTable(
  "asset_tags",
  {
    assetId: text("asset_id").notNull().references(() => referenceAssets.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.tag] })],
);

/* ------------------------------------------------------------------ */
/* Projects & productions                                              */
/* ------------------------------------------------------------------ */

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  department: text("department").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: created(),
});

export type ProductionStatus = "planning" | "running" | "paused" | "awaiting_input" | "completed" | "cancelled" | "failed" | "blocked";

export const productions = pgTable(
  "productions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    department: text("department").notNull(),
    title: text("title").notNull(),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version").notNull().default(1),
    brief: json<Record<string, unknown>>("brief").notNull(),
    characterIds: json<string[]>("character_ids").notNull().default([]),
    status: text("status").$type<ProductionStatus>().notNull().default("planning"),
    budgetCents: integer("budget_cents").notNull(),
    spentCents: doublePrecision("spent_cents").notNull().default(0),
    /** Per-capability manual provider override, e.g. { image_generation: "openai" }. */
    providerOverrides: json<Record<string, string>>("provider_overrides").notNull().default({}),
    /** Canon/reference snapshot captured by the canon retrieval step. */
    contextSnapshot: json<Record<string, unknown> | null>("context_snapshot"),
    /** The natural-language command this came from, if any. */
    command: text("command"),
    dueDate: ts("due_date"),
    createdBy: text("created_by"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("productions_org_status").on(t.orgId, t.status)],
);

export type StepStatus = "pending" | "queued" | "running" | "awaiting_input" | "awaiting_approval" | "changes_requested" | "completed" | "failed" | "blocked" | "skipped" | "cancelled";

export const productionSteps = pgTable(
  "production_steps",
  {
    id: text("id").primaryKey(),
    productionId: text("production_id").notNull().references(() => productions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    agentKey: text("agent_key"),
    handler: text("handler").notNull(),
    dependsOn: json<string[]>("depends_on").notNull().default([]),
    config: json<Record<string, unknown>>("config").notNull().default({}),
    condition: json<{ step: string; path: string; op: "eq" | "neq" | "gt" | "lt" | "truthy" | "falsy"; value?: unknown } | null>("condition"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    status: text("status").$type<StepStatus>().notNull().default("pending"),
    output: json<Record<string, unknown> | null>("output"),
    /** Human feedback to apply on the next run (changes requested). */
    revisionNotes: text("revision_notes"),
    error: text("error"),
    /** When blocked: what is missing (e.g. "capability:image_generation"). */
    blockedOn: text("blocked_on"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    /** Increments every time the step is queued – part of the job idempotency key. */
    queueSeq: integer("queue_seq").notNull().default(0),
    /** Increments on an intentional re-run; per-item media generation is idempotent within a generation. */
    generation: integer("generation").notNull().default(1),
    budgetEstimateCents: doublePrecision("budget_estimate_cents").notNull().default(0),
    actualCostCents: doublePrecision("actual_cost_cents").notNull().default(0),
    providerOverride: text("provider_override"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("steps_production_key").on(t.productionId, t.key)],
);

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

/** Per-organisation agent configuration (seeded from code definitions, editable). */
export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    instructions: text("instructions").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    budgetCentsPerRun: integer("budget_cents_per_run").notNull(),
    qualityPreference: text("quality_preference").notNull().default("balanced"),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("agents_org_key").on(t.orgId, t.key)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    productionId: text("production_id").references(() => productions.id, { onDelete: "cascade" }),
    stepId: text("step_id").references(() => productionSteps.id, { onDelete: "cascade" }),
    agentKey: text("agent_key").notNull(),
    task: text("task").notNull(),
    inputs: json<Record<string, unknown>>("inputs").notNull().default({}),
    /** Exact references and canon versions given to the agent. */
    referencesUsed: json<{ assetVersionIds: string[]; characterVersionIds: string[]; canonRecordIds: string[]; decisionIds: string[] }>("references_used")
      .notNull()
      .default({ assetVersionIds: [], characterVersionIds: [], canonRecordIds: [], decisionIds: [] }),
    output: json<unknown>("output"),
    status: text("status").notNull(),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    costCents: doublePrecision("cost_cents").notNull().default(0),
    durationMs: integer("duration_ms"),
    error: text("error"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("agent_runs_org").on(t.orgId, t.startedAt), index("agent_runs_step").on(t.stepId)],
);

export const toolInvocations = pgTable("tool_invocations", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  input: json<unknown>("input"),
  output: json<unknown>("output"),
  status: text("status").notNull(),
  costCents: doublePrecision("cost_cents").notNull().default(0),
  durationMs: integer("duration_ms"),
  createdAt: created(),
});

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export const providers = pgTable(
  "providers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** May proprietary Calmlings reference files be sent to this provider? Off until a human confirms its terms. */
    allowProprietaryReferences: boolean("allow_proprietary_references").notNull().default(false),
    /** Chosen model per capability. */
    models: json<Record<string, string>>("models").notNull().default({}),
    /** connected | disconnected | error | unknown */
    status: text("status").notNull().default("unknown"),
    lastCheckedAt: ts("last_checked_at"),
    lastError: text("last_error"),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("providers_org_key").on(t.orgId, t.providerKey)],
);

/** Encrypted credential reference (AES-256-GCM). The plaintext never leaves the server. */
export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    ciphertext: text("ciphertext").notNull(),
    hint: text("hint").notNull(),
    createdBy: text("created_by"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("provider_credentials_org_key").on(t.orgId, t.providerKey)],
);

/* ------------------------------------------------------------------ */
/* Generated assets & review                                           */
/* ------------------------------------------------------------------ */

export type ReviewStatus = "draft" | "in_production" | "ready_for_review" | "changes_requested" | "approved" | "rejected" | "published";

export interface Provenance {
  referenceAssetVersionIds: string[];
  characterVersionIds: string[];
  canonRecordIds: string[];
  decisionIds: string[];
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  prompt: string | null;
  parameters: Record<string, unknown>;
  generatedAt: string;
}

export const generatedAssets = pgTable(
  "generated_assets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    productionId: text("production_id").references(() => productions.id, { onDelete: "set null" }),
    stepId: text("step_id").references(() => productionSteps.id, { onDelete: "set null" }),
    /** Work item within a step this asset answers (shot id, concept id, product id…). */
    itemKey: text("item_key"),
    /** image | video | audio | text | document | bundle */
    kind: text("kind").notNull(),
    /** Department-specific role: reference_frame, shot_video, voice_line, final_cut, export_bundle, product_render, game_asset… */
    role: text("role").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<ReviewStatus>().notNull().default("ready_for_review"),
    storageKey: text("storage_key"),
    thumbnailKey: text("thumbnail_key"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: real("duration_seconds"),
    textContent: text("text_content"),
    /** Versioning: all versions of one deliverable share lineageId. */
    lineageId: text("lineage_id").notNull(),
    version: integer("version").notNull().default(1),
    parentId: text("parent_id"),
    locked: boolean("locked").notNull().default(false),
    characterIds: json<string[]>("character_ids").notNull().default([]),
    provenance: json<Provenance>("provenance").notNull(),
    costCents: doublePrecision("cost_cents").notNull().default(0),
    /** Advisory automated consistency score (0–1). Never proof of identity. */
    consistencyScore: real("consistency_score"),
    consistencyReport: json<Record<string, unknown> | null>("consistency_report"),
    promotedReferenceId: text("promoted_reference_id"),
    createdBy: text("created_by"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("gen_org_status").on(t.orgId, t.status), index("gen_lineage").on(t.lineageId), index("gen_production").on(t.productionId)],
);

export const reviews = pgTable("reviews", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  /** approve | reject | request_changes | comment | regenerate | lock | unlock | promote | export */
  action: text("action").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  comment: text("comment").notNull().default(""),
  reviewerId: text("reviewer_id"),
  createdAt: created(),
});

/** Pending decisions that only a human may make. */
export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    /** plan | step | asset | character_change | canon_change | spend | outreach | publish */
    kind: text("kind").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    payload: json<Record<string, unknown>>("payload").notNull().default({}),
    /** pending | approved | rejected | withdrawn */
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by"),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: created(),
  },
  (t) => [index("approvals_org_status").on(t.orgId, t.status)],
);

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    body: text("body").notNull(),
    /** Optional region annotation on an image/video frame, in 0–1 coordinates. */
    annotation: json<{ x: number; y: number; w: number; h: number; atSeconds?: number } | null>("annotation"),
    authorId: text("author_id"),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: created(),
  },
  (t) => [index("comments_target").on(t.targetType, t.targetId)],
);

/** Structured creative feedback that steers future retrieval, planning and ranking. */
export const creativeDecisions = pgTable(
  "creative_decisions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    /** selection | rejection | correction | preference | rule | pattern | consistency_issue */
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    detail: text("detail").notNull().default(""),
    department: text("department"),
    characterIds: json<string[]>("character_ids").notNull().default([]),
    tags: json<string[]>("tags").notNull().default([]),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    /** Rules always retrieved; others ranked by relevance. */
    isRule: boolean("is_rule").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: created(),
  },
  (t) => [index("decisions_org").on(t.orgId, t.active)],
);

/* ------------------------------------------------------------------ */
/* Department records                                                  */
/* ------------------------------------------------------------------ */

export const socialVideos = pgTable("social_videos", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  productionId: text("production_id").notNull().references(() => productions.id, { onDelete: "cascade" }),
  conceptId: text("concept_id").notNull(),
  title: text("title").notNull(),
  platform: text("platform").notNull(),
  format: text("format").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  concept: json<Record<string, unknown>>("concept").notNull(),
  script: json<Record<string, unknown> | null>("script"),
  captions: json<Record<string, unknown> | null>("captions"),
  status: text("status").notNull().default("concept"),
  createdAt: created(),
  updatedAt: updated(),
});

export const storyboards = pgTable("storyboards", {
  id: text("id").primaryKey(),
  socialVideoId: text("social_video_id").notNull().references(() => socialVideos.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  notes: text("notes").notNull().default(""),
  createdAt: created(),
});

export const shots = pgTable(
  "shots",
  {
    id: text("id").primaryKey(),
    storyboardId: text("storyboard_id").notNull().references(() => storyboards.id, { onDelete: "cascade" }),
    socialVideoId: text("social_video_id").notNull().references(() => socialVideos.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    description: text("description").notNull(),
    camera: text("camera").notNull().default(""),
    action: text("action").notNull().default(""),
    dialogue: text("dialogue").notNull().default(""),
    speakerCharacterId: text("speaker_character_id"),
    sound: text("sound").notNull().default(""),
    durationSeconds: real("duration_seconds").notNull(),
    characterIds: json<string[]>("character_ids").notNull().default([]),
    continuity: text("continuity").notNull().default(""),
    /** Lineage ids of the current frame / video / voice deliverables. */
    frameLineageId: text("frame_lineage_id"),
    videoLineageId: text("video_lineage_id"),
    voiceLineageId: text("voice_lineage_id"),
    locked: boolean("locked").notNull().default(false),
    createdAt: created(),
  },
  (t) => [index("shots_video").on(t.socialVideoId, t.index)],
);

export interface TimelineData {
  clips: { shotId: string; generatedAssetId: string; inSeconds: number; outSeconds: number }[];
  audio: { generatedAssetId: string; startSeconds: number; gainDb: number; kind: "voice" | "music" | "sfx" }[];
  captions: { startSeconds: number; endSeconds: number; text: string }[];
}

export const timelines = pgTable("timelines", {
  id: text("id").primaryKey(),
  socialVideoId: text("social_video_id").notNull().references(() => socialVideos.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  data: json<TimelineData>("data").notNull(),
  renderAssetId: text("render_asset_id"),
  status: text("status").notNull().default("draft"),
  createdAt: created(),
});

export const productConcepts = pgTable("product_concepts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  productionId: text("production_id").references(() => productions.id, { onDelete: "set null" }),
  lineageId: text("lineage_id").notNull(),
  iteration: integer("iteration").notNull().default(1),
  rangeName: text("range_name"),
  name: text("name").notNull(),
  category: text("category").notNull(),
  characterIds: json<string[]>("character_ids").notNull().default([]),
  description: text("description").notNull().default(""),
  materials: text("materials").notNull().default(""),
  dimensions: text("dimensions").notNull().default(""),
  packaging: text("packaging").notNull().default(""),
  targetAudience: text("target_audience").notNull().default(""),
  /** All commercial figures are ESTIMATES until `quoteVerified` is true. */
  targetRetailCents: integer("target_retail_cents"),
  estUnitCostCents: integer("est_unit_cost_cents"),
  moqAssumption: integer("moq_assumption"),
  marginScenarios: json<{ label: string; unitCostCents: number; retailCents: number; wholesaleCents: number; marginPct: number }[]>("margin_scenarios").notNull().default([]),
  feasibilityRisks: json<string[]>("feasibility_risks").notNull().default([]),
  licensingOpportunities: json<string[]>("licensing_opportunities").notNull().default([]),
  quoteVerified: boolean("quote_verified").notNull().default(false),
  status: text("status").$type<ReviewStatus>().notNull().default("draft"),
  createdAt: created(),
  updatedAt: updated(),
});

export interface GameAssetSpec {
  targetEngine: string;
  category: string;
  width: number;
  height: number;
  aspectRatio: string;
  transparency: boolean;
  fileFormat: "png" | "webp" | "jpeg";
  animation: { frames: number; fps: number; layout: "none" | "horizontal" | "grid" };
  colourSpace: "srgb";
  namingPattern: string;
  targetPlatform: string;
  maxFileKb: number;
}

export const gameAssets = pgTable("game_assets", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  productionId: text("production_id").references(() => productions.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  collection: text("collection").notNull().default("Unsorted"),
  spec: json<GameAssetSpec>("spec").notNull(),
  /** concept | validation_failed | technically_validated | approved */
  status: text("status").notNull().default("concept"),
  sourceGeneratedAssetId: text("source_generated_asset_id"),
  sourceReferenceVersionId: text("source_reference_version_id"),
  /** The processed, export-ready file. */
  storageKey: text("storage_key"),
  validation: json<{ checkedAt: string; passed: boolean; checks: { name: string; passed: boolean; detail: string }[] } | null>("validation"),
  characterIds: json<string[]>("character_ids").notNull().default([]),
  createdAt: created(),
  updatedAt: updated(),
});

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  productionId: text("production_id").references(() => productions.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  objective: text("objective").notNull().default(""),
  status: text("status").notNull().default("draft"),
  startsOn: ts("starts_on"),
  endsOn: ts("ends_on"),
  data: json<Record<string, unknown>>("data").notNull().default({}),
  createdAt: created(),
});

export const calendarItems = pgTable("calendar_items", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** deadline | publish | milestone | review */
  kind: text("kind").notNull(),
  date: ts("date").notNull(),
  productionId: text("production_id").references(() => productions.id, { onDelete: "cascade" }),
  platform: text("platform"),
  status: text("status").notNull().default("scheduled"),
  notes: text("notes").notNull().default(""),
  createdAt: created(),
});

export const analyticsRecords = pgTable(
  "analytics_records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    /** csv | connector:<name> */
    source: text("source").notNull(),
    importBatch: text("import_batch").notNull(),
    platform: text("platform").notNull(),
    postId: text("post_id").notNull(),
    postedAt: ts("posted_at"),
    title: text("title").notNull().default(""),
    characterIds: json<string[]>("character_ids").notNull().default([]),
    format: text("format"),
    theme: text("theme"),
    /** Null = not supplied by the source. Never invented. */
    views: integer("views"),
    watchTimeSeconds: doublePrecision("watch_time_seconds"),
    avgRetentionPct: real("avg_retention_pct"),
    shares: integer("shares"),
    saves: integer("saves"),
    likes: integer("likes"),
    comments: integer("comments"),
    followerDelta: integer("follower_delta"),
    raw: json<Record<string, string>>("raw").notNull().default({}),
    importedAt: created(),
  },
  (t) => [uniqueIndex("analytics_org_platform_post").on(t.orgId, t.platform, t.postId)],
);

export interface WorkflowStepDef {
  key: string;
  name: string;
  agent: string | null;
  handler: string;
  dependsOn: string[];
  config?: Record<string, unknown>;
  condition?: { step: string; path: string; op: "eq" | "neq" | "gt" | "lt" | "truthy" | "falsy"; value?: unknown } | null;
  requiresApproval?: boolean;
  maxAttempts?: number;
  budgetEstimateCents?: number;
}

export const workflowTemplates = pgTable(
  "workflow_templates",
  {
    id: text("id").primaryKey(),
    /** Null for built-in templates. */
    orgId: text("org_id").references(() => organisations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    department: text("department").notNull(),
    description: text("description").notNull().default(""),
    briefSchema: text("brief_schema").notNull(),
    steps: json<WorkflowStepDef[]>("steps").notNull(),
    version: integer("version").notNull().default(1),
    builtIn: boolean("built_in").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("workflow_templates_org_key").on(t.orgId, t.key)],
);

/* ------------------------------------------------------------------ */
/* Infrastructure: durable jobs, costs, audit, retrieval               */
/* ------------------------------------------------------------------ */

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    type: text("type").notNull(),
    payload: json<Record<string, unknown>>("payload").notNull(),
    /** queued | running | succeeded | failed | cancelled */
    status: text("status").notNull().default("queued"),
    /** Guarantees a unit of work is enqueued at most once. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: ts("run_after").notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: ts("locked_at"),
    lastError: text("last_error"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("jobs_status_run_after").on(t.status, t.runAfter)],
);

export const costRecords = pgTable(
  "cost_records",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    productionId: text("production_id"),
    stepId: text("step_id"),
    runId: text("run_id"),
    /** Autonomous agent-team mission the spend belongs to. */
    missionId: text("mission_id"),
    provider: text("provider").notNull(),
    model: text("model"),
    capability: text("capability").notNull(),
    units: json<Record<string, number>>("units").notNull().default({}),
    costCents: doublePrecision("cost_cents").notNull(),
    /** Costs are list-price estimates unless reconciled with a provider invoice. */
    estimated: boolean("estimated").notNull().default(true),
    createdAt: created(),
  },
  (t) => [index("cost_org_created").on(t.orgId, t.createdAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    actorUserId: text("actor_user_id"),
    actorAgent: text("actor_agent"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    data: json<Record<string, unknown>>("data").notNull().default({}),
    createdAt: created(),
  },
  (t) => [index("audit_org_created").on(t.orgId, t.createdAt), index("audit_target").on(t.targetType, t.targetId)],
);

/** Embedding chunks for semantic retrieval. Structured canon is always queried first. */
export const embeddings = pgTable(
  "embeddings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    text: text("text").notNull(),
    vector: real("vector").array().notNull(),
    model: text("model").notNull(),
    createdAt: created(),
  },
  (t) => [index("embeddings_source").on(t.orgId, t.sourceType, t.sourceId)],
);


const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

/** File bodies when STORAGE_BACKEND=db (serverless hosts without object storage). */
export const storedFiles = pgTable("stored_files", {
  key: text("key").primaryKey(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  createdAt: created(),
});

/* ------------------------------------------------------------------ */
/* Autonomous agent team                                               */
/* ------------------------------------------------------------------ */

/** A goal handed to the agent team. The Studio Director plans and delegates. */
export const missions = pgTable(
  "missions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    goal: text("goal").notNull(),
    /** running | awaiting_approval | paused | completed | failed | cancelled | blocked */
    status: text("status").notNull().default("running"),
    characterIds: json<string[]>("character_ids").notNull().default([]),
    budgetCents: integer("budget_cents").notNull(),
    spentCents: doublePrecision("spent_cents").notNull().default(0),
    report: text("report"),
    error: text("error"),
    createdBy: text("created_by"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("missions_org").on(t.orgId, t.createdAt)],
);

export interface TranscriptEntry {
  at: string;
  /** note: what the agent says it's doing · tool: a tool call · result: tool output · handoff: delegation · human: approval decision */
  kind: "note" | "tool" | "result" | "handoff" | "human" | "error";
  text: string;
  tool?: string;
  data?: unknown;
}

/** One agent's piece of a mission – its own tool-using loop. */
export const missionTasks = pgTable(
  "mission_tasks",
  {
    id: text("id").primaryKey(),
    missionId: text("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    parentTaskId: text("parent_task_id"),
    agentKey: text("agent_key").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions").notNull(),
    depth: integer("depth").notNull().default(0),
    /** queued | running | waiting_team | waiting_approval | done | failed | cancelled | blocked */
    status: text("status").notNull().default("queued"),
    /** Provider message history (append-only) so a waiting task can resume exactly. */
    messages: json<unknown[]>("messages").notNull().default([]),
    /** Tool call waiting on teammates or a human decision. */
    pendingToolUseId: text("pending_tool_use_id"),
    pendingApprovalId: text("pending_approval_id"),
    /** Results of other tool calls from the same turn, held until the task resumes. */
    pendingResults: json<{ id: string; content: string; isError: boolean }[]>("pending_results").notNull().default([]),
    /** Provider the conversation is bound to (message formats differ by provider). */
    provider: text("provider"),
    transcript: json<TranscriptEntry[]>("transcript").notNull().default([]),
    report: text("report"),
    outputs: json<{ type: string; id: string; title: string }[]>("outputs").notNull().default([]),
    turns: integer("turns").notNull().default(0),
    costCents: doublePrecision("cost_cents").notNull().default(0),
    error: text("error"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("mission_tasks_mission").on(t.missionId), index("mission_tasks_status").on(t.orgId, t.status)],
);

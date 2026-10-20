# CALMLINGS OS – Architecture

## Principles

1. **Canon is human-approved.** Every canon-bearing record has an explicit status: official, draft, experimental, ai_proposal, rejected or archived. Agents only read *official* canon and *approved* references. Anything an agent proposes is stored as an AI proposal with a pending approval, and never overwrites existing canon.
2. **Never fake a result.** A missing provider, reference or budget turns into a typed error (`IntegrationRequiredError`, `BudgetExceededError`, `CanonGuardError`), and the step becomes BLOCKED with a reason and a setup link. There is no placeholder output.
3. **Durable and idempotent.** Productions are persisted state machines. Jobs carry idempotency keys. Media generation is idempotent per item and generation, so stopping and resuming never duplicates finished work. Locked items are never regenerated.
4. **Provenance everywhere.** Every generated asset records the reference *version* ids, character profile versions, canon records and creative decisions it used, plus provider, model, prompt version, prompt, parameters, cost and parent.
5. **Typed collaboration.** Agents exchange Zod-validated artifacts (`src/lib/workflows/schemas.ts`) through workflow steps, not free conversation.

## Module map

```
src/db/schema.ts              relational schema (39 tables)
src/lib/auth                  sessions, roles, permission matrix
src/lib/storage               local / S3 storage, signed URLs
src/lib/files                 content sniffing, media probing, document text, malware-scan hook
src/lib/brain                 characters (+ Character Lock), canon, references, analysis, context packs,
                              decisions log, embeddings + semantic search, originality screen
src/lib/providers             definitions (capabilities per model), adapters, gateway (credentials,
                              status, discovery, router, metering)
src/lib/agents                45 agent definitions, agent runner (AgentRun records), schema conversion
src/lib/workflows             templates + step library, registry/validation, engine (state machine),
                              runtime (step execution), handlers (agent tasks, media, assembly, export…),
                              planner (Studio Director)
src/lib/jobs                  durable queue, worker, job handlers
src/lib/media                 FFmpeg timeline assembly, captions, loudness and technical QA
src/lib/game                  deterministic validation, sprite sheets, exporter adapters
src/lib/analytics             CSV import, honest statistics, overview
src/app                       pages (16 sections + detail pages) and API routes
```

## Data model (core entities)

Organisation, User, Membership (role), Session · Character, CharacterVersion, CanonRecord (world/lore/brand/production, versioned through `lineageId`/`previousId`) · ReferenceAsset, AssetVersion, AssetCharacter, AssetProject, AssetTag · Project, Production, ProductionStep · Agent (per-organisation configuration), AgentRun, ToolInvocation · Provider, ProviderCredential (encrypted) · GeneratedAsset (lineage/version/parent, provenance, advisory consistency report), Review, Approval, Comment (with region annotation), CreativeDecision · SocialVideo, Storyboard, Shot, Timeline, ProductConcept (iterations, estimates), GameAsset (spec and validation), Campaign, CalendarItem, AnalyticsRecord · WorkflowTemplate, Job, CostRecord, AuditEvent, Embedding.

Locations are canon records of kind `location` in the world domain, so they share versioning and approval with the rest of the canon.

## Retrieval: the context pack

`buildContextPack(orgId, { characterIds, department, query })`:

1. Approved character profile versions only. Characters without an approved profile are listed as *missing canon*, and agents are told not to invent them.
2. Approved references (official masters first, then by view angle). **Isolation rule:** a reference is included only when *all* of its linked characters are in the requested cast. Group shots therefore never leak into a single character's generation context. Reference-less world assets are included only for world-type asset types.
3. Official, non-superseded canon records that are global or relevant to the cast.
4. Active creative rules (always included) plus recent relevant decisions.
5. Supporting semantic hits over approved sources when embeddings are available; otherwise a lexical fallback, with the mode reported.

The pack is rendered as a stable, cacheable system context. Its ids are stored on the AgentRun and in each generated asset's provenance.

## Workflow engine

- Templates are data (`WorkflowStepDef[]`), validated for unique keys, known handlers and agents, existing dependencies and no cycles.
- A production snapshots its template's steps, so later template edits never change a running production.
- `advance()` locks the production row (`SELECT … FOR UPDATE`) and loops until stable. For each pending step whose dependencies are completed or skipped it either evaluates the condition and skips the step, opens a human gate, or queues the step as a job with key `step:<id>:<queueSeq>`.
- The runtime runs the handler with a `StepCtx`: brief, upstream outputs, context pack, revision notes, provider routing and a budget guard. Outcomes map to completed, awaiting approval, blocked (integration/budget/canon lock), queued with backoff (retryable provider error), or failed.
- Costs are recomputed from `cost_records`, which include failed attempts.
- Human actions: approve plan/start, pause, resume, stop, retry, re-run (with notes; downstream steps reset, locked items kept), skip, select, approve, request changes (re-runs the reviewed step), edit output (schema-validated), raise budget.

## Agent team (missions)

- `startMission` creates a `missions` row and a root `mission_tasks` row for the Studio Director. Each task runs as an `agent_task` job.
- `runAgentTask` claims the task (queued → running) and loops provider turns through the gateway's `tool_use` route. It appends native provider messages unchanged, so a task can resume exactly.
- Tools live in `src/lib/agents/tools.ts` and reuse the same services and permission checks as the UI:
  - Everyone: `list_characters`, `search_canon`, `list_references`, `write_document`, `request_approval`, `get_performance_data`.
  - Agents with the right permission: `generate_image` (approved references only), `propose_canon` (draft only).
  - Leads (executive department, depth < 2): `delegate`, `await_reports`, `propose_production`.
- A task suspends for two reasons:
  - `waiting_team`: waiting on delegated work. The last child to finish re-queues the parent with tool results in call order.
  - `waiting_approval`: waiting on a human. Deciding the approval calls `resumeAfterDecision`.
- Limits: depth 2, 30 tasks and 16 turns per task per mission. The mission budget is checked against `cost_records.mission_id` before every turn, and an overrun blocks the mission.
- `officeState` derives each agent's status (working, queued, waiting, blocked, idle) and recent hand-offs from tasks and running production steps. The 3D office polls it from `/api/office`.

## Providers

Each model declares its capabilities: `text, vision, structured, search, tool_use, image_generation, image_edit, video_generation, speech, transcription, music, sound_effects, embeddings`. The router picks among connected, enabled providers in preference order, scoring for quality preference, reference support and transparency.

- A manual override is honoured or fails with the reason; the router never silently swaps providers.
- Calls that send proprietary files only route to providers flagged *allow proprietary references*.
- **Test connection** lists the models visible to the account (capability discovery) and records status and errors.

## Security

- Every query is scoped by `org_id`. Storage keys are prefixed `orgs/<orgId>/` and served through HMAC-signed, expiring URLs (or S3 presigned URLs) with `nosniff` and a restrictive CSP.
- Passwords use scrypt. Session tokens are stored as SHA-256 hashes and expire after 14 days. Login is rate-limited.
- Provider keys are stored AES-256-GCM encrypted and never leave the server.
- Uploads are content-sniffed (bytes must match an allowed type), size-limited, optionally ClamAV-scanned, and stored with SHA-256 hashes.
- The audit log covers canon, approval, credential, export, upload and access events.
- Data export (JSON) and the retention purge (files of rejected generations only) are available in Settings.

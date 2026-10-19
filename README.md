# CALMLINGS OS

The AI-native production operating system for the Calmlings entertainment universe: one shared creative brain, 45 specialist agents, durable production pipelines and human approval at every point that matters.

Humans keep creative ownership, canon authority and every final approval. The system plans, coordinates, generates, organises, retrieves, formats and checks.

> **Uploaded references are the source of truth.** CALMLINGS OS never invents what a Calmlings character looks like. Agents only receive *approved* canon and *approved* references. Wherever artwork is missing, the interface shows a clearly labelled neutral placeholder.

---

## Quick start

Requirements: Node 22+. PostgreSQL 16 is recommended; without it the app uses an embedded PGlite database (real Postgres compiled to WASM, persisted in `DATA_DIR`).

```bash
npm install
cp .env.example .env.local      # set DATABASE_URL, APP_SECRET, CREDENTIALS_ENCRYPTION_KEY
npm run dev                     # http://localhost:3000 → first-run setup wizard
```

1. **Setup wizard** (`/setup`): create the studio workspace and the owner account.
2. **Settings & Integrations**: connect providers. Keys come from environment variables or are stored AES-256-GCM encrypted (requires `CREDENTIALS_ENCRYPTION_KEY`). Use **Test connection** to see which models your account can actually reach.
3. **Approve providers for proprietary references.** Reference *files* are never sent to a provider until you tick "Allow proprietary reference files" for it, after reviewing its terms. This is off by default. It is required for image-guided generation, reference analysis and consistency review.
4. **Character Universe**: create characters. **Reference Library**: upload official material, designate Official Masters, then approve each character's profile version.
5. Start from the **Mission Control** command bar ("What should we create today?") or from a studio. Each production opens as an editable execution plan. Nothing costly runs until you approve it.

Migrations run automatically at startup (`npm run db:migrate` runs them manually). The background worker runs inside the web process by default. For larger deployments, set `IN_PROCESS_WORKER=off` and run one or more `npm run worker` processes.

### Deploying on Vercel

The app adapts to Vercel automatically (no `vercel.json` needed):

- **Database:** set `DATABASE_URL` (or `POSTGRES_URL`) to a PostgreSQL database, e.g. Vercel → Storage → Neon Postgres, then redeploy. **Without it**, Vercel runs a temporary built-in database in `/tmp`. Everything resets on restart, and each serverless instance has its own copy (you may see the setup page again). Mission Control shows a warning while this is the case.
- **Files:** stored inside the database unless you configure S3-compatible storage (`S3_*` variables, e.g. Cloudflare R2).
- **Background jobs:** there's no long-lived worker, so jobs run in short bursts via `/api/jobs/tick` while someone has the studio open. To keep work moving when nobody is around, call `GET /api/jobs/tick` from a scheduler with `Authorization: Bearer $CRON_SECRET`.
- **Limits:** Vercel caps request bodies at about 4.5 MB, so upload large references in smaller batches or use Railway/Docker. Long video jobs are more reliable on a host with a persistent worker.
- Also set `APP_SECRET` and `CREDENTIALS_ENCRYPTION_KEY`.

### Production deployment (Docker / Railway)

- `Dockerfile` and `railway.json` are included. Mount a persistent volume at `/data`.
- Set `DATABASE_URL` (managed PostgreSQL), `APP_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, and optionally `STORAGE_BACKEND=s3` plus the `S3_*` variables.
- Backups: run `pg_dump` nightly and turn on bucket versioning. With PGlite, back up `DATA_DIR`.
- Optional: set `CLAMAV_ADDRESS=host:3310` to virus-scan uploads. Without it, uploads are content-validated and the UI says they are not scanned.

---

## Architecture (brief)

| Layer | Implementation |
|---|---|
| App | Next.js 15 App Router, React 19, TypeScript, Tailwind (custom design system, shadcn-style primitives) |
| Data | PostgreSQL via Drizzle ORM, with a versioned migration in `drizzle/`. PGlite fallback for local work |
| Storage | Local disk or any S3-compatible store; keys are namespaced per organisation; short-lived signed URLs |
| Jobs | Durable Postgres queue (`FOR UPDATE SKIP LOCKED`, idempotency keys, retries with backoff, stale-lock recovery) |
| Live updates | Server-sent events (`/api/live`) trigger server-component refreshes |
| Auth | Email/password (scrypt), revocable hashed session tokens, five roles, permission matrix enforced in every service |
| AI gateway | Provider registry, capability discovery, model router, metered calls (cost records + tool invocations), test doubles for automated tests only |
| Brain | Character versions + Character Lock, canon records (world/lore/brand/production) with DRAFT→official lifecycle, reference engine, context packs, creative decisions, embeddings (optional) |
| Orchestration | DAG workflow engine: typed step handlers, human gates, conditions, budget guards, per-item idempotent media generation |

Details are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### External API dependencies

| Provider | Used for | Env var |
|---|---|---|
| Anthropic | Planning, all writing/evaluation agents, vision analysis, consistency review, web search for research agents | `ANTHROPIC_API_KEY` |
| OpenAI | Alternative text/vision; image generation and editing (with transparency); speech; transcription; embeddings | `OPENAI_API_KEY` |
| Google Gemini | Alternative text/vision; Nano Banana image generation and editing; Veo video; embeddings | `GEMINI_API_KEY` |
| fal.ai | Nano Banana 2 images; Kling image-to-video | `FAL_KEY` |
| ElevenLabs | Speech, sound effects, music, transcription | `ELEVENLABS_API_KEY` |
| FFmpeg / ffprobe | Bundled (`ffmpeg-static`, `ffprobe-static`): probing, keyframes, timeline assembly, loudness QA | none |

---

## What works, what needs credentials, what isn't built

### Works now (no credentials needed)
- Setup wizard, sign-in, roles and permissions, organisation-scoped data, audit log, data export (JSON) and the retention purge.
- **Reference Upload Engine**: drag-and-drop batch upload of PNG/JPEG/WEBP/SVG/GIF/MP4/MOV/MP3/WAV/PDF/DOCX/TXT/MD/JSON/ZIP/GLB/GLTF. Files are content-sniffed, size-limited and stored as immutable versions with SHA-256. ZIPs are expanded. Technical metadata is extracted locally: dimensions, alpha, colour space, dominant colours, thumbnails; video duration/aspect/fps/codecs plus six sampled keyframes; PDF/DOCX text; glTF mesh/material/animation counts. Designations cover Official Master, Approved Supporting, Style Inspiration, Experimental, Rejected and Archived. Official masters can't be overwritten or deleted.
- **Character Universe**: encyclopedia cards, an 11-tab character page, full profile editor, version history with approval, the consistency checklist, view-coverage slots, and **Character Lock** (locked-field edits become change requests).
- **Calmlings Bible**: world, lore, brand and production canon with versioning, line diffs against official canon, and approve/reject. Includes a lore timeline and a relationship graph.
- **Workflow engine**: nine built-in pipelines (social video, game asset, product range, new character, campaign, story & lore, song → music video plan, partnership/licensing pitch, animation concepts). It supports an editable plan before start; pause, stop, resume, retry, re-run with notes and skip; selection and review gates; per-step provider overrides; budget blocks with spend approvals; and a visual **workflow builder** (DAG view, dependencies, branching conditions, retries, estimates, approvals, custom agent steps).
- Honest blocking: with no provider connected, steps become **BLOCKED** with the exact missing integration and a "Fix →" link. No output is fabricated. This is acceptance test D, verified in the browser.
- **Game Studio** deterministic tooling: conform to spec, validation of dimensions, transparency, format, naming, size, frames and metadata, the asset browser, collection export bundles, and the sprite-sheet/atlas builder (TexturePacker-style JSON).
- **Analytics**: CSV import with column aliasing. Missing metrics stay blank. Breakdowns by character, format, theme and platform carry sample-size-capped confidence, and recommendations are observational.
- **Learning**: every selection, rejection, change request and approval is logged as a creative decision. Rules are injected into future agent context. Repeated corrections are surfaced as suggested rules.
- Approvals centre, production calendar, Mission Control (live), and global search (keyword; semantic when an embeddings provider is connected).

### Needs provider credentials (code paths are implemented and covered by automated tests with test doubles)
- Natural-language planning (Studio Director) and every writing, evaluation and analysis agent: a text provider.
- Reference frames, product renders, mockups, key visuals and game assets: an image provider approved for proprietary references.
- Shot video and concept clips: fal.ai or Google Veo. Image-to-video always starts from an approved or latest frame.
- Voice lines: ElevenLabs or OpenAI, using only voices assigned in approved character canon with a recorded consent note.
- Music beds and demos: ElevenLabs.
- Automated consistency review and creative QA: a vision model. These scores are advisory and never proof of identity.
- Semantic retrieval: an embeddings provider. Without one, retrieval falls back to keyword matching and the UI says so.

> **Not verified against live endpoints.** I couldn't call the real provider APIs while building this (no keys were available). The Anthropic adapter follows the current SDK patterns. The OpenAI, Gemini, Veo, fal and ElevenLabs adapters are written against their documented REST APIs. Run **Test connection** in Settings and a small production before relying on them.

### Not implemented yet
- Direct platform connectors for analytics (TikTok/Instagram/YouTube OAuth) and publishing; use CSV import and manual publishing.
- Direct engine/repo sync (Unity, Unreal, Godot, GitHub). The exporter interface exists (`src/lib/game/exporters.ts`), but only the generic ZIP + atlas exporter is implemented.
- Automatic background removal for providers that can't output alpha. Validation then fails honestly and suggests routing to a transparency-capable model.
- Lip sync, rigged 3D animation, and DCC round-tripping. GLB/GLTF files are imported and inspected, and a handoff checklist is provided.
- PPTX export of pitch decks (they are Markdown documents), SSO/OAuth sign-in, email invitations (members get a temporary password), and a multi-organisation switcher in the UI (the data model already supports it).
- Annotation regions on video (video comments are timeline-free).

---

## Tests

```bash
npm test                     # 27 tests on embedded PGlite
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/calmlings_test npm test   # same suite on PostgreSQL
npm run lint && npm run typecheck && npm run build
```

| Acceptance test | Where |
|---|---|
| **A** upload official reference → profile → approve → retrieve from another workspace | `tests/acceptance.test.ts` (A) + `e2e/studio.spec.ts` |
| **B** social brief → concepts from canon → choose → script + storyboard → persisted → resumes after refresh | `tests/pipeline.test.ts` |
| **C** generate with a provider → linked references → request changes → regenerate → compare → approve → export | `tests/acceptance.test.ts` (C) |
| **D** disconnected provider → real integration requirement, no fake output | `tests/acceptance.test.ts` (D) + `e2e/studio.spec.ts` |
| **E** second character's references never contaminate the first's generation context | `tests/acceptance.test.ts` (E) |
| **F** stop mid-run → restart without duplicating completed jobs or losing approvals | `tests/pipeline.test.ts` (F) |
| **G** permissions, asset versioning, provider failures/retries, budget blocks, state transitions, idempotency | `tests/units.test.ts`, `tests/planner.test.ts` |

The automated tests swap HTTP adapters for deterministic test doubles. Those doubles can only be installed under the test runner, so the running app can never use them.

**End-to-end (browser):** start the app against a fresh database, then run `E2E_BASE_URL=http://localhost:3000 npx playwright test`. The flow runs first-time setup, creates a character, uploads and designates a master reference, approves canon, plans and starts a production, and checks that the missing-provider block is shown honestly.

---

## Credits

The originality screen (`src/lib/brain/originality.ts`), the analytics statistics (`src/lib/analytics/stats.ts`), the animatic/caption/mix approach in `src/lib/media/assemble.ts` and the bundled DejaVu fonts are adapted from the WEBSTER engine in [`seanwebsters/ipgenerator`](https://github.com/seanwebsters/ipgenerator). Provider adapter patterns (Gemini/fal image calls, ElevenLabs) are adapted from `seanwebsters/Test2` (calm-stories). The WEBSTER procedural character renderer was deliberately **not** reused: Calmlings designs must come from uploaded references only.

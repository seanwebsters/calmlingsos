/**
 * Generic agent step: build the task prompt from the brief and upstream
 * artifacts, run the assigned agent with the canon pack, validate the typed
 * output, then apply step-specific post-processing (persisting storyboards,
 * originality screening, document deliverables…).
 */
import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { newId } from "@/lib/ids";
import { AppError } from "@/lib/errors";
import { runAgent } from "@/lib/agents/run";
import { capabilityAvailable } from "@/lib/providers/gateway";
import { screenOriginality } from "@/lib/brain/originality";
import { createGeneratedAsset } from "@/lib/review/assets";
import { S, PLATFORMS, type Out, type SchemaKey } from "../schemas";
import { STEP_TYPES } from "../templates";
import type { StepCtx, StepResult } from "../runtime";
import { briefLines, castLine, deckToMarkdown, docToMarkdown, provenanceFor, resolveCharacters, revisionBlock, stripInternal } from "./common";

type PromptBuilder = (ctx: StepCtx) => Promise<string> | string;

const out = (ctx: StepCtx, key: string) => ctx.outputs[key] as Record<string, unknown> | undefined;
const json = (v: unknown, max = 20000) => JSON.stringify(v ? stripInternal(v as Record<string, unknown>) : null, null, 1).slice(0, max);
const firstOutputWith = <T,>(ctx: StepCtx, field: string): T | undefined => {
  for (const s of ctx.steps) if (s.status === "completed" && s.output && field in s.output) return (s.output as Record<string, unknown>)[field] as T;
  return undefined;
};

function selectedConcepts(ctx: StepCtx) {
  const concepts = firstOutputWith<Out<"concepts">["concepts"]>(ctx, "concepts") ?? [];
  const sel = (out(ctx, "select")?.selected as string[] | undefined) ?? concepts.slice(0, Number(ctx.brief.produceCount ?? 1)).map((c) => c.id);
  return concepts.filter((c) => sel.includes(c.id));
}

async function analyticsSummary(orgId: string): Promise<string> {
  const db = await getDb();
  const rows = await db.select().from(schema.analyticsRecords).where(eq(schema.analyticsRecords.orgId, orgId)).orderBy(desc(schema.analyticsRecords.views)).limit(30);
  if (!rows.length) return "No performance data has been imported yet. Do not assume any metrics.";
  return `Imported performance data (top ${rows.length} posts by views; null = not supplied):\n${rows.map((r) => `- [${r.platform}] "${r.title}" format=${r.format ?? "?"} theme=${r.theme ?? "?"} views=${r.views ?? "null"} shares=${r.shares ?? "null"} saves=${r.saves ?? "null"} retention=${r.avgRetentionPct ?? "null"}%`).join("\n")}`;
}

const DEPS = (ctx: StepCtx) => ctx.step.dependsOn.map((d) => `${d}:\n${json(out(ctx, d), 8000)}`).join("\n\n");

export const PROMPTS: Record<string, PromptBuilder> = {
  brand_check: (ctx) => {
    const checks = (ctx.step.config.checks as string[] | undefined) ?? ctx.step.dependsOn;
    return `Check the following work against the approved canon, every Character Lock, every FORBIDDEN CHANGE, every creative director rule and brand safety. Fail (passed=false) if there is any blocker. Cite the rule for each issue.\n\n${checks.map((k) => `${k}:\n${json(out(ctx, k))}`).join("\n\n")}`;
  },
  custom_agent_task: (ctx) => `${String(ctx.step.config.instructions ?? "Complete the task described in the brief.")}\n\nBrief:\n${briefLines(ctx.brief)}\n\nUpstream work:\n${DEPS(ctx)}`,

  social_research: async (ctx) => `Research for a Calmlings ${PLATFORMS[ctx.brief.platform as keyof typeof PLATFORMS]?.label ?? ctx.brief.platform} production.\nBrief:\n${briefLines(ctx.brief)}\n${castLine(ctx.pack)}\n\n${await analyticsSummary(ctx.orgId)}\n\nSummarise brand-safe trends, formats and what has worked before. Cite sources for anything external. List data gaps honestly.`,
  social_concepts: (ctx) => {
    const b = ctx.brief;
    return `Generate exactly ${b.conceptCount} DISTINCT short-form concepts (ids c1…c${b.conceptCount}).\nPlatform: ${PLATFORMS[b.platform as keyof typeof PLATFORMS]?.label} · ${b.durationSeconds}s · format: ${b.format}\nTheme: ${b.theme}\nEmotional message: ${b.emotionalMessage || "(choose one that fits the theme and canon)"}\nVisual style: ${b.visualStyle}\n${castLine(ctx.pack)}\nNotes: ${b.notes || "none"}\n\nResearch:\n${json(out(ctx, "research"), 6000)}\n\nEach concept: a hook that lands in 2 seconds, a clear emotional message about positive mental health, only cast characters (by code), and any canon questions it raises.`;
  },
  social_evaluate: (ctx) => `Evaluate every concept (0–10 each) for originality, emotional impact, shareability and brand fit, with rationale and risks. Then recommend which to produce (the brief asks for ${ctx.brief.produceCount}).\n\nConcepts:\n${json(out(ctx, "concepts"))}`,
  social_scripts: (ctx) => `Write a script for each selected concept, timed to ${ctx.brief.durationSeconds}s for ${PLATFORMS[ctx.brief.platform as keyof typeof PLATFORMS]?.label}. Beats must have atSeconds within the duration. Dialogue only for cast characters (speaker = character code) or null for no speech. Keep each character's approved voice.\n${castLine(ctx.pack)}\n\nSelected concepts:\n${JSON.stringify(selectedConcepts(ctx), null, 1)}`,
  social_storyboards: (ctx) => `Turn each script into a shot-by-shot storyboard (3–8 shots, durations summing to the script duration, each shot 2–8s). For every shot give framing/camera, action, dialogue + speaker code, sound, the characters in shot (codes), continuity notes that keep identity on-model, a framePrompt for a still reference frame and a motionPrompt for image-to-video. Never describe character appearance beyond canon – the generator receives the approved reference images.\n${castLine(ctx.pack)}\n\nScripts:\n${json(out(ctx, "scripts"))}`,
  social_captions: (ctx) => `For each script write: caption (platform-appropriate length), 5–10 hashtags, 3 alternate hooks, thumbnail text, and timed on-screen captions for the dialogue/key lines (start/end seconds within the duration).\n\nScripts:\n${json(out(ctx, "scripts"))}`,

  game_concepts: (ctx) => `Propose exactly ${ctx.brief.count} game assets (ids g1…) for the Calmlings sanctuary/garden game.\nRequest: ${ctx.brief.request}\nTechnical spec: ${ctx.brief.targetEngine}, category ${ctx.brief.category}, ${ctx.brief.width}×${ctx.brief.height}, transparency ${ctx.brief.transparency ? "required" : "not required"}, ${ctx.brief.fileFormat}, ${ctx.brief.frames} frame(s), platform ${ctx.brief.targetPlatform}, max ${ctx.brief.maxFileKb}KB.\n${castLine(ctx.pack)}\nEach item: name, category, description, characters (codes, may be empty), an image prompt ("isolated single object, centred, readable silhouette at small size, flat plain background" when transparency is required), notes on technical constraints.`,
  product_research: (ctx) => `Research a ${ctx.brief.category} range for Calmlings.\nRequest: ${ctx.brief.request}\nRange name: ${ctx.brief.rangeName || "(propose)"} · audience: ${ctx.brief.targetAudience || "(propose)"} · price point: ${ctx.brief.pricePoint || "(propose)"}\n${castLine(ctx.pack)}\nCover positioning, retail channels, competitor landscape (cite sources or mark as assumption), and data gaps.`,
  product_concepts: (ctx) => `Propose exactly ${ctx.brief.count} ${ctx.brief.category} product concepts (ids p1…) forming a cohesive range.\nRequest: ${ctx.brief.request}\n${castLine(ctx.pack)}\nResearch:\n${json(out(ctx, "research"), 6000)}\nEach: name, category, characters (codes), description, materials, dimensions, target audience, colourway, and a renderPrompt for a product concept render (studio product shot; the generator gets approved character references).`,
  product_packaging: (ctx) => `Develop a packaging concept for each product (productId = its id): concept, materials, sustainability options, on-pack copy in brand voice, and a renderPrompt.\n\nProducts:\n${json(out(ctx, "concepts"))}`,
  product_costs: (ctx) => `Estimate unit economics for each product (productId = its id): estimated unit cost, target retail, wholesale (USD), MOQ assumption and explicit assumptions. These are ESTIMATES – say what a supplier quote must confirm.\n\nProducts:\n${json(out(ctx, "concepts"))}`,
  product_feasibility: (ctx) => `Assess manufacturing feasibility for each product (productId = its id): risks, required certifications (e.g. EN71, ASTM F963, CPSIA where relevant), and recommendations. You must not contact suppliers.\n\nProducts:\n${json(out(ctx, "concepts"))}`,
  pitch_pack: (ctx) => `Produce presentation-ready slide content (8–14 slides) that a human will review before any external use. Every claim must trace to canon or prior outputs, or be listed as an assumption.\n\nBrief:\n${briefLines(ctx.brief)}\n\nPrior work:\n${ctx.steps.filter((s) => s.status === "completed" && s.output && !["canon"].includes(s.key)).map((s) => `${s.name}:\n${json(s.output, 5000)}`).join("\n\n")}`,

  character_concept: (ctx) => `Propose ONE new character for the Calmlings universe.\nRequest: ${ctx.brief.request}\nExisting characters in canon (do not duplicate their roles or looks): ${ctx.pack.characters.map((c) => `${c.code} ${c.name}`).join(", ") || "none provided"}\nStyle inspiration available (style only – never copy identity): ${ctx.pack.styleInspiration.map((r) => r.title).join(", ") || "none"}\nThe character must have a clear emotional purpose about positive mental health. Provide 3–4 distinct designPrompts for explorations. This is a PROPOSAL for the creative director.`,
  character_canon_check: (ctx) => `Check this proposed character against official canon for contradictions (roles, relationships, lore) and list consistent points.\n\nProposal:\n${json(out(ctx, "concept"))}`,

  story_ideas: (ctx) => `Generate exactly ${ctx.brief.count} story ideas (ids i1…).\nRequest: ${ctx.brief.request}\n${castLine(ctx.pack)}\nNotes: ${ctx.brief.notes || "none"}`,
  story_develop: (ctx) => {
    const ideas = firstOutputWith<Out<"storyIdeas">["ideas"]>(ctx, "ideas") ?? [];
    const sel = (out(ctx, "select")?.selected as string[] | undefined) ?? ideas.map((i) => i.id);
    return `Develop the selected ideas into a document: one section per idea with a full story/treatment true to approved personalities. Anything that would add new lore must be flagged as a proposal in openQuestions.\n${castLine(ctx.pack)}\n\nSelected ideas:\n${JSON.stringify(ideas.filter((i) => sel.includes(i.id)), null, 1)}`;
  },
  lore_proposals: (ctx) => `From the developed stories, extract any NEW world or lore elements (locations, events, relationships, rules) as DRAFT CANON proposals. Only include things not already in official canon. Use character codes.\n\nStories:\n${json(out(ctx, "develop"))}`,
  lore_continuity: (ctx) => `Compare these lore proposals with the official canon in your context. List every contradiction with the record it conflicts with and resolution options.\n\nProposals:\n${json(out(ctx, "lore"))}`,

  song_concept: (ctx) => `Develop an original song concept.\nRequest: ${ctx.brief.request}\n${castLine(ctx.pack)}\nGive tempo, key, instrumentation, structure with section lengths, and an instrumental musicPrompt. No imitation of existing songs or artists.`,
  song_lyrics: (ctx) => `Write original lyrics for this song – singable, kind, age-appropriate.\n\nSong:\n${json(out(ctx, "song"))}`,
  music_video_treatment: (ctx) => `Write a music video treatment mapped section-by-section to the song structure, with a storyboard outline per section and production notes.\n\nSong:\n${json(out(ctx, "song"))}\n\nLyrics:\n${json(out(ctx, "lyrics"))}`,

  audience_research: async (ctx) => `Research the audience for this commercial brief.\n${briefLines(ctx.brief)}\n\n${await analyticsSummary(ctx.orgId)}\nCite sources; never invent statistics; list data gaps.`,
  partnership_strategy: (ctx) => `Develop a partnership concept${ctx.brief.partner ? ` with ${ctx.brief.partner}` : ""}.\nRequest: ${ctx.brief.request}\n${castLine(ctx.pack)}\nSections: Strategic rationale; Creative concept; Character fit; Activation ideas; Distribution ideas; Commercial assumptions (all estimates); Risks; Next steps (outreach requires explicit human approval).\n\nAudience research:\n${json(out(ctx, "audience"), 6000)}`,
  licensing_strategy: (ctx) => `Explore licensing categories for Calmlings.\nRequest: ${ctx.brief.request}\n${castLine(ctx.pack)}\nFor each category: fit, example partner types, considerations, estimated terms (as assumptions).`,
  mockup_concepts: (ctx) => `List ${ctx.brief.count} visual mockups (ids m1…) that would make this pitch tangible (product mockups, activation visuals, co-branded key art – never use the partner's logo or trademarks). Each with an image prompt.\n${castLine(ctx.pack)}\n\nStrategy:\n${json(out(ctx, "strategy"), 8000)}`,
  campaign_strategy: (ctx) => `Plan a marketing campaign.\nRequest: ${ctx.brief.request}\n${castLine(ctx.pack)}\nGive name, objective, audience, big idea, ${ctx.brief.count} concepts (ids k1…) with channels and a keyVisualPrompt, a schedule (dayOffset from launch), and measurable KPIs.`,
  animation_direction: (ctx) => `Create an animation ${String(ctx.brief.kind).replace(/_/g, " ")} plan with exactly ${ctx.brief.count} items (ids a1…).\nRequest: ${ctx.brief.request}\n${castLine(ctx.pack)}\nEvery pose/expression must sit inside each character's approved expression range, body language and animation rules. Each item: name, category (pose/expression/beat), description, characters (codes), an image prompt for a single clean frame on a neutral background.`,
};

/** Post-processing hooks by step type. */
const AFTER: Record<string, (ctx: StepCtx, data: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  social_evaluate: async (ctx, data) => {
    const concepts = (out(ctx, "concepts")?.concepts as Out<"concepts">["concepts"]) ?? [];
    const flags = Object.fromEntries(concepts.map((c) => [c.id, screenOriginality([{ field: "title", text: c.title, isName: true }, { field: "logline", text: c.logline }, { field: "hook", text: c.hook }])]));
    const scores = (data.scores as Out<"evaluation">["scores"]).map((s) => ({ ...s, total: Math.round(((s.originality + s.emotionalImpact + s.shareability + s.brandFit) / 4) * 10) / 10, originalityFlags: flags[s.conceptId] ?? [] }));
    scores.sort((a, b) => b.total - a.total);
    return { ...data, scores, ranking: scores.map((s) => s.conceptId), originalityNote: "Originality flags are a deterministic resemblance screen against well-known properties – not legal clearance." };
  },
  social_storyboards: async (ctx, data) => {
    const db = await getDb();
    const scripts = (out(ctx, "scripts")?.scripts as Out<"scripts">["scripts"]) ?? [];
    const concepts = selectedConcepts(ctx);
    const platform = String(ctx.brief.platform);
    const boards = data.storyboards as Out<"storyboards">["storyboards"];
    const persisted: { conceptId: string; socialVideoId: string; storyboardId: string; shotIds: string[] }[] = [];
    for (const b of boards) {
      const script = scripts.find((s) => s.conceptId === b.conceptId);
      const concept = concepts.find((c) => c.id === b.conceptId);
      let [video] = await db.select().from(schema.socialVideos).where(and(eq(schema.socialVideos.productionId, ctx.production.id), eq(schema.socialVideos.conceptId, b.conceptId)));
      if (!video) {
        const id = newId("svd");
        await db.insert(schema.socialVideos).values({ id, orgId: ctx.orgId, productionId: ctx.production.id, conceptId: b.conceptId, title: script?.title ?? concept?.title ?? b.conceptId, platform, format: String(ctx.brief.format), durationSeconds: Math.round(script?.durationSeconds ?? Number(ctx.brief.durationSeconds)), concept: (concept ?? {}) as Record<string, unknown>, script: (script ?? null) as Record<string, unknown> | null, status: "storyboard" });
        [video] = await db.select().from(schema.socialVideos).where(eq(schema.socialVideos.id, id));
      } else {
        await db.update(schema.socialVideos).set({ script: (script ?? null) as Record<string, unknown> | null, status: "storyboard", updatedAt: new Date() }).where(eq(schema.socialVideos.id, video.id));
      }
      const [prevBoard] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.socialVideoId, video.id)).orderBy(desc(schema.storyboards.version)).limit(1);
      const prevShots = prevBoard ? await db.select().from(schema.shots).where(eq(schema.shots.storyboardId, prevBoard.id)) : [];
      const storyboardId = newId("sbd");
      await db.insert(schema.storyboards).values({ id: storyboardId, socialVideoId: video.id, version: (prevBoard?.version ?? 0) + 1, notes: ctx.notes ?? "" });
      const shotIds: string[] = [];
      for (const s of b.shots) {
        // Locked shots carry over unchanged (with their approved frames/videos).
        const locked = prevShots.find((p) => p.index === s.index && p.locked);
        const id = newId("sht");
        await db.insert(schema.shots).values(
          locked
            ? { ...locked, id, storyboardId, createdAt: new Date() }
            : {
                id,
                storyboardId,
                socialVideoId: video.id,
                index: s.index,
                description: s.description,
                camera: s.camera,
                action: s.action,
                dialogue: s.dialogue,
                speakerCharacterId: resolveCharacters(ctx.pack, [s.speaker])[0] ?? null,
                sound: s.sound,
                durationSeconds: Math.max(1, Math.min(10, s.durationSeconds)),
                characterIds: resolveCharacters(ctx.pack, s.characters),
                continuity: `${s.continuity}\n[frame] ${s.framePrompt}\n[motion] ${s.motionPrompt}`,
                frameLineageId: prevShots.find((p) => p.index === s.index)?.frameLineageId ?? null,
              },
        );
        shotIds.push(id);
      }
      persisted.push({ conceptId: b.conceptId, socialVideoId: video.id, storyboardId, shotIds });
    }
    return { ...data, persisted };
  },
  social_captions: async (ctx, data) => {
    const db = await getDb();
    for (const p of data.packs as Out<"captions">["packs"]) {
      await db.update(schema.socialVideos).set({ captions: p as unknown as Record<string, unknown>, updatedAt: new Date() }).where(and(eq(schema.socialVideos.productionId, ctx.production.id), eq(schema.socialVideos.conceptId, p.conceptId)));
    }
    return data;
  },
  character_canon_check: async (ctx, data) => {
    const c = out(ctx, "concept") as Out<"characterConcept"> | undefined;
    const flags = c ? screenOriginality([{ field: "name", text: c.name, isName: true }, { field: "oneLiner", text: c.oneLiner }, { field: "appearance", text: c.appearance }]) : [];
    const db = await getDb();
    const clash = c ? await db.select({ id: schema.characters.id, name: schema.characters.name }).from(schema.characters).where(and(eq(schema.characters.orgId, ctx.orgId), sql`lower(${schema.characters.name}) = lower(${c.name})`)) : [];
    return { ...data, originalityFlags: flags, nameClash: clash };
  },
};

function deliverableMarkdown(schemaKey: SchemaKey, data: Record<string, unknown>): string | null {
  if (schemaKey === "document") return docToMarkdown(data as Out<"document">);
  if (schemaKey === "deck") return deckToMarkdown(data as Out<"deck">);
  return null;
}

export async function agentTask(ctx: StepCtx): Promise<StepResult> {
  const type = STEP_TYPES[String(ctx.step.config.type)];
  if (!type?.schemaKey) throw new AppError(`Step type ${ctx.step.config.type} has no output schema.`);
  const builder = PROMPTS[type.key];
  if (!builder) throw new AppError(`No prompt for step type ${type.key}.`);
  const agentKey = ctx.step.agentKey ?? type.agent;
  if (!agentKey) throw new AppError("No agent assigned to this step.");
  let capability: "structured" | "search" = "structured";
  if (["social_research", "audience_research", "product_feasibility", "licensing_strategy"].includes(type.key)) {
    const s = await capabilityAvailable(ctx.orgId, "search", ctx.route("search"));
    if (s.ok) capability = "search";
  }
  const prompt = (await builder(ctx)) + revisionBlock(ctx) + (capability === "structured" && type.key.includes("research") ? "\n\n(No web search provider is connected for this run – rely only on the supplied canon and imported data, and list external research as a data gap.)" : "");
  await ctx.ensureBudget(ctx.step.budgetEstimateCents);
  const res = await runAgent({
    orgId: ctx.orgId,
    agentKey,
    task: `${ctx.production.title} · ${ctx.step.name}`,
    prompt,
    schema: S[type.schemaKey] as unknown as import("zod").ZodType<Record<string, unknown>>,
    pack: ctx.pack,
    productionId: ctx.production.id,
    stepId: ctx.step.id,
    capability,
    route: ctx.route(capability),
    inputs: { stepType: type.key, brief: ctx.brief },
  });
  let data = res.data as Record<string, unknown>;
  if (AFTER[type.key]) data = await AFTER[type.key](ctx, data);
  const md = deliverableMarkdown(type.schemaKey, data);
  if (md && (ctx.step.config.deliverable || type.schemaKey === "deck")) {
    const title = String((data as { title?: string }).title ?? ctx.step.name);
    await createGeneratedAsset({
      orgId: ctx.orgId,
      productionId: ctx.production.id,
      stepId: ctx.step.id,
      itemKey: `doc:${ctx.step.key}`,
      kind: "document",
      role: "document",
      title,
      textContent: md,
      characterIds: ctx.production.characterIds,
      provenance: provenanceFor(ctx, [], { provider: res.provider, model: res.model, prompt: prompt.slice(0, 4000), parameters: { stepType: type.key, runId: res.runId, generation: ctx.step.generation } }),
      costCents: res.costCents,
    });
  }
  return { output: { ...data, _runId: res.runId, _provider: res.provider, _model: res.model, _costCents: res.costCents } };
}

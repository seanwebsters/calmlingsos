/**
 * Step library and built-in pipeline templates. Templates are data: the
 * workflow builder can copy, reorder, branch and extend them, and every
 * production snapshots its steps so later template edits never change a
 * running production.
 */
import type { WorkflowStepDef } from "@/db/schema";
import type { Capability } from "@/lib/providers/types";
import type { BriefSchemaKey, SchemaKey } from "./schemas";

export interface StepType {
  key: string;
  label: string;
  handler: string;
  agent: string | null;
  schemaKey?: SchemaKey;
  inputSchema: string;
  outputSchema: string;
  description: string;
  capabilities: Capability[];
  estimateCents: number;
  human?: boolean;
}

const st = (s: StepType) => s;

export const STEP_TYPES: Record<string, StepType> = Object.fromEntries(
  [
    st({ key: "canon_retrieval", label: "Canon retrieval", handler: "canon_retrieval", agent: null, inputSchema: "brief + cast", outputSchema: "ContextPack", description: "Retrieve approved character versions, references, canon and rules for the cast. Deterministic.", capabilities: [], estimateCents: 0 }),
    st({ key: "human_select", label: "Creative director selection", handler: "human_select", agent: null, inputSchema: "candidate list", outputSchema: "{ selected: id[] }", description: "Pause for the creative director to choose.", capabilities: [], estimateCents: 0, human: true }),
    st({ key: "human_review", label: "Human review gate", handler: "human_review", agent: null, inputSchema: "deliverables", outputSchema: "approval", description: "Pause until a human approves or requests changes.", capabilities: [], estimateCents: 0, human: true }),
    st({ key: "brand_check", label: "Brand Guardian check", handler: "agent_task", agent: "brand_guardian", schemaKey: "brandCheck", inputSchema: "prior outputs", outputSchema: "brandCheck", description: "Check prior outputs against canon, Character Lock and brand safety.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "custom_agent_task", label: "Custom agent task", handler: "agent_task", agent: "studio_director", schemaKey: "custom", inputSchema: "prior outputs + instructions", outputSchema: "custom", description: "Any agent, your instructions, a structured document out.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "export_bundle", label: "Export bundle", handler: "export_bundle", agent: "production_manager", inputSchema: "approved deliverables", outputSchema: "zip bundle", description: "Package approved deliverables with metadata and provenance.", capabilities: [], estimateCents: 0 }),
    // Social
    st({ key: "social_research", label: "Trend & performance research", handler: "agent_task", agent: "trend_researcher", schemaKey: "research", inputSchema: "brief + analytics", outputSchema: "research", description: "Brand-safe trends and what has worked before (real imported data only).", capabilities: ["structured"], estimateCents: 10 }),
    st({ key: "social_concepts", label: "Concept generation", handler: "agent_task", agent: "comedy_writer", schemaKey: "concepts", inputSchema: "brief + research", outputSchema: "concepts", description: "Distinct short-form concepts in approved canon.", capabilities: ["structured"], estimateCents: 12 }),
    st({ key: "social_evaluate", label: "Concept evaluation", handler: "agent_task", agent: "creative_director_agent", schemaKey: "evaluation", inputSchema: "concepts", outputSchema: "evaluation", description: "Score originality, emotional impact, shareability and brand fit (+ originality screen).", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "social_scripts", label: "Scripts", handler: "agent_task", agent: "short_form_scriptwriter", schemaKey: "scripts", inputSchema: "selected concepts", outputSchema: "scripts", description: "Timed scripts with hooks and dialogue.", capabilities: ["structured"], estimateCents: 10 }),
    st({ key: "social_storyboards", label: "Storyboards", handler: "agent_task", agent: "storyboard_artist", schemaKey: "storyboards", inputSchema: "scripts", outputSchema: "storyboards + shots", description: "Shot-by-shot boards with continuity, frame and motion prompts.", capabilities: ["structured"], estimateCents: 12 }),
    st({ key: "social_frames", label: "Reference frames", handler: "shot_frames", agent: "social_video_producer", inputSchema: "shots + approved references", outputSchema: "image per shot", description: "One reference frame per shot, generated with the cast's approved references.", capabilities: ["image_edit"], estimateCents: 6 }),
    st({ key: "consistency_review", label: "Visual consistency review", handler: "consistency_review", agent: "visual_consistency_reviewer", inputSchema: "generated images + masters", outputSchema: "advisory scores", description: "Advisory checklist comparison against masters. Never proof of identity.", capabilities: ["vision"], estimateCents: 4 }),
    st({ key: "social_video", label: "Shot video generation", handler: "shot_videos", agent: "social_video_producer", inputSchema: "frames + motion prompts", outputSchema: "clip per shot", description: "Image-to-video per shot from its frame; locked shots are kept.", capabilities: ["video_generation"], estimateCents: 40 }),
    st({ key: "social_voice", label: "Voice lines", handler: "shot_voice", agent: "audio_producer", inputSchema: "dialogue + approved voices", outputSchema: "audio per line", description: "Speech for each dialogue line using the character's approved voice assignment.", capabilities: ["speech"], estimateCents: 3 }),
    st({ key: "social_music", label: "Music bed", handler: "music_bed", agent: "audio_producer", inputSchema: "brief", outputSchema: "music track", description: "An instrumental bed from a connected music provider.", capabilities: ["music"], estimateCents: 15 }),
    st({ key: "social_captions", label: "Captions, hooks & hashtags", handler: "agent_task", agent: "caption_copywriter", schemaKey: "captions", inputSchema: "scripts", outputSchema: "captions", description: "Captions, alternate hooks, hashtags, thumbnail text and timed on-screen captions.", capabilities: ["structured"], estimateCents: 5 }),
    st({ key: "social_assemble", label: "Timeline assembly", handler: "assemble_timeline", agent: "video_editor", inputSchema: "clips/frames + audio + captions", outputSchema: "final cut", description: "Assemble the cut with FFmpeg (or an ANIMATIC from frames when no clips exist).", capabilities: [], estimateCents: 0 }),
    st({ key: "social_qa", label: "Technical & creative QA", handler: "social_qa", agent: "qa_agent", inputSchema: "final cut", outputSchema: "QA report", description: "Platform spec checks; creative review when a vision model is connected.", capabilities: [], estimateCents: 4 }),
    // Game
    st({ key: "game_concepts", label: "Game asset concepts", handler: "agent_task", agent: "game_art_director", schemaKey: "visualItems", inputSchema: "brief + spec", outputSchema: "visualItems", description: "Asset list with prompts against the technical spec.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "game_render", label: "Render game assets", handler: "item_images", agent: "character_asset_designer", inputSchema: "visualItems", outputSchema: "image per item", description: "Generate each asset (transparent background where supported).", capabilities: ["image_generation"], estimateCents: 6 }),
    st({ key: "game_validate", label: "Technical validation", handler: "game_validate", agent: "technical_asset_validator", inputSchema: "images + spec", outputSchema: "validated game assets", description: "Resize/convert to spec, then check dimensions, alpha, format, naming, size, frames.", capabilities: [], estimateCents: 0 }),
    // Product
    st({ key: "product_research", label: "Range research", handler: "agent_task", agent: "merchandising_strategist", schemaKey: "research", inputSchema: "brief", outputSchema: "research", description: "Category, positioning and range strategy.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "product_concepts", label: "Product concepts", handler: "agent_task", agent: "consumer_product_designer", schemaKey: "products", inputSchema: "research", outputSchema: "products", description: "Product concepts for approved characters.", capabilities: ["structured"], estimateCents: 10 }),
    st({ key: "product_renders", label: "Concept renders", handler: "item_images", agent: "consumer_product_designer", inputSchema: "products", outputSchema: "image per product", description: "Visual directions using approved character references.", capabilities: ["image_edit"], estimateCents: 6 }),
    st({ key: "product_packaging", label: "Packaging concepts", handler: "agent_task", agent: "packaging_designer", schemaKey: "packaging", inputSchema: "products", outputSchema: "packaging", description: "Packaging directions per product.", capabilities: ["structured"], estimateCents: 6 }),
    st({ key: "product_costs", label: "Unit economics (estimates)", handler: "product_costs", agent: "product_commercial_analyst", schemaKey: "costModel", inputSchema: "products", outputSchema: "cost model", description: "Estimated cost, MOQ and margin scenarios – labelled estimates until supplier quotes.", capabilities: ["structured"], estimateCents: 6 }),
    st({ key: "product_feasibility", label: "Manufacturing feasibility", handler: "agent_task", agent: "manufacturing_feasibility_researcher", schemaKey: "feasibility", inputSchema: "products", outputSchema: "feasibility", description: "Constraints, certifications and risks.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "pitch_pack", label: "Pitch pack", handler: "agent_task", agent: "pitch_deck_producer", schemaKey: "deck", inputSchema: "all prior outputs", outputSchema: "deck", description: "Presentation-ready slide content.", capabilities: ["structured"], estimateCents: 10 }),
    // Character
    st({ key: "character_concept", label: "Character concept", handler: "agent_task", agent: "character_writer", schemaKey: "characterConcept", inputSchema: "brief + inspiration", outputSchema: "characterConcept", description: "A proposed new character that fits the world.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "character_canon_check", label: "Canon & originality check", handler: "canon_check", agent: "lore_continuity_editor", schemaKey: "continuity", inputSchema: "concept", outputSchema: "continuity + originality flags", description: "Continuity against official canon plus a protected-IP resemblance screen.", capabilities: ["structured"], estimateCents: 6 }),
    st({ key: "character_explorations", label: "Design explorations", handler: "character_images", agent: "character_asset_designer", inputSchema: "concept", outputSchema: "exploration images", description: "Distinct design directions (inspiration references only – no existing character identities).", capabilities: ["image_generation"], estimateCents: 6 }),
    st({ key: "character_turnaround", label: "Turnaround", handler: "character_images", agent: "character_asset_designer", inputSchema: "selected exploration", outputSchema: "turnaround image", description: "Front/side/back/three-quarter from the selected design.", capabilities: ["image_edit"], estimateCents: 6 }),
    st({ key: "character_expressions", label: "Expression sheet", handler: "character_images", agent: "character_performance_director", inputSchema: "selected exploration", outputSchema: "expression sheet", description: "Expression range from the selected design.", capabilities: ["image_edit"], estimateCents: 6 }),
    st({ key: "character_promote", label: "Add to character library (as proposal)", handler: "character_promote", agent: "studio_director", inputSchema: "approved concept + images", outputSchema: "draft character", description: "Creates a DRAFT character with an AI-proposal profile awaiting canon approval.", capabilities: [], estimateCents: 0 }),
    // Story / lore
    st({ key: "story_ideas", label: "Story ideas", handler: "agent_task", agent: "narrative_designer", schemaKey: "storyIdeas", inputSchema: "brief", outputSchema: "storyIdeas", description: "Story ideas for the cast.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "story_develop", label: "Develop story", handler: "agent_task", agent: "character_writer", schemaKey: "document", inputSchema: "selected ideas", outputSchema: "document", description: "Develop the selected ideas into stories or treatments.", capabilities: ["structured"], estimateCents: 12 }),
    st({ key: "lore_proposals", label: "Lore proposals (DRAFT CANON)", handler: "lore_proposals", agent: "worldbuilding_director", schemaKey: "loreProposals", inputSchema: "stories", outputSchema: "draft canon records", description: "New lore saved as DRAFT CANON awaiting approval.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "lore_continuity", label: "Continuity check", handler: "agent_task", agent: "lore_continuity_editor", schemaKey: "continuity", inputSchema: "proposals + canon", outputSchema: "continuity", description: "Contradictions with official canon and resolution options.", capabilities: ["structured"], estimateCents: 6 }),
    // Music
    st({ key: "song_concept", label: "Song concept", handler: "agent_task", agent: "song_concept_developer", schemaKey: "song", inputSchema: "brief", outputSchema: "song", description: "Original song concept and music brief.", capabilities: ["structured"], estimateCents: 6 }),
    st({ key: "song_lyrics", label: "Lyrics", handler: "agent_task", agent: "lyricist", schemaKey: "lyrics", inputSchema: "song", outputSchema: "lyrics", description: "Original lyrics.", capabilities: ["structured"], estimateCents: 6 }),
    st({ key: "music_video_treatment", label: "Music video treatment", handler: "agent_task", agent: "music_video_director", schemaKey: "document", inputSchema: "song + lyrics", outputSchema: "document", description: "Treatment mapped to the song structure.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "music_audio", label: "Instrumental demo", handler: "music_bed", agent: "audio_producer", inputSchema: "song", outputSchema: "audio", description: "Instrumental demo from a connected music provider.", capabilities: ["music"], estimateCents: 25 }),
    // Commercial
    st({ key: "audience_research", label: "Audience research", handler: "agent_task", agent: "audience_researcher", schemaKey: "research", inputSchema: "brief + analytics", outputSchema: "research", description: "Audience positioning from real data and cited sources.", capabilities: ["structured"], estimateCents: 10 }),
    st({ key: "partnership_strategy", label: "Partnership / licensing strategy", handler: "agent_task", agent: "brand_partnerships_strategist", schemaKey: "document", inputSchema: "brief + research", outputSchema: "document", description: "Rationale, creative concept, character fit, activations, distribution, commercial assumptions.", capabilities: ["structured"], estimateCents: 12 }),
    st({ key: "licensing_strategy", label: "Licensing category exploration", handler: "agent_task", agent: "licensing_strategist", schemaKey: "document", inputSchema: "brief + research", outputSchema: "document", description: "Categories, partner fit and terms to explore.", capabilities: ["structured"], estimateCents: 12 }),
    st({ key: "visual_mockups", label: "Visual mockups", handler: "item_images", agent: "consumer_product_designer", inputSchema: "visualItems", outputSchema: "image per item", description: "Mockup visuals using approved references.", capabilities: ["image_edit"], estimateCents: 6 }),
    st({ key: "mockup_concepts", label: "Mockup concepts", handler: "agent_task", agent: "brand_partnerships_strategist", schemaKey: "visualItems", inputSchema: "strategy", outputSchema: "visualItems", description: "Mockup list with prompts.", capabilities: ["structured"], estimateCents: 6 }),
    st({ key: "campaign_strategy", label: "Campaign strategy", handler: "agent_task", agent: "marketing_campaign_planner", schemaKey: "campaign", inputSchema: "brief", outputSchema: "campaign", description: "Objective, big idea, concepts, schedule and KPIs.", capabilities: ["structured"], estimateCents: 10 }),
    st({ key: "campaign_visuals", label: "Campaign key visuals", handler: "item_images", agent: "social_video_producer", inputSchema: "campaign concepts", outputSchema: "image per concept", description: "Key visuals per concept using approved references.", capabilities: ["image_edit"], estimateCents: 6 }),
    st({ key: "campaign_schedule", label: "Schedule (proposed)", handler: "campaign_schedule", agent: "production_manager", inputSchema: "campaign", outputSchema: "calendar items", description: "Adds proposed dates to the Production Calendar. Nothing is published.", capabilities: [], estimateCents: 0 }),
    // Animation
    st({ key: "animation_direction", label: "Animation direction", handler: "agent_task", agent: "animation_director", schemaKey: "visualItems", inputSchema: "brief", outputSchema: "visualItems", description: "Poses, expressions or loop beats within the approved animation rules.", capabilities: ["structured"], estimateCents: 8 }),
    st({ key: "animation_frames", label: "Pose / expression frames", handler: "item_images", agent: "character_performance_director", inputSchema: "visualItems", outputSchema: "image per item", description: "Frames generated from approved references.", capabilities: ["image_edit"], estimateCents: 6 }),
    st({ key: "animation_clips", label: "Concept clips", handler: "item_videos", agent: "animation_director", inputSchema: "frames", outputSchema: "clip per item", description: "Short concept clips (generated video – not rigged animation).", capabilities: ["video_generation"], estimateCents: 40 }),
  ].map((s) => [s.key, s]),
);

const s = (key: string, type: string, dependsOn: string[], extra: Partial<WorkflowStepDef> = {}): WorkflowStepDef => {
  const t = STEP_TYPES[type];
  return { key, name: t.label, agent: t.agent, handler: t.handler, dependsOn, config: { type, ...(extra.config ?? {}) }, requiresApproval: false, maxAttempts: 3, budgetEstimateCents: t.estimateCents, ...extra, ...(extra.config ? { config: { type, ...extra.config } } : {}) };
};

export interface TemplateDef {
  key: string;
  name: string;
  department: string;
  description: string;
  briefSchema: BriefSchemaKey;
  steps: WorkflowStepDef[];
  version: number;
  builtIn: boolean;
}

const brief = (path: string) => ({ step: "$brief", path, op: "truthy" as const });

export const BUILT_IN_TEMPLATES: TemplateDef[] = [
  {
    key: "social_video",
    name: "Social video",
    department: "social",
    description: "Brief → Research → Concepts → Selection → Script → Storyboard → Frames → Video → Voice → Edit → QA → Approval → Export",
    briefSchema: "social",
    version: 1,
    builtIn: true,
    steps: [
      s("canon", "canon_retrieval", []),
      s("research", "social_research", ["canon"]),
      s("concepts", "social_concepts", ["research"]),
      s("evaluate", "social_evaluate", ["concepts"]),
      s("select", "human_select", ["evaluate"], { config: { fromStep: "concepts", path: "concepts", maxFromBrief: "produceCount" } }),
      s("scripts", "social_scripts", ["select"]),
      s("storyboards", "social_storyboards", ["scripts"], { requiresApproval: true }),
      s("brand", "brand_check", ["storyboards"], { config: { checks: ["scripts", "storyboards"] } }),
      s("frames", "social_frames", ["brand"]),
      s("consistency", "consistency_review", ["frames"], { config: { fromStep: "frames" } }),
      s("frames_review", "human_review", ["consistency"], { config: { reviewsStep: "frames", what: "Approve reference frames (approved frames drive image-to-video)" } }),
      s("video", "social_video", ["frames_review"], { condition: brief("includeVideo") }),
      s("voice", "social_voice", ["frames_review"], { condition: brief("includeVoice") }),
      s("music", "social_music", ["frames_review"], { condition: brief("includeMusic") }),
      s("captions", "social_captions", ["scripts"]),
      s("assemble", "social_assemble", ["video", "voice", "music", "captions"]),
      s("qa", "social_qa", ["assemble"]),
      s("final_review", "human_review", ["qa"], { config: { reviewsStep: "assemble", what: "Approve final drafts for export" } }),
      s("export", "export_bundle", ["final_review"], { config: { roles: ["final_cut", "captions_srt", "reference_frame"] } }),
    ],
  },
  {
    key: "game_asset",
    name: "Game asset",
    department: "game",
    description: "Brief → Canon Retrieval → Concept → Render → Technical Validation → Approval → Export",
    briefSchema: "game",
    version: 1,
    builtIn: true,
    steps: [
      s("canon", "canon_retrieval", []),
      s("concepts", "game_concepts", ["canon"]),
      s("brand", "brand_check", ["concepts"], { config: { checks: ["concepts"] } }),
      s("render", "game_render", ["brand"], { config: { fromStep: "concepts", role: "game_asset_source", transparentFromBrief: "transparency" } }),
      s("validate", "game_validate", ["render"]),
      s("review", "human_review", ["validate"], { config: { reviewsStep: "render", what: "Approve validated game assets" } }),
      s("export", "export_bundle", ["review"], { config: { roles: ["game_asset"], gameAssets: true } }),
    ],
  },
  {
    key: "product_range",
    name: "Product concept range",
    department: "product",
    description: "Brief → Research → Concepts → Mockups → Cost Model → Feasibility → Approval → Pitch Pack",
    briefSchema: "product",
    version: 1,
    builtIn: true,
    steps: [
      s("canon", "canon_retrieval", []),
      s("research", "product_research", ["canon"]),
      s("concepts", "product_concepts", ["research"]),
      s("brand", "brand_check", ["concepts"], { config: { checks: ["concepts"] } }),
      s("renders", "product_renders", ["brand"], { config: { fromStep: "concepts", role: "product_render" } }),
      s("packaging", "product_packaging", ["concepts"]),
      s("costs", "product_costs", ["concepts"]),
      s("feasibility", "product_feasibility", ["concepts"]),
      s("review", "human_review", ["renders", "packaging", "costs", "feasibility"], { config: { reviewsStep: "renders", what: "Approve product directions" } }),
      s("pitch", "pitch_pack", ["review"]),
      s("export", "export_bundle", ["pitch"], { config: { roles: ["product_render", "document"] } }),
    ],
  },
  {
    key: "new_character",
    name: "New character",
    department: "story",
    description: "Brief → Character Concept → Canon Check → Design Explorations → Selection → Turnaround → Expression Sheet → Review → Approval → Character Library (as proposal)",
    briefSchema: "character",
    version: 1,
    builtIn: true,
    steps: [
      s("canon", "canon_retrieval", [], { config: { includeStyleInspiration: true } }),
      s("concept", "character_concept", ["canon"]),
      s("canon_check", "character_canon_check", ["concept"]),
      s("concept_review", "human_review", ["canon_check"], { config: { reviewsStep: "concept", what: "Approve the character concept before design work" } }),
      s("explorations", "character_explorations", ["concept_review"], { config: { mode: "explorations" } }),
      s("pick", "human_select", ["explorations"], { config: { fromStep: "explorations", path: "items", max: 1 } }),
      s("turnaround", "character_turnaround", ["pick"], { config: { mode: "turnaround" } }),
      s("expressions", "character_expressions", ["pick"], { config: { mode: "expressions" } }),
      s("review", "human_review", ["turnaround", "expressions"], { config: { reviewsStep: "turnaround", what: "Approve the design package" } }),
      s("promote", "character_promote", ["review"]),
    ],
  },
  {
    key: "campaign",
    name: "Marketing campaign",
    department: "marketing",
    description: "Brief → Strategy → Concepts → Assets → Review → Schedule → Approval",
    briefSchema: "text",
    version: 1,
    builtIn: true,
    steps: [
      s("canon", "canon_retrieval", []),
      s("strategy", "campaign_strategy", ["canon"]),
      s("brand", "brand_check", ["strategy"], { config: { checks: ["strategy"] } }),
      s("visuals", "campaign_visuals", ["brand"], { config: { fromStep: "strategy", path: "concepts", promptField: "keyVisualPrompt", role: "key_visual" } }),
      s("review", "human_review", ["visuals"], { config: { reviewsStep: "visuals", what: "Approve campaign concepts and visuals" } }),
      s("schedule", "campaign_schedule", ["review"]),
      s("export", "export_bundle", ["schedule"], { config: { roles: ["key_visual", "document"] } }),
    ],
  },
  {
    key: "story_development",
    name: "Story & lore development",
    department: "story",
    description: "Brief → Ideas → Selection → Develop → Lore proposals (DRAFT CANON) → Continuity → Review",
    briefSchema: "text",
    version: 1,
    builtIn: true,
    steps: [
      s("canon", "canon_retrieval", []),
      s("ideas", "story_ideas", ["canon"]),
      s("select", "human_select", ["ideas"], { config: { fromStep: "ideas", path: "ideas" } }),
      s("develop", "story_develop", ["select"], { config: { deliverable: true } }),
      s("lore", "lore_proposals", ["develop"]),
      s("continuity", "lore_continuity", ["lore"]),
      s("review", "human_review", ["continuity"], { config: { reviewsStep: "develop", what: "Approve stories (lore proposals are approved separately in Story & World)" } }),
      s("export", "export_bundle", ["review"], { config: { roles: ["document"] } }),
    ],
  },
  {
    key: "song_to_video",
    name: "Song → music video plan",
    department: "music",
    description: "Brief → Song concept → Lyrics → Brand check → Treatment → Instrumental demo → Review → Export",
    briefSchema: "text",
    version: 1,
    builtIn: true,
    steps: [
      s("canon", "canon_retrieval", []),
      s("song", "song_concept", ["canon"]),
      s("lyrics", "song_lyrics", ["song"]),
      s("brand", "brand_check", ["lyrics"], { config: { checks: ["song", "lyrics"] } }),
      s("treatment", "music_video_treatment", ["brand"], { config: { deliverable: true } }),
      s("audio", "music_audio", ["song"], { config: { fromStep: "song" } }),
      s("review", "human_review", ["treatment", "audio"], { config: { reviewsStep: "treatment", what: "Approve song package" } }),
      s("export", "export_bundle", ["review"], { config: { roles: ["document", "music"] } }),
    ],
  },
  {
    key: "partnership_pitch",
    name: "Partnership / licensing pitch",
    department: "licensing",
    description: "Brief → Audience research → Strategy → Mockups → Deck → Brand check → Review → Export. Never contacts partners.",
    briefSchema: "text",
    version: 1,
    builtIn: true,
    steps: [
      s("canon", "canon_retrieval", []),
      s("audience", "audience_research", ["canon"]),
      s("strategy", "partnership_strategy", ["audience"], { config: { deliverable: true } }),
      s("mockup_list", "mockup_concepts", ["strategy"]),
      s("mockups", "visual_mockups", ["mockup_list"], { config: { fromStep: "mockup_list", role: "mockup" } }),
      s("deck", "pitch_pack", ["strategy", "mockups"], { config: { deliverable: true } }),
      s("brand", "brand_check", ["deck"], { config: { checks: ["strategy", "deck"] } }),
      s("review", "human_review", ["brand"], { config: { reviewsStep: "deck", what: "Approve pitch materials (outreach is a separate explicit approval)" } }),
      s("export", "export_bundle", ["review"], { config: { roles: ["document", "mockup"] } }),
    ],
  },
  {
    key: "animation_concepts",
    name: "Animation concepts",
    department: "animation",
    description: "Brief → Direction → Frames → Consistency → (Clips) → Review → Export. Generated video is never labelled as rigged animation.",
    briefSchema: "animation",
    version: 1,
    builtIn: true,
    steps: [
      s("canon", "canon_retrieval", []),
      s("direction", "animation_direction", ["canon"]),
      s("frames", "animation_frames", ["direction"], { config: { fromStep: "direction", role: "animation_frame" } }),
      s("consistency", "consistency_review", ["frames"], { config: { fromStep: "frames" } }),
      s("frames_review", "human_review", ["consistency"], { config: { reviewsStep: "frames", what: "Approve frames" } }),
      s("clips", "animation_clips", ["frames_review"], { condition: brief("makeClips"), config: { fromStep: "frames" } }),
      s("review", "human_review", ["clips"], { config: { reviewsStep: "clips", what: "Approve concept clips" } }),
      s("export", "export_bundle", ["review"], { config: { roles: ["animation_frame", "concept_clip"] } }),
    ],
  },
];

export const DEPARTMENTS: { key: string; label: string; href: string; templates: string[] }[] = [
  { key: "social", label: "Social Studio", href: "/social", templates: ["social_video"] },
  { key: "animation", label: "Animation Studio", href: "/animation", templates: ["animation_concepts"] },
  { key: "game", label: "Game Studio", href: "/game", templates: ["game_asset"] },
  { key: "product", label: "Product Lab", href: "/product", templates: ["product_range"] },
  { key: "story", label: "Story & World Studio", href: "/story", templates: ["story_development", "new_character"] },
  { key: "music", label: "Music & Audio", href: "/music", templates: ["song_to_video"] },
  { key: "marketing", label: "Marketing Studio", href: "/marketing", templates: ["campaign"] },
  { key: "licensing", label: "Licensing Studio", href: "/licensing", templates: ["partnership_pitch"] },
];

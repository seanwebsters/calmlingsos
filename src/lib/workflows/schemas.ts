/**
 * Typed handoff schemas. Agents exchange these artifacts – never free-form
 * chat. Every agent output is validated against its schema before the next
 * step can use it.
 */
import { z } from "zod";

const id = z.string().describe("Short stable id, e.g. c1, s3");
const characterRef = z.string().describe("Character code (e.g. CHR-BLUE) or name exactly as given in canon");

export const S = {
  plan: z.object({
    summary: z.string(),
    productions: z
      .array(
        z.object({
          templateKey: z.string().describe("One of the available workflow template keys"),
          title: z.string(),
          characters: z.array(characterRef),
          brief: z.record(z.string(), z.unknown()).describe("Brief fields for that template"),
          rationale: z.string(),
        }),
      )
      .min(1),
    questions: z.array(z.string()).describe("Open questions for the creative director"),
    canonGaps: z.array(z.string()).describe("Canon the work needs that isn't approved yet"),
  }),

  research: z.object({
    summary: z.string(),
    insights: z.array(z.object({ insight: z.string(), evidence: z.string(), source: z.string().nullable() })),
    opportunities: z.array(z.string()),
    dataGaps: z.array(z.string()),
  }),

  concepts: z.object({
    concepts: z
      .array(
        z.object({
          id,
          title: z.string(),
          hook: z.string().describe("The first two seconds"),
          logline: z.string(),
          emotionalMessage: z.string(),
          characters: z.array(characterRef),
          format: z.string(),
          whyItWorks: z.string(),
          canonQuestions: z.array(z.string()).describe("Anything this idea needs that canon doesn't define"),
        }),
      )
      .min(1),
  }),

  evaluation: z.object({
    scores: z.array(
      z.object({
        conceptId: z.string(),
        originality: z.number().min(0).max(10),
        emotionalImpact: z.number().min(0).max(10),
        shareability: z.number().min(0).max(10),
        brandFit: z.number().min(0).max(10),
        rationale: z.string(),
        risks: z.array(z.string()),
      }),
    ),
    recommendation: z.string(),
  }),

  scripts: z.object({
    scripts: z.array(
      z.object({
        conceptId: z.string(),
        title: z.string(),
        durationSeconds: z.number(),
        hook: z.string(),
        emotionalMessage: z.string(),
        beats: z.array(z.object({ atSeconds: z.number(), action: z.string(), dialogue: z.string(), speaker: z.string().nullable() })),
        endCard: z.string(),
      }),
    ),
  }),

  storyboards: z.object({
    storyboards: z.array(
      z.object({
        conceptId: z.string(),
        shots: z.array(
          z.object({
            index: z.number().int(),
            description: z.string().describe("What we see"),
            camera: z.string(),
            action: z.string(),
            dialogue: z.string(),
            speaker: characterRef.nullable(),
            sound: z.string(),
            durationSeconds: z.number(),
            characters: z.array(characterRef),
            continuity: z.string().describe("Identity/prop/lighting continuity notes"),
            framePrompt: z.string().describe("Image prompt for the reference frame; defer to reference images for character appearance"),
            motionPrompt: z.string().describe("Motion prompt for image-to-video"),
          }),
        ),
      }),
    ),
  }),

  captions: z.object({
    packs: z.array(
      z.object({
        conceptId: z.string(),
        caption: z.string(),
        hashtags: z.array(z.string()),
        alternateHooks: z.array(z.string()),
        thumbnailText: z.string(),
        onScreenCaptions: z.array(z.object({ startSeconds: z.number(), endSeconds: z.number(), text: z.string() })),
      }),
    ),
  }),

  brandCheck: z.object({
    passed: z.boolean(),
    summary: z.string(),
    issues: z.array(z.object({ severity: z.enum(["blocker", "major", "minor"]), rule: z.string().describe("The canon rule or guideline"), issue: z.string(), fix: z.string(), itemId: z.string().nullable() })),
  }),

  consistency: z.object({
    overallScore: z.number().min(0).max(1),
    identityDrift: z.boolean(),
    items: z.array(z.object({ item: z.string(), score: z.number().min(0).max(1), note: z.string() })),
    summary: z.string(),
  }),

  referenceAnalysis: z.object({
    description: z.string(),
    characterCandidates: z.array(z.object({ name: z.string(), confidence: z.number().min(0).max(1), reason: z.string() })),
    composition: z.string(),
    styleObservations: z.array(z.string()),
    consistencyRules: z.array(z.string()).describe("Candidate rules a human may adopt; observed, not invented"),
  }),

  videoAnalysis: z.object({
    description: z.string(),
    sceneDescriptions: z.array(z.object({ atSeconds: z.number(), description: z.string() })),
    movement: z.string(),
    editingRhythm: z.string(),
    characterCandidates: z.array(z.object({ name: z.string(), confidence: z.number().min(0).max(1), reason: z.string() })),
    styleObservations: z.array(z.string()),
  }),

  documentAnalysis: z.object({
    description: z.string(),
    keyFacts: z.array(z.string()),
    candidateCanon: z.array(z.object({ domain: z.enum(["world", "lore", "brand", "production"]), title: z.string(), body: z.string() })).describe("Statements a human might adopt as canon"),
  }),

  visualItems: z.object({
    items: z
      .array(
        z.object({
          id,
          name: z.string(),
          category: z.string(),
          description: z.string(),
          characters: z.array(characterRef),
          prompt: z.string().describe("Image prompt; defer to reference images for character appearance"),
          notes: z.string(),
        }),
      )
      .min(1),
  }),

  products: z.object({
    rangeName: z.string().nullable(),
    products: z
      .array(
        z.object({
          id,
          name: z.string(),
          category: z.string(),
          characters: z.array(characterRef),
          description: z.string(),
          materials: z.string(),
          dimensions: z.string(),
          targetAudience: z.string(),
          colourway: z.string(),
          renderPrompt: z.string(),
        }),
      )
      .min(1),
  }),

  packaging: z.object({ concepts: z.array(z.object({ productId: z.string(), concept: z.string(), materials: z.string(), sustainability: z.string(), copy: z.string(), renderPrompt: z.string() })) }),

  costModel: z.object({
    products: z.array(
      z.object({
        productId: z.string(),
        estUnitCostUsd: z.number(),
        targetRetailUsd: z.number(),
        wholesaleUsd: z.number(),
        moqAssumption: z.number().int(),
        assumptions: z.array(z.string()),
      }),
    ),
    caveat: z.string(),
  }),

  feasibility: z.object({ products: z.array(z.object({ productId: z.string(), risks: z.array(z.string()), certifications: z.array(z.string()), recommendations: z.array(z.string()) })) }),

  document: z.object({
    title: z.string(),
    summary: z.string(),
    sections: z.array(z.object({ heading: z.string(), body: z.string() })),
    assumptions: z.array(z.string()),
    openQuestions: z.array(z.string()),
  }),

  deck: z.object({
    title: z.string(),
    slides: z.array(z.object({ title: z.string(), bullets: z.array(z.string()), visualNote: z.string(), speakerNotes: z.string() })).min(1),
    assumptions: z.array(z.string()),
  }),

  characterConcept: z.object({
    name: z.string(),
    oneLiner: z.string(),
    personality: z.string(),
    emotionalPurpose: z.string(),
    appearance: z.string(),
    colours: z.array(z.object({ name: z.string(), hex: z.string() })),
    silhouette: z.string(),
    relationships: z.array(z.object({ character: characterRef, nature: z.string() })),
    backstory: z.string(),
    designPrompts: z.array(z.string()).describe("3–4 distinct design-exploration prompts"),
  }),

  continuity: z.object({
    contradictions: z.array(z.object({ proposal: z.string(), conflictsWith: z.string(), recordId: z.string().nullable(), resolutionOptions: z.array(z.string()) })),
    consistentPoints: z.array(z.string()),
    verdict: z.string(),
  }),

  loreProposals: z.object({
    proposals: z.array(z.object({ domain: z.enum(["world", "lore"]), kind: z.string(), title: z.string(), body: z.string(), characters: z.array(characterRef), timelineOrder: z.number().int().nullable() })).min(1),
  }),

  storyIdeas: z.object({ ideas: z.array(z.object({ id, title: z.string(), logline: z.string(), characters: z.array(characterRef), theme: z.string(), format: z.string() })).min(1) }),

  song: z.object({
    title: z.string(),
    concept: z.string(),
    emotionalPurpose: z.string(),
    characters: z.array(characterRef),
    tempoBpm: z.number(),
    key: z.string(),
    instrumentation: z.string(),
    musicPrompt: z.string().describe("Prompt for an instrumental music generator"),
    structure: z.array(z.object({ section: z.string(), seconds: z.number() })),
  }),

  lyrics: z.object({ title: z.string(), sections: z.array(z.object({ section: z.string(), lines: z.array(z.string()) })), notes: z.string() }),

  campaign: z.object({
    name: z.string(),
    objective: z.string(),
    audience: z.string(),
    bigIdea: z.string(),
    concepts: z.array(z.object({ id, title: z.string(), description: z.string(), channels: z.array(z.string()), keyVisualPrompt: z.string() })),
    schedule: z.array(z.object({ dayOffset: z.number().int(), title: z.string(), channel: z.string() })),
    kpis: z.array(z.string()),
  }),

  custom: z.object({
    title: z.string(),
    summary: z.string(),
    sections: z.array(z.object({ heading: z.string(), body: z.string() })),
    items: z.array(z.object({ title: z.string(), detail: z.string() })),
  }),
} as const;

export type SchemaKey = keyof typeof S;
export type Out<K extends SchemaKey> = z.infer<(typeof S)[K]>;

/* ------------------------------------------------------------------ */
/* Briefs                                                              */
/* ------------------------------------------------------------------ */

export const PLATFORMS = {
  tiktok: { label: "TikTok", aspect: "9:16", maxSeconds: 180 },
  instagram_reels: { label: "Instagram Reels", aspect: "9:16", maxSeconds: 90 },
  youtube_shorts: { label: "YouTube Shorts", aspect: "9:16", maxSeconds: 60 },
  youtube: { label: "YouTube", aspect: "16:9", maxSeconds: 1800 },
  square: { label: "Square feed", aspect: "1:1", maxSeconds: 120 },
} as const;
export type PlatformKey = keyof typeof PLATFORMS;

export const socialBrief = z.object({
  theme: z.string().min(1).max(500),
  emotionalMessage: z.string().max(500).default(""),
  platform: z.enum(["tiktok", "instagram_reels", "youtube_shorts", "youtube", "square"]).default("tiktok"),
  format: z.string().max(100).default("character comedy sketch"),
  durationSeconds: z.number().int().min(5).max(600).default(20),
  visualStyle: z.string().max(300).default("as per approved references"),
  conceptCount: z.number().int().min(1).max(30).default(10),
  produceCount: z.number().int().min(1).max(10).default(2),
  includeVideo: z.boolean().default(true),
  includeVoice: z.boolean().default(false),
  includeMusic: z.boolean().default(false),
  burnCaptions: z.boolean().default(true),
  creativeReferenceIds: z.array(z.string()).default([]),
  notes: z.string().max(2000).default(""),
});

export const gameBrief = z.object({
  request: z.string().min(1).max(1000),
  count: z.number().int().min(1).max(24).default(4),
  targetEngine: z.string().max(40).default("Unity"),
  category: z.string().max(60).default("collectible"),
  width: z.number().int().min(16).max(4096).default(512),
  height: z.number().int().min(16).max(4096).default(512),
  transparency: z.boolean().default(true),
  fileFormat: z.enum(["png", "webp", "jpeg"]).default("png"),
  frames: z.number().int().min(1).max(64).default(1),
  fps: z.number().int().min(1).max(60).default(12),
  namingPattern: z.string().max(120).default("cal_{category}_{name}_{width}x{height}"),
  targetPlatform: z.string().max(40).default("mobile"),
  maxFileKb: z.number().int().min(1).max(20000).default(512),
  collection: z.string().max(80).default("Unsorted"),
});

export const productBrief = z.object({
  request: z.string().min(1).max(1000),
  category: z.string().max(60).default("plush"),
  count: z.number().int().min(1).max(12).default(4),
  rangeName: z.string().max(120).default(""),
  targetAudience: z.string().max(200).default(""),
  pricePoint: z.string().max(100).default(""),
});

export const characterBrief = z.object({
  request: z.string().min(1).max(2000),
  inspirationReferenceIds: z.array(z.string()).default([]),
  explorations: z.number().int().min(1).max(6).default(3),
});

export const textBrief = z.object({
  request: z.string().min(1).max(2000),
  count: z.number().int().min(1).max(20).default(5),
  partner: z.string().max(200).default(""),
  notes: z.string().max(2000).default(""),
});

export const animationBrief = z.object({
  request: z.string().min(1).max(1000),
  kind: z.enum(["expression_sheet", "pose_board", "idle_loop", "reaction", "dance", "physical_comedy", "environment_interaction", "game_animation_concept"]).default("expression_sheet"),
  count: z.number().int().min(1).max(12).default(6),
  aspect: z.enum(["1:1", "9:16", "16:9"]).default("1:1"),
  makeClips: z.boolean().default(false),
});

export const BRIEF_SCHEMAS = { social: socialBrief, game: gameBrief, product: productBrief, character: characterBrief, text: textBrief, animation: animationBrief } as const;
export type BriefSchemaKey = keyof typeof BRIEF_SCHEMAS;

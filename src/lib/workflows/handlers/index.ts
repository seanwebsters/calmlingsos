import "server-only";
import type { StepHandler } from "../runtime";
import { agentTask } from "./agent";
import { characterImages, consistencyReview, itemImages, itemVideos, musicBed, shotFrames, shotVideos, shotVoice } from "./media";
import { assembleTimeline, socialQa } from "./assemble";
import { campaignSchedule, canonRetrieval, characterPromote, exportBundle, gameValidate, loreProposals, productCosts } from "./other";

const human: StepHandler = async () => {
  throw new Error("Human steps are completed by people, never by the worker.");
};

export const STEP_HANDLERS: Record<string, StepHandler> = {
  canon_retrieval: canonRetrieval,
  agent_task: agentTask,
  canon_check: agentTask,
  human_select: human,
  human_review: human,
  shot_frames: shotFrames,
  consistency_review: consistencyReview,
  shot_videos: shotVideos,
  shot_voice: shotVoice,
  music_bed: musicBed,
  assemble_timeline: assembleTimeline,
  social_qa: socialQa,
  item_images: itemImages,
  item_videos: itemVideos,
  character_images: characterImages,
  character_promote: characterPromote,
  game_validate: gameValidate,
  product_costs: productCosts,
  lore_proposals: loreProposals,
  campaign_schedule: campaignSchedule,
  export_bundle: exportBundle,
};

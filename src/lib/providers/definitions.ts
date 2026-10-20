import type { ProviderDefinition } from "./types";

/**
 * Provider registry. Capabilities are declared per model – no provider is
 * assumed to do everything. Live discovery (Settings → Test connection)
 * checks which of these models the connected account can actually use.
 * Prices are approximate list prices for estimates only.
 */
export const PROVIDERS: ProviderDefinition[] = [
  {
    key: "anthropic",
    name: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    docsUrl: "https://docs.claude.com",
    capabilities: ["text", "vision", "structured", "tool_use", "search"],
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", capabilities: ["text", "vision", "structured", "tool_use", "search"], quality: 3, speed: 2, costNote: "$4 / $20 per M tokens" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", capabilities: ["text", "vision", "structured", "tool_use", "search"], quality: 2, speed: 3, costNote: "$2 / $10 per M tokens" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", capabilities: ["text", "vision", "structured", "tool_use"], quality: 1, speed: 3, costNote: "$0.10 / $0.50 per M tokens" },
    ],
    defaultModels: { text: "claude-opus-5-5", vision: "claude-opus-5-5", structured: "claude-opus-5-5", tool_use: "claude-opus-5-5", search: "claude-opus-5-5" },
    privacyNote: "Commercial API terms: inputs are not used for model training by default. Confirm your organisation's retention settings before sending proprietary reference files.",
    rateLimitNote: "Per-organisation token and request limits; see your Anthropic console.",
  },
  {
    key: "openai",
    name: "OpenAI",
    envVar: "OPENAI_API_KEY",
    consoleUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs",
    capabilities: ["text", "vision", "structured", "tool_use", "image_generation", "image_edit", "speech", "transcription", "embeddings"],
    models: [
      { id: "gpt-5", label: "GPT-5", capabilities: ["text", "vision", "structured", "tool_use"], quality: 3, speed: 2, costNote: "see OpenAI pricing" },
      { id: "gpt-image-1", label: "GPT Image 1", capabilities: ["image_generation", "image_edit"], quality: 3, speed: 1, costNote: "≈ $0.04–0.17 per image", supportsReferences: true, transparentBackground: true },
      { id: "gpt-4o-mini-tts", label: "GPT-4o mini TTS", capabilities: ["speech"], quality: 2, speed: 3, costNote: "≈ $0.015 per minute" },
      { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", capabilities: ["transcription"], quality: 2, speed: 3, costNote: "≈ $0.003 per minute" },
      { id: "text-embedding-3-small", label: "text-embedding-3-small", capabilities: ["embeddings"], quality: 2, speed: 3, costNote: "$0.02 per M tokens" },
    ],
    defaultModels: { text: "gpt-5", vision: "gpt-5", structured: "gpt-5", tool_use: "gpt-5", image_generation: "gpt-image-1", image_edit: "gpt-image-1", speech: "gpt-4o-mini-tts", transcription: "gpt-4o-mini-transcribe", embeddings: "text-embedding-3-small" },
    privacyNote: "API data is not used for training by default. Review OpenAI's data usage policy and your retention controls before enabling proprietary references.",
    rateLimitNote: "Tiered rate limits by account usage level.",
  },
  {
    key: "google",
    name: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    consoleUrl: "https://aistudio.google.com/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    capabilities: ["text", "vision", "structured", "image_generation", "image_edit", "video_generation", "embeddings"],
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", capabilities: ["text", "vision", "structured"], quality: 3, speed: 2, costNote: "see Google pricing" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", capabilities: ["text", "vision", "structured"], quality: 2, speed: 3, costNote: "see Google pricing" },
      { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image (Nano Banana)", capabilities: ["image_generation", "image_edit"], quality: 3, speed: 2, costNote: "≈ $0.039 per image", supportsReferences: true },
      { id: "veo-3.0-generate-001", label: "Veo 3", capabilities: ["video_generation"], quality: 3, speed: 1, costNote: "≈ $0.40 per second", supportsReferences: true },
      { id: "gemini-embedding-001", label: "Gemini Embedding", capabilities: ["embeddings"], quality: 3, speed: 3, costNote: "≈ $0.15 per M tokens" },
    ],
    defaultModels: { text: "gemini-2.5-pro", vision: "gemini-2.5-pro", structured: "gemini-2.5-pro", image_generation: "gemini-2.5-flash-image", image_edit: "gemini-2.5-flash-image", video_generation: "veo-3.0-generate-001", embeddings: "gemini-embedding-001" },
    privacyNote: "Free-tier Gemini API usage may be used to improve Google products. Only enable proprietary references on a paid (Cloud billing) project.",
    rateLimitNote: "Per-project RPM/TPM limits, lower on the free tier.",
  },
  {
    key: "fal",
    name: "fal.ai",
    envVar: "FAL_KEY",
    consoleUrl: "https://fal.ai/dashboard/keys",
    docsUrl: "https://docs.fal.ai",
    capabilities: ["image_generation", "image_edit", "video_generation"],
    models: [
      { id: "fal-ai/nano-banana-2", label: "Nano Banana 2 (via fal)", capabilities: ["image_generation", "image_edit"], quality: 3, speed: 2, costNote: "≈ $0.04 per image", supportsReferences: true },
      { id: "fal-ai/kling-video/v2.5-turbo/standard/image-to-video", label: "Kling 2.5 Turbo image-to-video", capabilities: ["video_generation"], quality: 3, speed: 1, costNote: "≈ $0.07 per second", supportsReferences: true },
    ],
    defaultModels: { image_generation: "fal-ai/nano-banana-2", image_edit: "fal-ai/nano-banana-2", video_generation: "fal-ai/kling-video/v2.5-turbo/standard/image-to-video" },
    privacyNote: "Inputs are processed by fal and the underlying model vendor. Review fal's terms for each model before enabling proprietary references.",
    rateLimitNote: "Concurrency limits per account; long jobs run through fal's queue.",
  },
  {
    key: "elevenlabs",
    name: "ElevenLabs",
    envVar: "ELEVENLABS_API_KEY",
    consoleUrl: "https://elevenlabs.io/app/settings/api-keys",
    docsUrl: "https://elevenlabs.io/docs",
    capabilities: ["speech", "sound_effects", "music", "transcription"],
    models: [
      { id: "eleven_multilingual_v2", label: "Eleven Multilingual v2", capabilities: ["speech"], quality: 3, speed: 2, costNote: "≈ $0.18 per 1K characters" },
      { id: "eleven_flash_v2_5", label: "Eleven Flash v2.5", capabilities: ["speech"], quality: 2, speed: 3, costNote: "≈ $0.09 per 1K characters" },
      { id: "eleven_text_to_sound_v2", label: "Sound Effects v2", capabilities: ["sound_effects"], quality: 3, speed: 3, costNote: "≈ $0.004 per second" },
      { id: "music_v1", label: "Eleven Music", capabilities: ["music"], quality: 3, speed: 1, costNote: "≈ $0.50 per minute" },
      { id: "scribe_v1", label: "Scribe v1", capabilities: ["transcription"], quality: 3, speed: 2, costNote: "≈ $0.40 per hour" },
    ],
    defaultModels: { speech: "eleven_multilingual_v2", sound_effects: "eleven_text_to_sound_v2", music: "music_v1", transcription: "scribe_v1" },
    privacyNote: "Voice cloning requires documented consent from the voice owner. Review ElevenLabs' terms before uploading proprietary audio.",
    rateLimitNote: "Concurrent request limits by subscription tier.",
  },
];

export const PROVIDER_BY_KEY = Object.fromEntries(PROVIDERS.map((p) => [p.key, p])) as Record<string, ProviderDefinition>;

/** Router preference order per capability when the caller doesn't override. */
export const DEFAULT_ROUTE_ORDER: Record<string, string[]> = {
  text: ["anthropic", "openai", "google"],
  vision: ["anthropic", "openai", "google"],
  structured: ["anthropic", "openai", "google"],
  tool_use: ["anthropic", "openai"],
  search: ["anthropic"],
  image_generation: ["google", "openai", "fal"],
  image_edit: ["google", "openai", "fal"],
  video_generation: ["fal", "google"],
  speech: ["elevenlabs", "openai"],
  transcription: ["openai", "elevenlabs"],
  music: ["elevenlabs"],
  sound_effects: ["elevenlabs"],
  embeddings: ["openai", "google"],
};

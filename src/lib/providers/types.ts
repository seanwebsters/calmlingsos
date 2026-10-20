export const CAPABILITIES = [
  "text",
  "vision",
  "structured",
  "tool_use",
  "search",
  "image_generation",
  "image_edit",
  "video_generation",
  "speech",
  "transcription",
  "music",
  "sound_effects",
  "embeddings",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  text: "Text & reasoning",
  vision: "Image understanding",
  structured: "Structured output",
  tool_use: "Agent tool use",
  search: "Web search",
  image_generation: "Image generation",
  image_edit: "Image editing / reference-guided",
  video_generation: "Video generation",
  speech: "Speech synthesis",
  transcription: "Transcription",
  music: "Music generation",
  sound_effects: "Sound effects",
  embeddings: "Embeddings",
};

export type Quality = "best" | "balanced" | "fast" | "cheap";

export interface ModelInfo {
  id: string;
  label: string;
  capabilities: Capability[];
  /** 1 (good) – 3 (best) */
  quality: 1 | 2 | 3;
  /** 1 (slow) – 3 (fast) */
  speed: 1 | 2 | 3;
  /** Approximate list price, for display and estimates only. */
  costNote: string;
  /** Accepts reference images to guide identity/style. */
  supportsReferences?: boolean;
  /** Can output an alpha channel directly. */
  transparentBackground?: boolean;
}

export interface ProviderDefinition {
  key: string;
  name: string;
  envVar: string;
  consoleUrl: string;
  docsUrl: string;
  capabilities: Capability[];
  models: ModelInfo[];
  defaultModels: Partial<Record<Capability, string>>;
  privacyNote: string;
  rateLimitNote: string;
}

export interface BinaryInput {
  mimeType: string;
  data: Buffer;
  label?: string;
}

export interface TextRequest {
  system: string;
  /** Stable context (canon pack) – cacheable where the provider supports it. */
  context?: string;
  prompt: string;
  images?: BinaryInput[];
  jsonSchema?: Record<string, unknown> | null;
  schemaName?: string;
  maxTokens?: number;
  webSearch?: boolean;
  effort?: "low" | "medium" | "high";
}
export interface TextResult {
  text: string;
  model: string;
  units: Record<string, number>;
  costCents: number;
}

export interface ImageRequest {
  prompt: string;
  references?: BinaryInput[];
  aspectRatio: "1:1" | "9:16" | "16:9" | "4:5" | "3:4" | "4:3" | "2:3" | "3:2";
  transparent?: boolean;
}
export interface MediaResult {
  data: Buffer;
  mimeType: string;
  model: string;
  units: Record<string, number>;
  costCents: number;
}

export interface VideoRequest {
  prompt: string;
  startFrame?: BinaryInput;
  durationSeconds: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
}

export interface SpeechRequest {
  text: string;
  voiceId?: string | null;
  direction?: string;
}

export interface TranscriptionRequest {
  audio: BinaryInput;
}
export interface TranscriptionResult {
  text: string;
  model: string;
  units: Record<string, number>;
  costCents: number;
}

export interface AudioGenRequest {
  prompt: string;
  seconds: number;
}

export interface EmbeddingRequest {
  texts: string[];
}
export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  units: Record<string, number>;
  costCents: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One turn of a tool-using agent loop. `messages` are in the provider's native format. */
export interface AgentTurnRequest {
  system: string;
  context?: string;
  messages: unknown[];
  tools: ToolSpec[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export interface AgentTurnResult {
  /** Native messages to append to the history (the assistant turn), unchanged. */
  append: unknown[];
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  done: boolean;
  model: string;
  units: Record<string, number>;
  costCents: number;
}

export interface ToolResult {
  id: string;
  content: string;
  isError: boolean;
}

export interface ConnectionTest {
  ok: boolean;
  detail: string;
  /** Models the account can actually see (capability discovery). */
  availableModels?: string[];
}

export interface ProviderAdapter {
  key: string;
  test(apiKey: string): Promise<ConnectionTest>;
  text?(apiKey: string, model: string, req: TextRequest): Promise<TextResult>;
  image?(apiKey: string, model: string, req: ImageRequest): Promise<MediaResult>;
  video?(apiKey: string, model: string, req: VideoRequest): Promise<MediaResult>;
  speech?(apiKey: string, model: string, req: SpeechRequest): Promise<MediaResult>;
  transcribe?(apiKey: string, model: string, req: TranscriptionRequest): Promise<TranscriptionResult>;
  music?(apiKey: string, model: string, req: AudioGenRequest): Promise<MediaResult>;
  soundEffect?(apiKey: string, model: string, req: AudioGenRequest): Promise<MediaResult>;
  embed?(apiKey: string, model: string, req: EmbeddingRequest): Promise<EmbeddingResult>;
  agentTurn?(apiKey: string, model: string, req: AgentTurnRequest): Promise<AgentTurnResult>;
  /** Native messages carrying tool results back to the model. */
  toolResults?(results: ToolResult[]): unknown[];
  userMessage?(text: string): unknown;
}

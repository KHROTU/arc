import type { ProcessStep } from "./process.js";
export type Role = "system" | "user" | "assistant" | "tool" | "developer";
export type ModelTier = "free" | "light" | "default" | "heavy";
export interface ModelDescriptor {
  id: string;
  label: string;
  tier: ModelTier;
  contextWindow: number;
  maxOutputTokens?: number;
  costPer1mIn: number;
  costPer1mOut: number;
  providers: ProviderRef[];
}
export interface ProviderRef {
  id: string;
  kind: ProviderKind;
  remoteModel?: string;
  priority: number;
  weight?: number;
}
export type ProviderKind =
  | "openai"
  | "openrouter"
  | "anthropic"
  | "google"
  | "groq"
  | "mistral"
  | "deepseek"
  | "xai"
  | "cohere"
  | "fireworks"
  | "together"
  | "perplexity"
  | "deepinfra"
  | "cerebras"
  | "ollama"
  | "minimax"
  | "minimax-cn"
  | "kimi"
  | "kimi-cn"
  | "z-ai"
  | "z-ai-cn"
  | "vscode-lm"
  | "openai-compatible"
  | "siliconflow"
  | "kluster-ai"
  | "novita"
  | "hyperbolic"
  | "nebius"
  | "sambanova"
  | "baseten"
  | "lambda-ai"
  | "lepton"
  | "upstage"
  | "jina"
  | "voyage"
  | "huggingface"
  | "github-models"
  | "nvidia"
  | "scaleway"
  | "telnyx"
  | "azure-openai"
  | "azure-foundry"
  | "aws-bedrock"
  | "aws-bedrock-mantle"
  | "gcp-vertex"
  | "ibm-watsonx"
  | "databricks"
  | "snowflake-cortex"
  | "cloudflare-workers-ai"
  | "volcengine"
  | "byteplus"
  | "tencent-cloud"
  | "tencent-tokenhub"
  | "baidu-qianfan"
  | "baidu-qianfan-ai"
  | "aiml-api"
  | "stepfun"
  | "baichuan"
  | "zeroone"
  | "sensenova"
  | "ai21"
  | "writer"
  | "llama-api"
  | "venice"
  | "clarifai"
  | "sarvam"
  | "ovhcloud"
  | "llmhub"
  | "friendli"
  | "predibase"
  | "morph"
  | "fal"
  | "bfl"
  | "modelslab"
  | "apiyi"
  | "laozhang"
  | "featherless"
  | "decart"
  | "edenai"
  | "orq"
  | "martian"
  | "requesty"
  | "helicone"
  | "portkey"
  | "vercel"
  | "lm-studio"
  | "localai"
  | "jan"
  | "gpt4all"
  | "koboldcpp"
  | "llamafile"
  | "llama-cpp"
  | "vllm"
  | "sglang"
  | "tgi"
  | "aphrodite"
  | "xinference"
  | "tabby"
  | "one-api"
  | "new-api"
  | "any-llm"
  | "wavespeed"
  | "braintrust"
  | "aibadgr"
  | "replicate"
  | "chutes"
  | "anyscale"
  | "comet-api"
  | "apexit"
  | "deepgram"
  | "elevenlabs"
  | "llamagate"
  | "nanogpt"
  | "nlp-cloud"
  | "baseten-predict"
  | "v0"
  | "spheron"
  | "unify-ai"
  | "zenmux"
  | "bifrost"
  | "nscale"
  | "publicai"
  | "galadriel"
  | "gmi-cloud"
  | "shareai"
  | "dashscope"
  | "oracle-oci"
  | "aleph-alpha"
  | "bytez"
  | "compactifai"
  | "empiriolabs"
  | "inception"
  | "lemonade"
  | "manus"
  | "poe"
  | "recraft"
  | "runwayml"
  | "stability-ai"
  | "topaz"
  | "wandb-inference"
  | "xiaomi-mimo"
  | "petals"
  | "triton-inference"
  | "tensormesh"
  | "synthetic"
  | "datarobot"
  | "gradientai"
  | "heroku"
  | "near-ai"
  | "litellm-proxy"
  | "portkey-gateway"
  | "braintrust-gateway"
  | "vercel-ai-gateway"
  | "tongyi";
export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
}
export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  thinking?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  ts: number;
  meta?: { modelId: string; providerId: string; tier: ModelTier };
  images?: { type: string; image_url: { url: string } }[];
}
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export interface TurnUsage {
  prompt: number;
  completion: number;
  thinking: number;
  cost: number;
}
export type ExecutionEvent =
  | { type: "tool_call"; turnId: string; toolCallId: string; toolName: string; args: Record<string, unknown>; ts: number; durationMs: number; ok: boolean; output?: string }
  | { type: "model_call"; turnId: string; modelId: string; providerId: string; tier: ModelTier; ts: number; durationMs: number; usage?: TurnUsage }
  | { type: "handoff"; turnId: string; fromModel: string; toModel: string; direction: "escalate" | "de-escalate"; reason: string; ts: number }
  | { type: "compaction"; turnId: string; before: number; after: number; reason: string; ts: number }
  | { type: "approval"; turnId: string; toolName: string; category: string; allowed: boolean; ts: number }
  | { type: "subagent_spawn"; turnId: string; name: string; tier: ModelTier; ts: number }
  | { type: "user_message"; turnId: string; content: string; ts: number }
  | { type: "checkpoint_snapshot"; turnId: string; fileCount: number; ts: number }
  | { type: "mode_switch"; turnId: string; from: string; to: string; ts: number }
  | { type: "error"; turnId: string; message: string; ts: number }
  | { type: "retry"; turnId: string; toolName: string; attempt: number; reason: string; ts: number };
export interface TurnRecord {
  id: string;
  messages: ChatMessage[];
  usage: TurnUsage;
  startedAt: number;
  endedAt?: number;
  checkpointed: boolean;
  retracted?: boolean;
}
export type HostMsg =
  | { type: "session/init"; sessionId: string; chatId?: string; models: ModelDescriptor[]; currentModelId: string; modes?: { slug: string; description: string }[]; currentMode?: string }
  | { type: "session/message"; message: ChatMessage; sessionId?: string }
  | { type: "session/assistantText"; id: string; text: string; sessionId?: string }
  | { type: "session/steps"; steps: ProcessStep[]; sessionId?: string }
  | { type: "session/usage"; usage: TurnUsage; perModel: Record<string, TurnUsage> }
  | { type: "session/turnStart"; turnId: string; sessionId?: string }
  | { type: "session/turnEnd"; turnId: string; ok: boolean; error?: string; sessionId?: string }
  | { type: "session/done" }
  | { type: "session/clarification"; id: string; question: string; options: string[]; fromModel?: string }
  | { type: "session/handoff"; fromModel: string; toModel: string; reason: string }
  | { type: "todo/update"; items: { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" }[] }
  | { type: "session/compaction"; before: number; after: number; reason: string }
  | { type: "session/attachment"; uri: string; preview: string }
  | { type: "chat/list"; chats: { id: string; title: string; updatedAt: number; cost: number; isActive: boolean }[] }
  | { type: "chat/current"; chatId: string }
  | { type: "context/stats"; usedPct: number; tokens: number; window: number; cost: number }
  | { type: "model/list"; models: ModelDescriptor[]; currentModelId: string }
  | { type: "provider/list"; providers: ProviderConfig[] }
  | { type: "config/get"; value: unknown; inReplyTo: string }
  | { type: "mcp/list"; servers: { name: string; enabled: boolean; transport: "stdio" | "http"; toolCount: number }[] }
  | { type: "chat/searchResults"; results: { id: string; title: string; matches: string[] }[] }
  | { type: "ui/showSettings" }
  | { type: "ui/showSearch" }
  | { type: "approval/request"; id: string; description: string; kind: "shell" | "destructive"; command?: string }
  | { type: "autoApproveState"; active: boolean }
  | { type: "search/indexProgress"; filesScanned: number; filesIndexed: number; chunksEmbedded: number; errors: number }
  | { type: "mcp/testResult"; server?: string; output: string }
  | { type: "mcp/traffic"; server: string; dir: string; msg: string }
  | { type: "memory/list"; memories: { index: number; category: string; content: string; createdAt: string }[] }
  | { type: "hooks/list"; hooks: { event: string; matcher: string; command: string; enabled: boolean; tools?: string[] }[] }
  | { type: "session/loadComposer"; text: string }
  | { type: "session/replaceState"; messages: ChatMessage[]; steps: ProcessStep[]; loadComposer?: string }
  | { type: "session/guidance"; text: string }
  | { type: "error"; message: string; code?: "timeout" | "rate_limit" | "auth" | "provider" | "malformed" | "network" | "aborted"; inReplyTo?: string };
export type WebviewMsg =
  | { type: "chat/send"; text: string; attachments?: { uri: string; preview?: string }[]; images?: string[] }
  | { type: "chat/guidance"; text: string }
  | { type: "chat/stop" }
  | { type: "chat/retract"; turnId: string }
  | { type: "chat/continue" }
  | { type: "chat/answerClarification"; id: string; answer: string }
  | { type: "model/select"; modelId: string }
  | { type: "model/add"; model: ModelDescriptor }
  | { type: "model/remove"; modelId: string }
  | { type: "provider/add"; provider: Omit<ProviderConfig, "apiKey">; apiKey?: string }
  | { type: "provider/remove"; providerId: string }
  | { type: "provider/toggle"; providerId: string; enabled: boolean }
  | { type: "config/get"; key: string; id: string }
  | { type: "config/set"; key: string; value: unknown }
  | { type: "mcp/addServer"; name: string; transport: { type: "stdio"; command: string; args?: string[] } | { type: "http"; url: string; headers?: Record<string, string> } }
  | { type: "mcp/removeServer"; name: string }
  | { type: "mcp/toggleServer"; name: string; enabled: boolean }
  | { type: "mcp/list" }
  | { type: "mcp/marketplaceSearch"; query: string }
  | { type: "mcp/testCall"; server: string; tool: string }
  | { type: "ui/attachSelection" }
  | { type: "ui/showProblems" }
  | { type: "ui/openFullscreen" }
  | { type: "ui/openSettings" }
  | { type: "ui/openFile"; path: string }
  | { type: "ui/openPrompt" }
  | { type: "ui/newTask" }
  | { type: "ready" }
  | { type: "chat/switch"; chatId: string }
  | { type: "chat/rename"; chatId: string; title: string }
  | { type: "chat/delete"; chatId: string }
  | { type: "chat/new" }
  | { type: "chat/compact" }
  | { type: "ui/openSidebar" }
  | { type: "ui/openTab"; tab: string }
  | { type: "ui/showSettings" }
  | { type: "search/reindex" }
  | { type: "model/bindUpdate"; modelId: string; providerId: string; remoteModel?: string }
  | { type: "mode/select"; mode: string }
  | { type: "autoApprove/toggle" }
  | { type: "approval/response"; id: string; allowed: boolean; rememberCommand?: string; rememberPrefix?: string }
  | { type: "approval/setPreset"; preset: string }
  | { type: "chat/search"; query: string }
  | { type: "chat/resume"; id: string }
  | { type: "chat/revertToMessage"; messageId: string; restoreFiles?: boolean; content?: string; loadToComposer?: boolean }
  | { type: "chat/editMessage"; messageId: string; newContent: string; content?: string }
  | { type: "memory/list" }
  | { type: "memory/delete"; index: number }
  | { type: "hooks/list" };
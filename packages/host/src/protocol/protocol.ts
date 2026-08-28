import type { DiffHunk, ProcessStep } from "./process.js";
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
  | "302ai"
  | "abacus"
  | "abliteration-ai"
  | "ai-router"
  | "ai21"
  | "aiand"
  | "aibadgr"
  | "aiml-api"
  | "aki-io"
  | "aleph-alpha"
  | "alibaba"
  | "alibaba-coding-plan"
  | "alibaba-coding-plan-cn"
  | "alibaba-token-plan"
  | "alibaba-token-plan-cn"
  | "ambient"
  | "anthropic"
  | "any-llm"
  | "anyapi"
  | "anyscale"
  | "apexit"
  | "aphrodite"
  | "apiyi"
  | "atomic-chat"
  | "auriko"
  | "aws-bedrock"
  | "aws-bedrock-mantle"
  | "azure-foundry"
  | "azure-openai"
  | "baichuan"
  | "baidu-qianfan"
  | "baidu-qianfan-ai"
  | "bailing"
  | "baseten"
  | "berget"
  | "bfl"
  | "bifrost"
  | "blueclaw"
  | "braintrust"
  | "byteplus"
  | "bytez"
  | "cerebras"
  | "chutes"
  | "clarifai"
  | "claudinio"
  | "cline-pass"
  | "cloudferro-sherlock"
  | "cloudflare-workers-ai"
  | "cohere"
  | "comet-api"
  | "compactifai"
  | "coralbricks"
  | "cortecs"
  | "crof"
  | "crossmodel"
  | "daoxe"
  | "dashscope"
  | "databricks"
  | "datarobot"
  | "decart"
  | "deepgram"
  | "deepinfra"
  | "deepseek"
  | "digitalocean"
  | "dinference"
  | "drun"
  | "ebcloud"
  | "edenai"
  | "elevenlabs"
  | "empiriolabs"
  | "evroc"
  | "fal"
  | "fastrouter"
  | "featherless"
  | "fireworks"
  | "freemodel"
  | "friendli"
  | "frogbot"
  | "galadriel"
  | "gcp-vertex"
  | "github-copilot"
  | "github-models"
  | "gmi-cloud"
  | "google"
  | "gpt4all"
  | "gradientai"
  | "greenpt"
  | "groq"
  | "helicone"
  | "heroku"
  | "hetzner"
  | "hpc-ai"
  | "huggingface"
  | "hyper"
  | "hyperbolic"
  | "ibm-watsonx"
  | "iflowcn"
  | "impossibl"
  | "inception"
  | "inceptron"
  | "inference"
  | "inferx"
  | "infomaniak"
  | "io-net"
  | "jan"
  | "jiekou"
  | "jina"
  | "kenari"
  | "kilo-gateway"
  | "kimi"
  | "kimi-cn"
  | "kimi-for-coding"
  | "kluster-ai"
  | "koboldcpp"
  | "kuae-cloud-coding-plan"
  | "lambda-ai"
  | "laozhang"
  | "lemonade"
  | "lepton"
  | "lilac"
  | "litellm-proxy"
  | "llama-api"
  | "llama-cpp"
  | "llamafile"
  | "llamagate"
  | "llmgateway"
  | "llmhub"
  | "llmtr"
  | "lm-studio"
  | "localai"
  | "longcat"
  | "lucidquery"
  | "lynkr"
  | "manus"
  | "martian"
  | "meganova"
  | "meta"
  | "minimax"
  | "minimax-cn"
  | "minimax-cn-coding-plan"
  | "minimax-coding-plan"
  | "mistral"
  | "mixlayer"
  | "moark"
  | "modal"
  | "model-oracle-ai"
  | "modelis"
  | "modelscope"
  | "modelslab"
  | "morph"
  | "nanogpt"
  | "near-ai"
  | "nebius"
  | "neon"
  | "neuralwatt"
  | "new-api"
  | "nlp-cloud"
  | "nova"
  | "novita"
  | "nscale"
  | "nvidia"
  | "ofox"
  | "ollama"
  | "ollama-cloud"
  | "one-api"
  | "openai"
  | "openai-compatible"
  | "opencode"
  | "opencode-go"
  | "openrouter"
  | "oracle-oci"
  | "orcarouter"
  | "orq"
  | "ovhcloud"
  | "perplexity"
  | "perplexity-agent"
  | "petals"
  | "pioneer"
  | "poe"
  | "poolside"
  | "portkey"
  | "predibase"
  | "privatemode-ai"
  | "publicai"
  | "qihang-ai"
  | "qiniu-ai"
  | "recraft"
  | "regolo-ai"
  | "replicate"
  | "requesty"
  | "routing-run"
  | "runwayml"
  | "sakana"
  | "sambanova"
  | "sarvam"
  | "scaleway"
  | "scx"
  | "sensenova"
  | "sglang"
  | "shareai"
  | "siliconflow"
  | "siliconflow-cn"
  | "snowflake-cortex"
  | "spheron"
  | "stability-ai"
  | "stackit"
  | "stepfun"
  | "stepfun-ai-step-plan"
  | "stepfun-step-plan"
  | "subconscious"
  | "submodel"
  | "synthetic"
  | "tabby"
  | "telnyx"
  | "tencent-cloud"
  | "tencent-coding-plan"
  | "tencent-token-plan"
  | "tencent-tokenhub"
  | "tensormesh"
  | "tensorx"
  | "tgi"
  | "the-grid-ai"
  | "thinkingmachines"
  | "tinfoil"
  | "together"
  | "tokenrouter"
  | "topaz"
  | "triton-inference"
  | "trustedrouter"
  | "umans-ai"
  | "umans-ai-coding-plan"
  | "unify-ai"
  | "unorouter"
  | "upstage"
  | "v0"
  | "venice"
  | "vercel"
  | "vivgrid"
  | "vllm"
  | "volcengine"
  | "voyage"
  | "vscode-lm"
  | "vultr"
  | "wafer.ai"
  | "wandb-inference"
  | "wavespeed"
  | "writer"
  | "xai"
  | "xiaomi-mimo"
  | "xiaomi-token-plan-ams"
  | "xiaomi-token-plan-cn"
  | "xiaomi-token-plan-sgp"
  | "xinference"
  | "xpersona"
  | "z-ai"
  | "z-ai-cn"
  | "zai-coding-plan"
  | "zeldoc"
  | "zenifra"
  | "zenmux"
  | "zeroone"
  | "zhipuai-coding-plan";
export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  apiKey?: string;
  startCommand?: string;
  enabled: boolean;
}
export type ProviderSummary = Omit<ProviderConfig, "apiKey"> & { hasApiKey: boolean };
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
  noCompact?: boolean;
  hidden?: boolean;
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
  | { type: "context_compressed"; turnId: string; toolName: string; kind: string; saved: number; ts: number }
  | { type: "error"; turnId: string; message: string; ts: number }
  | { type: "retry"; turnId: string; toolName: string; attempt: number; reason: string; ts: number };
export type HostMsg =
  | { type: "session/init"; sessionId: string; chatId?: string; models: ModelDescriptor[]; currentModelId: string; modes?: { slug: string; description: string }[]; currentMode?: string }
  | { type: "session/message"; message: ChatMessage; sessionId?: string }
  | { type: "session/assistantText"; id: string; text: string; sessionId?: string }
  | { type: "session/steps"; steps: ProcessStep[]; sessionId?: string }
  | { type: "session/stepUpdate"; step: ProcessStep; sessionId?: string }
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
  | { type: "provider/list"; providers: ProviderSummary[] }
  | { type: "config/get"; value: unknown; inReplyTo: string }
  | { type: "config/changed"; key: string; value: unknown }
  | { type: "mcp/list"; servers: { name: string; enabled: boolean; transport: "stdio" | "http"; toolCount: number }[] }
  | { type: "mcp/marketplaceResults"; results?: unknown[]; error?: string }
  | { type: "mode/list"; modes: { slug: string; roleDefinition: string; allowedTools: string[]; writeGlob?: string; description: string; whenToUse: string; model?: string; source: "builtin" | "workspace" | "global" }[] }
  | { type: "chat/searchResults"; results: { id: string; title: string; matches: string[] }[]; query?: string }
  | { type: "ui/showSettings" }
  | { type: "ui/showSearch" }
  | { type: "ui/showUpdate"; version: string; url: string }
  | { type: "approval/request"; id: string; description: string; kind: "shell" | "destructive"; command?: string }
  | { type: "autoApproveState"; active: boolean }
  | { type: "search/indexProgress"; filesScanned: number; filesIndexed: number; chunksEmbedded: number; errors: number }
  | { type: "search/indexUpdated"; updated: string[]; removed: string[] }
  | { type: "mcp/testResult"; server?: string; output: string }
  | { type: "mcp/traffic"; server: string; dir: string; msg: string }
  | { type: "memory/list"; memories: { index: number; category: string; content: string; createdAt: string }[] }
  | { type: "hooks/list"; hooks: { event: string; matcher: string; command: string; enabled: boolean; tools?: string[] }[] }
  | { type: "session/replaceState"; messages: ChatMessage[]; steps: ProcessStep[]; loadComposer?: string }
  | { type: "session/guidance"; text: string }
  | { type: "error"; message: string; code?: "timeout" | "rate_limit" | "auth" | "provider" | "malformed" | "network" | "aborted"; inReplyTo?: string }
  | { type: "provider/internalSetupProgress"; phase: string; pct: number; error?: string }
  | { type: "provider/serverState"; providerId: string; running: boolean; pid?: number }
  | { type: "chat/polishResult"; original: string; polished: string }
  | { type: "chat/toolsSummary"; id: string; text: string }
  | { type: "chat/polishFailed"; original: string }
  | { type: "chat/routeResult"; original: string; modelId: string; modelLabel: string; aaScore: number; requiredScore: number; difficulty: number; domain?: string; confidence: number; tau?: number }
  | { type: "chat/routeFailed"; original: string; reason?: "no-model" | "model-unavailable" | "error" };
export type WebviewMsg =
  | { type: "chat/send"; text: string; attachments?: { uri: string; preview?: string }[]; images?: string[]; modelId?: string; autoRouted?: boolean }
  | { type: "chat/route"; text: string; attachments?: { uri: string; preview?: string }[]; images?: string[] }
  | { type: "chat/polish"; text: string }
  | { type: "chat/summarizeTools"; id: string; titles: string[] }
  | { type: "chat/saveGroupTitle"; stepId: string; title: string; mode: string }
  | { type: "chat/guidance"; text: string }
  | { type: "chat/stop" }
  | { type: "chat/retract"; turnId: string }
  | { type: "chat/continue" }
  | { type: "chat/answerClarification"; id: string; answer: string }
  | { type: "model/select"; modelId: string }
  | { type: "model/add"; model: ModelDescriptor }
  | { type: "model/remove"; modelId: string }
  | { type: "provider/add"; provider: Omit<ProviderConfig, "apiKey">; apiKey?: string }
  | { type: "provider/update"; providerId: string; changes: { label?: string; baseUrl?: string; kind?: ProviderKind; startCommand?: string }; apiKey?: string }
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
  | { type: "ui/attachFile" }
  | { type: "ui/attachProblems" }
  | { type: "ui/attachAllProblems" }
  | { type: "ui/attachFileProblems" }
  | { type: "ui/attachCurrentFile" }
  | { type: "ui/attachGitDiff" }
  | { type: "ui/attachGitStaged" }
  | { type: "ui/attachChangedFiles" }
  | { type: "ui/attachPullRequest" }
  | { type: "ui/showProblems" }
  | { type: "ui/openFullscreen"; show?: "settings" | "search" }
  | { type: "ui/openExternal"; url: string }
  | { type: "ui/openSettings" }
  | { type: "ui/openFile"; path: string; line?: number; endLine?: number }
  | { type: "ui/openFileDiff"; path: string; hunks: DiffHunk[]; streamId?: string }
  | { type: "ui/openPrompt" }
  | { type: "ui/newTask" }
  | { type: "ready" }
  | { type: "chat/switch"; chatId: string }
  | { type: "chat/rename"; chatId: string; title: string }
  | { type: "chat/delete"; chatId: string }
  | { type: "chat/new" }
  | { type: "chat/compact" }
  | { type: "ui/openSidebar" }
  | { type: "search/reindex" }
  | { type: "model/bindUpdate"; modelId: string; providerId: string; remoteModel?: string }
  | { type: "mode/select"; mode: string }
  | { type: "mode/list" }
  | { type: "mode/save"; mode: { slug: string; roleDefinition: string; allowedTools: string[]; writeGlob?: string; description: string; whenToUse: string; model?: string }; scope?: "workspace" | "global" }
  | { type: "mode/delete"; slug: string; scope?: "workspace" | "global" }
  | { type: "autoApprove/toggle" }
  | { type: "approval/response"; id: string; allowed: boolean; rememberCommand?: string; rememberPrefix?: string }
  | { type: "approval/setPreset"; preset: string }
  | { type: "chat/search"; query: string }
  | { type: "chat/resume"; id: string }
  | { type: "chat/revertToMessage"; messageId: string; restoreFiles?: boolean; content?: string; loadToComposer?: boolean }
  | { type: "chat/editMessage"; messageId: string; newContent: string; content?: string }
  | { type: "memory/list" }
  | { type: "memory/delete"; index: number }
  | { type: "hooks/list" }
  | { type: "diff/accept"; stepId: string; filePath: string }
  | { type: "diff/reject"; stepId: string; filePath: string; hunks: DiffHunk[] }
  | { type: "provider/setupInternal" }
  | { type: "provider/startServer"; providerId: string }
  | { type: "provider/stopServer"; providerId: string };
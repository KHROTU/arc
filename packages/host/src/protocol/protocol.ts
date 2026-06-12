import type { ProcessStep } from "./process.js";
export type Role = "system" | "user" | "assistant" | "tool" | "developer";
export type ModelTier = "free" | "light" | "default" | "heavy";
export interface ModelDescriptor {
  id: string;
  label: string;
  tier: ModelTier;
  contextWindow: number;
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
  | "vscode-lm"
  | "openai-compatible";
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
  toolCallId?: string;
  toolCalls?: ToolCall[];
  ts: number;
  meta?: { modelId: string; providerId: string; tier: ModelTier };
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
  | { type: "session/init"; sessionId: string; models: ModelDescriptor[]; currentModelId: string }
  | { type: "session/message"; message: ChatMessage }
  | { type: "session/assistantText"; id: string; text: string }
  | { type: "session/steps"; steps: ProcessStep[] }
  | { type: "session/usage"; usage: TurnUsage; perModel: Record<string, TurnUsage> }
  | { type: "session/turnStart"; turnId: string }
  | { type: "session/turnEnd"; turnId: string; ok: boolean; error?: string }
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
  | { type: "error"; message: string; inReplyTo?: string };
export type WebviewMsg =
  | { type: "chat/send"; text: string; attachments?: { uri: string; preview?: string }[] }
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
  | { type: "mcp/addServer"; name: string; transport: { type: "stdio"; command: string; args?: string[] } | { type: "http"; url: string; headers?: Record<string, string> } }
  | { type: "mcp/removeServer"; name: string }
  | { type: "mcp/toggleServer"; name: string; enabled: boolean }
  | { type: "mcp/list" }
  | { type: "ui/attachSelection" }
  | { type: "ui/showProblems" }
  | { type: "ui/openFullscreen" }
  | { type: "ui/openSettings" }
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
  | { type: "model/bindUpdate"; modelId: string; providerId: string; remoteModel?: string };
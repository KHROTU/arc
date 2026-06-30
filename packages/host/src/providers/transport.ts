import type { ProviderKind } from "../protocol/protocol.js";
import { getProviderSpec } from "./catalog.js";
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_call_delta"; id: string; argsDelta: string }
  | { type: "usage"; usage: TurnUsage }
  | { type: "error"; message: string }
  | { type: "done" };
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export const toApiToolName = (name: string): string => name.replace(/\./g, "__").replace(/\//g, "--");
export const fromApiToolName = (name: string): string => name.replace(/__/g, ".").replace(/--/g, "/");
export interface StreamRequest {
  model: import("../protocol/protocol.js").ModelDescriptor;
  provider: import("../protocol/protocol.js").ProviderConfig;
  messages: import("../protocol/protocol.js").ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  proxyUrl?: string;
}
export interface StreamHandle {
  events: AsyncIterable<StreamEvent>;
  abort: () => void;
}
export interface Transport {
  kind: ProviderKind;
  stream(req: StreamRequest): Promise<StreamHandle>;
}
import { openAICompatibleTransport } from "./openai-compatible.js";
import { anthropicTransport } from "./anthropic.js";
import { ollamaTransport } from "./ollama.js";
export { openAICompatibleTransport, anthropicTransport, ollamaTransport };
import type { TurnUsage } from "../protocol/protocol.js";
export function transportFor(provider: import("../protocol/protocol.js").ProviderConfig): Transport {
  if (provider.kind === "ollama") return ollamaTransport;
  if (provider.kind === "anthropic") return anthropicTransport;
  if (provider.kind === "vscode-lm") {
    throw new Error("vscode-lm transport is wired by the extension host, not the generic transportFor() helper.");
  }
  const spec = getProviderSpec(provider.kind);
  const base = provider.baseUrl || spec?.defaultBaseUrl || "";
  return openAICompatibleTransport.withBase(base);
}
import type { ProviderKind } from "../protocol/protocol.js";
import type { ChatMessage } from "../protocol/protocol.js";
import { getProviderSpec } from "./catalog.js";
import { hostWarn } from "../log/logger.js";
export function sanitizeToolChains(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let dropped = 0;
  for (const m of messages) {
    if (m.role === "tool") {
      const id = (m.toolCallId ?? "").trim();
      if (!id) {
        out.push(m);
        continue;
      }
      let i = out.length - 1;
      while (i >= 0 && out[i].role === "tool") i--;
      const prev = out[i];
      if (!prev || prev.role !== "assistant" || !prev.toolCalls?.some((t) => t.id === id)) {
        dropped++;
        continue;
      }
      const consumed = new Set<string>();
      for (let j = out.length - 1; j >= 0 && out[j].role === "tool"; j--) {
        const cid = out[j].toolCallId;
        if (cid) consumed.add(cid);
      }
      if (consumed.has(id)) {
        dropped++;
        continue;
      }
    }
    out.push(m);
  }
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.role !== "assistant" || !m.toolCalls?.length) continue;
    const unique = new Map<string, NonNullable<ChatMessage["toolCalls"]>[number]>();
    for (const t of m.toolCalls) {
      if (!unique.has(t.id)) unique.set(t.id, t);
    }
    const ids = [...unique.keys()];
    const answered = new Set<string>();
    for (let j = i + 1; j < out.length && out[j].role === "tool"; j++) {
      const cid = out[j].toolCallId;
      if (cid) answered.add(cid);
    }
    const complete = ids.every((id) => answered.has(id));
    if (!complete) {
      out[i] = { ...m, toolCalls: undefined };
      dropped++;
    } else if (unique.size !== m.toolCalls.length) {
      out[i] = { ...m, toolCalls: [...unique.values()] };
    }
  }
  if (dropped > 0) {
    hostWarn(`[arc] sanitizeToolChains cleaned ${dropped} orphaned/duplicate/incomplete tool message(s) before sending to the provider`);
  }
  return out;
}
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_call_delta"; id: string; name: string; argsDelta: string }
  | { type: "usage"; usage: TurnUsage }
  | { type: "ping" }
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
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  proxyUrl?: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  conversationId?: string;
}
export interface StreamHandle {
  events: AsyncIterable<StreamEvent>;
  abort: () => void;
}
export interface Transport {
  kind: ProviderKind;
  stream(req: StreamRequest): Promise<StreamHandle>;
}
export const MAX_STREAM_CONTENT_BYTES = 4 * 1024 * 1024;
export interface StreamContentBudget {
  bytes: number;
}
export class StreamContentLimitError extends Error {
  constructor() {
    super("Provider stream exceeded 4 MiB.");
    this.name = "StreamContentLimitError";
  }
}
export function chargeStreamContent(budget: StreamContentBudget, delta: string): void {
  budget.bytes += Buffer.byteLength(delta);
  if (budget.bytes > MAX_STREAM_CONTENT_BYTES) throw new StreamContentLimitError();
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
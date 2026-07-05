import { randomUUID } from "node:crypto";
import type { ModelRegistry } from "../routing/registry.js";
import { pickProvider } from "../routing/router.js";
import { transportFor } from "../providers/transport.js";
import type { ChatMessage } from "../protocol/protocol.js";
export interface SamplingContentBlock {
  type: string;
  text?: string;
}
export interface SamplingMessage {
  role: string;
  content: SamplingContentBlock;
}
export interface SamplingCreateMessageParams {
  messages?: SamplingMessage[];
  systemPrompt?: string;
  maxTokens?: number;
}
export interface SamplingResult {
  role: "assistant";
  content: { type: "text"; text: string };
  model: string;
}
export async function completeSamplingRequest(
  registry: ModelRegistry,
  params: SamplingCreateMessageParams,
  opts?: { proxyUrl?: string },
): Promise<SamplingResult> {
  const model = registry.getCurrent();
  if (!model) throw new Error("No model configured.");
  const decision = pickProvider(registry, model);
  if (!decision) throw new Error(`No provider available for model '${model.id}'.`);
  const transport = transportFor(decision.provider);
  const messages: ChatMessage[] = [];
  if (params.systemPrompt) {
    messages.push({ id: randomUUID(), role: "system", content: params.systemPrompt, ts: Date.now() });
  }
  for (const m of params.messages ?? []) {
    messages.push({
      id: randomUUID(),
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content?.text ?? "",
      ts: Date.now(),
    });
  }
  const handle = await transport.stream({
    model,
    provider: decision.provider,
    messages,
    maxTokens: params.maxTokens,
    proxyUrl: opts?.proxyUrl,
  });
  let text = "";
  for await (const ev of handle.events) {
    if (ev.type === "text") text += ev.delta;
    else if (ev.type === "error") throw new Error(ev.message);
    else if (ev.type === "done") break;
  }
  return { role: "assistant", content: { type: "text", text }, model: model.id };
}
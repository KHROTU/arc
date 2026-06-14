import type { ChatMessage, ModelDescriptor } from "../protocol/protocol.js";
const CHARS_PER_TOKEN = 4;
const FACTOR = 1.3;
const MIN_OUTPUT_RESERVE = 16_384;
export interface CompactionStats {
  avgOutput: number;
  avgPrompt: number;
  samples: number;
}
export class CompactionTracker {
  private stats = new Map<string, CompactionStats>();
  observe(modelId: string, usage: { prompt: number; completion: number; thinking: number }) {
    const s = this.stats.get(modelId) ?? { avgOutput: 0, avgPrompt: 0, samples: 0 };
    const alpha = 0.2;
    const out = usage.completion + usage.thinking;
    s.avgOutput = s.avgOutput * (1 - alpha) + out * alpha;
    s.avgPrompt = s.avgPrompt * (1 - alpha) + usage.prompt * alpha;
    s.samples += 1;
    this.stats.set(modelId, s);
  }
  for(modelId: string): CompactionStats {
    return this.stats.get(modelId) ?? { avgOutput: 0, avgPrompt: 0, samples: 0 };
  }
}
export interface CompactionConfig {
  safetyMargin: number;
  enforce: boolean;
  keepTail: number;
}
export const defaultCompactionConfig: CompactionConfig = {
  safetyMargin: 0.15,
  enforce: true,
  keepTail: 6,
};
export interface CompactionDecision {
  shouldCompact: boolean;
  reason: string;
  currentUsage: number;
  usable: number;
  window: number;
}
function usable(model: ModelDescriptor): number {
  const output = model.maxOutputTokens ?? MIN_OUTPUT_RESERVE;
  return Math.max(0, model.contextWindow - Math.max(output, MIN_OUTPUT_RESERVE));
}
export function decideCompaction(
  messages: ChatMessage[],
  model: ModelDescriptor,
  _tracker: CompactionTracker,
  _cfg: CompactionConfig = defaultCompactionConfig,
  lastKnownPromptTokens: number = 0,
  tools?: { description?: string; inputSchema?: unknown }[],
): CompactionDecision {
  const estimated = estimateTokens(messages, tools);
  const current = lastKnownPromptTokens > 0 ? Math.max(lastKnownPromptTokens, estimated) : estimated;
  const limit = usable(model);
  const window = model.contextWindow;
  if (limit <= 0) {
    return { shouldCompact: false, reason: "unlimited context window", currentUsage: current, usable: limit, window };
  }
  if (current >= limit) {
    return { shouldCompact: true, reason: `estimated ${current} >= usable ${limit}`, currentUsage: current, usable: limit, window };
  }
  return { shouldCompact: false, reason: "headroom sufficient", currentUsage: current, usable: limit, window };
}
export function compact(messages: ChatMessage[], cfg: CompactionConfig = defaultCompactionConfig, summarize: (msgs: ChatMessage[]) => string): ChatMessage[] {
  if (messages.length <= cfg.keepTail + 1) return messages;
  const sys = messages.filter((m) => m.role === "system");
  const tail = messages.slice(-cfg.keepTail);
  const middle = messages.slice(sys.length, messages.length - cfg.keepTail);
  if (middle.length === 0) return messages;
  const summary = summarize(middle);
  const summaryMsg: ChatMessage = {
    id: `summary-${Date.now()}`,
    role: "system",
    content: `## Compaction summary of ${middle.length} earlier messages\n\n${summary}`,
    ts: Date.now(),
  };
  return [...sys, summaryMsg, ...tail];
}
export async function compactAsync(
  messages: ChatMessage[],
  summarize: (msgs: ChatMessage[]) => Promise<string>,
  cfg: CompactionConfig = defaultCompactionConfig,
): Promise<ChatMessage[]> {
  if (messages.length <= cfg.keepTail + 1) return messages;
  const sys = messages.filter((m) => m.role === "system");
  const tail = messages.slice(-cfg.keepTail);
  const middle = messages.slice(sys.length, messages.length - cfg.keepTail);
  if (middle.length === 0) return messages;
  const summary = await summarize(middle);
  const summaryMsg: ChatMessage = {
    id: `summary-${Date.now()}`,
    role: "system",
    content: `## Compaction summary of ${middle.length} earlier messages\n\n${summary}`,
    ts: Date.now(),
  };
  return [...sys, summaryMsg, ...tail];
}
export function estimateTokens(messages: ChatMessage[], tools?: { description?: string; inputSchema?: unknown }[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
    if (m.thinking) chars += m.thinking.length;
    if (m.toolCallId) chars += m.toolCallId.length;
    chars += ROLE_OVERHEAD[m.role] ?? ROLE_OVERHEAD.default;
    if (m.toolCalls) {
      for (const t of m.toolCalls) {
        chars += t.name.length + JSON.stringify(t.args).length;
        chars += TOOL_CALL_OVERHEAD;
      }
    }
  }
  if (tools?.length) {
    const toolDefs = tools.map((t) => ({
      name: t.description ? "" : "",
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? {},
    }));
    chars += JSON.stringify(toolDefs).length;
  }
  return Math.ceil((chars / CHARS_PER_TOKEN) * FACTOR);
}
const ROLE_OVERHEAD: Record<string, number> = {
  system: 12,
  user: 10,
  assistant: 12,
  tool: 16,
  developer: 12,
  default: 8,
};
const TOOL_CALL_OVERHEAD = 24;
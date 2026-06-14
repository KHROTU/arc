import type { ChatMessage, ModelDescriptor } from "../protocol/protocol.js";
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
  projected: number;
  window: number;
}
export function decideCompaction(
  messages: ChatMessage[],
  model: ModelDescriptor,
  tracker: CompactionTracker,
  cfg: CompactionConfig = defaultCompactionConfig,
  lastKnownPromptTokens: number = 0,
): CompactionDecision {
  const estimated = estimateTokens(messages);
  const current = lastKnownPromptTokens > 0 ? Math.max(lastKnownPromptTokens, estimated) : estimated;
  const stats = tracker.for(model.id);
  const projected = current + Math.max(stats.avgOutput, 200) + Math.round(model.contextWindow * cfg.safetyMargin);
  const window = model.contextWindow;
  if (stats.samples < 3) {
    if (current > window * 0.75) {
      return { shouldCompact: true, reason: "75% of window reached (insufficient avg samples)", currentUsage: current, projected, window };
    }
    return { shouldCompact: false, reason: "insufficient avg samples", currentUsage: current, projected, window };
  }
  if (projected > window * 0.85) {
    return { shouldCompact: true, reason: `projected ${projected} > ${window}*0.85 (avg output ${Math.round(stats.avgOutput)})`, currentUsage: current, projected, window };
  }
  return { shouldCompact: false, reason: "headroom sufficient", currentUsage: current, projected, window };
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
export function estimateTokens(messages: ChatMessage[]): number {
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
  return Math.ceil(chars / 3.5);
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
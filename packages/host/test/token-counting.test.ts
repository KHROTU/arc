import { describe, it, expect } from "vitest";
import { estimateTokens, decideCompaction, CompactionTracker } from "../src/compaction/compaction";
import type { ChatMessage, ModelDescriptor } from "../src/protocol/protocol";
const m = (id: string, role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role, content, ts: 0, ...extra,
});
const model: ModelDescriptor = {
  id: "m1", label: "Test", tier: "default", contextWindow: 100_000,
  costPer1mIn: 0, costPer1mOut: 0, providers: [],
};
describe("estimateTokens", () => {
  it("counts content plus role overhead", () => {
    const msgs: ChatMessage[] = [
      m("1", "system", "You are a helpful assistant."),
      m("2", "user", "hello"),
    ];
    const t = estimateTokens(msgs);
    expect(t).toBeGreaterThan(10);
    expect(t).toBeLessThan(50);
  });
  it("includes thinking tokens", () => {
    const a = m("1", "assistant", "ok");
    const b = m("2", "assistant", "ok", { thinking: "very long thinking process ".repeat(50) });
    expect(estimateTokens([b])).toBeGreaterThan(estimateTokens([a]));
  });
  it("includes tool calls (name + args + overhead)", () => {
    const noTools = m("1", "assistant", "x");
    const withTools = m("2", "assistant", "x", { toolCalls: [{ id: "c1", name: "file.read", args: { path: "a/very/long/path/to/some/file.ts" } }] });
    expect(estimateTokens([withTools])).toBeGreaterThan(estimateTokens([noTools]));
  });
  it("includes toolCallId overhead for tool messages", () => {
    const noId = m("1", "tool", "result");
    const withId = m("2", "tool", "result", { toolCallId: "call_abc123" });
    expect(estimateTokens([withId])).toBeGreaterThan(estimateTokens([noId]));
  });
  it("returns more reasonable counts than naive chars/4", () => {
    const msgs: ChatMessage[] = [
      m("1", "system", "sys ".repeat(200)),
      m("2", "user", "do the thing please"),
      m("3", "assistant", "ok", { toolCalls: [{ id: "c1", name: "shell.run", args: { command: "echo hello && ls -la" } }] }),
      m("4", "tool", "hello\nfile1 file2"),
    ];
    const t = estimateTokens(msgs);
    expect(t).toBeGreaterThan(200);
    expect(t).toBeLessThan(400);
  });
});
describe("decideCompaction", () => {
  it("does not trigger below threshold", () => {
    const tracker = new CompactionTracker();
    const msgs = Array.from({ length: 10 }, (_, i) => m(String(i), "user", "hi ".repeat(20)));
    const d = decideCompaction(msgs, model, tracker);
    expect(d.shouldCompact).toBe(false);
  });
  it("triggers when last-known prompt is near window", () => {
    const tracker = new CompactionTracker();
    for (let i = 0; i < 5; i++) tracker.observe("m1", { prompt: 1000, completion: 100, thinking: 0 });
    const d = decideCompaction([], model, tracker, undefined, 90_000);
    expect(d.shouldCompact).toBe(true);
    expect(d.currentUsage).toBe(90_000);
  });
  it("uses max(estimate, lastKnown) for ground truth", () => {
    const tracker = new CompactionTracker();
    for (let i = 0; i < 5; i++) tracker.observe("m1", { prompt: 50_000, completion: 1000, thinking: 0 });
    const tinyMsgs = [m("1", "user", "hi")];
    const d = decideCompaction(tinyMsgs, model, tracker, undefined, 60_000);
    expect(d.currentUsage).toBe(60_000);
  });
  it("falls back to estimate when no lastKnown provided", () => {
    const tracker = new CompactionTracker();
    for (let i = 0; i < 5; i++) tracker.observe("m1", { prompt: 50_000, completion: 1000, thinking: 0 });
    const bigMsgs = Array.from({ length: 1000 }, (_, i) => m(String(i), "user", "x".repeat(500)));
    const d = decideCompaction(bigMsgs, model, tracker);
    expect(d.currentUsage).toBeGreaterThan(0);
    expect(d.shouldCompact).toBe(true);
  });
});
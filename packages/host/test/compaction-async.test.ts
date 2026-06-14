import { describe, it, expect } from "vitest";
import { compactAsync } from "../src/compaction/compaction";
import type { ChatMessage } from "../src/protocol/protocol";
describe("compactAsync", () => {
  it("returns messages unchanged when too few to compact", async () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "user", content: "hi", ts: 1 },
      { id: "2", role: "assistant", content: "hello", ts: 2 },
    ];
    const out = await compactAsync(msgs, async () => "SHOULD NOT RUN");
    expect(out).toBe(msgs);
  });
  it("replaces the middle with the LLM-generated summary", async () => {
    const msgs: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
      ts: i,
    }));
    const out = await compactAsync(msgs, async () => "summary text");
    expect(out.length).toBeLessThan(msgs.length);
    expect(out.some((m) => m.content.includes("Compaction summary"))).toBe(true);
    expect(out.some((m) => m.content.includes("summary text"))).toBe(true);
    const summaryIdx = out.findIndex((m) => m.content.startsWith("## Compaction summary"));
    expect(summaryIdx).toBe(0);
    expect(out[summaryIdx + 1]?.content).toBe("msg 4");
  });
  it("preserves the system prompt message at index 0", async () => {
    const sys: ChatMessage = { id: "sys", role: "system", content: "you are a coding assistant", ts: 0 };
    const msgs: ChatMessage[] = [
      sys,
      ...Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
        ts: i + 1,
      })),
    ];
    const out = await compactAsync(msgs, async () => "summary");
    expect(out[0]).toEqual(sys);
  });
  it("propagates summarizer errors", async () => {
    const msgs: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      role: "user",
      content: `msg ${i}`,
      ts: i,
    }));
    await expect(compactAsync(msgs, async () => { throw new Error("llm down"); })).rejects.toThrow("llm down");
  });
});
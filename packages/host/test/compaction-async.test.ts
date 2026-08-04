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
  it("never splits a tool-call chain across the tail boundary", async () => {
    const chainAssistant: ChatMessage = {
      id: "assistant-chain",
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "a", name: "shell.run", args: { command: "x" } },
        { id: "b", name: "file.write", args: { path: "p" } },
      ],
      ts: 1,
    };
    const msgs: ChatMessage[] = [
      { id: "0", role: "user", content: "u0", ts: 0 },
      chainAssistant,
      { id: "ta", role: "tool", content: "out a", toolCallId: "a", ts: 2 },
      { id: "tb", role: "tool", content: "out b", toolCallId: "b", ts: 3 },
      { id: "4", role: "user", content: "u4", ts: 4 },
      { id: "5", role: "assistant", content: "a5", ts: 5 },
      { id: "6", role: "user", content: "u6", ts: 6 },
      { id: "7", role: "assistant", content: "a7", ts: 7 },
    ];
    const out = await compactAsync(msgs, async () => "summary");
    expect(out.some((m) => m.content.includes("Compaction summary"))).toBe(true);
    for (let i = 0; i < out.length; i++) {
      const m = out[i];
      if (m.role !== "tool") continue;
      let j = i - 1;
      while (j >= 0 && out[j].role === "tool") j--;
      expect(out[j]?.role).toBe("assistant");
      expect(out[j]?.toolCalls?.some((t) => t.id === m.toolCallId)).toBe(true);
    }
    expect(out.some((m) => m.id === "assistant-chain")).toBe(true);
    expect(out.some((m) => m.id === "tb")).toBe(true);
  });
});
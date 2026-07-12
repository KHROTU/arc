import { describe, it, expect } from "vitest";
import { applyPromptCaching } from "../src/providers/anthropic";
describe("applyPromptCaching", () => {
  it("marks the system prompt as an ephemeral cache breakpoint", () => {
    const body = applyPromptCaching({ system: "You are Arc.", messages: [{ role: "user", content: "hi" }] });
    expect(body.system).toEqual([{ type: "text", text: "You are Arc.", cache_control: { type: "ephemeral" } }]);
  });
  it("splits system into a cached static prefix and an uncached volatile Environment tail", () => {
    const system = "You are Arc.\n\n---\n\n## Environment\nDate: 2026-01-01";
    const body = applyPromptCaching({ system, messages: [{ role: "user", content: "hi" }] });
    expect(body.system).toEqual([
      { type: "text", text: "You are Arc.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "\n\n---\n\n## Environment\nDate: 2026-01-01" },
    ]);
  });
  it("leaves system prompt untouched when absent", () => {
    const body = applyPromptCaching({ messages: [{ role: "user", content: "hi" }] });
    expect(body.system).toBeUndefined();
  });
  it("marks the last tool definition as a cache breakpoint", () => {
    const body = applyPromptCaching({
      tools: [{ name: "a" }, { name: "b" }],
      messages: [{ role: "user", content: "hi" }],
    });
    const tools = body.tools as Record<string, unknown>[];
    expect(tools[0].cache_control).toBeUndefined();
    expect(tools[1].cache_control).toEqual({ type: "ephemeral" });
  });
  it("marks the second-to-last message (history) as cacheable, leaving the latest message dynamic", () => {
    const body = applyPromptCaching({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "latest" },
      ],
    });
    const messages = body.messages as { role: string; content: unknown }[];
    expect(messages[0].content).toBe("first");
    expect(messages[1].content).toEqual([{ type: "text", text: "second", cache_control: { type: "ephemeral" } }]);
    expect(messages[2].content).toBe("latest");
  });
  it("marks the last content block when history message content is already an array", () => {
    const body = applyPromptCaching({
      messages: [
        { role: "assistant", content: [{ type: "text", text: "a" }, { type: "tool_use", id: "1", name: "x", input: {} }] },
        { role: "user", content: "latest" },
      ],
    });
    const messages = body.messages as { role: string; content: Record<string, unknown>[] }[];
    expect(messages[0].content[0].cache_control).toBeUndefined();
    expect(messages[0].content[1].cache_control).toEqual({ type: "ephemeral" });
  });
  it("does nothing to messages when there is only one message", () => {
    const body = applyPromptCaching({ messages: [{ role: "user", content: "only" }] });
    const messages = body.messages as { role: string; content: unknown }[];
    expect(messages[0].content).toBe("only");
  });
  it("does not mutate the original body object", () => {
    const original = { system: "sys", messages: [{ role: "user", content: "a" }, { role: "user", content: "b" }] };
    const originalMessages = original.messages;
    applyPromptCaching(original);
    expect(original.system).toBe("sys");
    expect(original.messages).toBe(originalMessages);
    expect(originalMessages[0].content).toBe("a");
  });
});
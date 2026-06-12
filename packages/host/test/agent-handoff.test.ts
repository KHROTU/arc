import { describe, it, expect } from "vitest";
import { Agent, type AgentEventSink } from "../src/agent/agent";
import { ModelRegistry } from "../src/routing/registry";
import { CheckpointStore } from "../src/checkpoint/store";
import type { ChatMessage } from "../src/protocol/protocol";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
function makeSink() {
  const messages: ChatMessage[] = [];
  const events: string[] = [];
  const sink: AgentEventSink = {
    message: (m) => messages.push(m),
    steps: () => {},
    turnStart: () => events.push("turnStart"),
    turnEnd: () => events.push("turnEnd"),
    usage: () => {},
    handoff: () => events.push("handoff"),
    todo: () => {},
    clarification: () => {},
    done: () => events.push("done"),
    error: (m) => events.push(`error:${m}`),
  };
  return { sink, messages, events };
}
const handoffCallSse = (): string => [
  'data: {"id":"x","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_handoff_1","type":"function","function":{"name":"handoff","arguments":"{\\"reason\\":\\"need a heavier model\\",\\"direction\\":\\"escalate\\"}"}}]}}]}',
  "",
  'data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
  "",
  "data: [DONE]",
  "",
].join("\n");
describe("Agent handoff conversation integrity", () => {
  it("pushes a tool message answering the handoff tool_call, so the next request is valid", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-handoff-"));
    const registry = new ModelRegistry();
    registry.load({
      models: [{
        id: "m1", label: "Only", tier: "default", contextWindow: 8000,
        costPer1mIn: 0, costPer1mOut: 0,
        providers: [{ id: "p1", kind: "openai-compatible", priority: 0, remoteModel: "deepseek-chat" }],
      }],
      providers: [{ id: "p1", kind: "openai-compatible", label: "ds", enabled: true, baseUrl: "https://api.deepseek.com/v1" }],
    });
    const store = new CheckpointStore({ dir: tmp });
    const { sink, messages, events } = makeSink();
    let reqNum = 0;
    let secondBody = "";
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init: any) => {
      reqNum++;
      if (reqNum === 1) {
        return new Response(handoffCallSse(), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      secondBody = init?.body ? String(init.body) : "";
      return new Response([
        'data: {"id":"x","choices":[{"index":0,"delta":{"role":"assistant","content":"Continuing without handoff."}}]}',
        "",
        'data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    try {
      const agent = new Agent(registry, store, sink, {
        sessionID: "s1",
        isMain: true,
        systemPrompt: "You are a test assistant.",
        enabledTools: new Set(["handoff"]),
        toolContext: {},
      });
      await agent.send("please hand off");
      expect(reqNum).toBe(2);
      const body = JSON.parse(secondBody) as { messages: Array<{ role: string; tool_call_id?: string; tool_calls?: Array<{ id: string }> }> };
      const asstWithCall = body.messages.find((m) => m.role === "assistant" && m.tool_calls?.some((t) => t.id === "call_handoff_1"));
      const toolReply = body.messages.find((m) => m.role === "tool" && m.tool_call_id === "call_handoff_1");
      expect(asstWithCall).toBeDefined();
      expect(toolReply).toBeDefined();
      expect(body.messages.indexOf(toolReply!)).toBe(body.messages.indexOf(asstWithCall!) + 1);
      expect(events.some((e) => e.startsWith("error:"))).toBe(false);
      const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
      expect(lastAssistant?.content).toBe("Continuing without handoff.");
    } finally {
      globalThis.fetch = real;
    }
  });
});
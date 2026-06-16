import { describe, it, expect } from "vitest";
import { Agent, type AgentEventSink } from "../src/agent/agent";
import { ModelRegistry } from "../src/routing/registry";
import { CheckpointStore } from "../src/checkpoint/store";
import { ModeRegistry } from "../src/modes/index";
import type { ChatMessage } from "../src/protocol/protocol";
import type { ProcessStep } from "../src/protocol/process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
function makeSink() {
  const messages: ChatMessage[] = [];
  const events: string[] = [];
  let lastSteps: ProcessStep[] = [];
  const sink: AgentEventSink = {
    message: (m) => messages.push(m),
    steps: (s) => { lastSteps = s.map((x) => ({ ...x })); },
    turnStart: () => events.push("turnStart"),
    turnEnd: () => events.push("turnEnd"),
    usage: () => {},
    handoff: () => {},
    todo: () => {},
    clarification: () => {},
    done: () => events.push("done"),
    error: () => {},
  };
  return { sink, messages, events, getSteps: () => lastSteps };
}
describe("Agent parallel tool execution", () => {
  it("runs multiple independent tool calls concurrently", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-agent-parallel-"));
    const registry = new ModelRegistry();
    registry.load({
      models: [{
        id: "m1", label: "Test", tier: "default", contextWindow: 8000,
        costPer1mIn: 0, costPer1mOut: 0,
        providers: [{ id: "p1", kind: "openai-compatible", priority: 0, remoteModel: "test" }],
      }],
      providers: [{ id: "p1", kind: "openai-compatible", label: "p", enabled: true, baseUrl: "https://x.invalid/v1" }],
    });
    const store = new CheckpointStore({ dir: tmp });
    const { sink } = makeSink();
    const agent = new Agent(registry, store, sink, {
      isMain: true,
      systemPrompt: "test",
      enabledTools: new Set(),
      mode: "code",
      modeRegistry: new ModeRegistry(),
      toolContext: {} as any,
    });
    const calls = [
      { id: "a", name: "shell.run", args: { command: "echo a" } },
      { id: "b", name: "shell.run", args: { command: "echo b" } },
      { id: "c", name: "shell.run", args: { command: "echo c" } },
    ];
    const internal = agent as unknown as { partitionToolCalls: (t: typeof calls) => typeof calls[] };
    const phases = internal.partitionToolCalls(calls);
    expect(phases.length).toBe(1);
    expect(phases[0].length).toBe(3);
  });
  it("separates handoff/subagent calls into their own phase", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-agent-parallel-"));
    const registry = new ModelRegistry();
    registry.load({
      models: [{
        id: "m1", label: "Test", tier: "default", contextWindow: 8000,
        costPer1mIn: 0, costPer1mOut: 0,
        providers: [{ id: "p1", kind: "openai-compatible", priority: 0, remoteModel: "test" }],
      }],
      providers: [{ id: "p1", kind: "openai-compatible", label: "p", enabled: true, baseUrl: "https://x.invalid/v1" }],
    });
    const store = new CheckpointStore({ dir: tmp });
    const { sink } = makeSink();
    const agent = new Agent(registry, store, sink, {
      isMain: true,
      systemPrompt: "test",
      enabledTools: new Set(),
      mode: "code",
      modeRegistry: new ModeRegistry(),
      toolContext: {} as any,
    });
    const calls = [
      { id: "a", name: "shell.run", args: {} },
      { id: "b", name: "handoff", args: {} },
      { id: "c", name: "shell.run", args: {} },
    ];
    const internal = agent as unknown as { partitionToolCalls: (t: typeof calls) => typeof calls[] };
    const phases = internal.partitionToolCalls(calls);
    expect(phases.length).toBe(3);
    expect(phases[0]).toHaveLength(1);
    expect(phases[1]).toHaveLength(1);
    expect(phases[1][0].name).toBe("handoff");
    expect(phases[2]).toHaveLength(1);
  });
  it("groups all handoff/subagent calls together so they don't run in parallel with each other either", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-agent-parallel-"));
    const registry = new ModelRegistry();
    registry.load({
      models: [{
        id: "m1", label: "Test", tier: "default", contextWindow: 8000,
        costPer1mIn: 0, costPer1mOut: 0,
        providers: [{ id: "p1", kind: "openai-compatible", priority: 0, remoteModel: "test" }],
      }],
      providers: [{ id: "p1", kind: "openai-compatible", label: "p", enabled: true, baseUrl: "https://x.invalid/v1" }],
    });
    const store = new CheckpointStore({ dir: tmp });
    const { sink } = makeSink();
    const agent = new Agent(registry, store, sink, {
      isMain: true,
      systemPrompt: "test",
      enabledTools: new Set(),
      mode: "code",
      modeRegistry: new ModeRegistry(),
      toolContext: {} as any,
    });
    const calls = [
      { id: "a", name: "handoff", args: {} },
      { id: "b", name: "subagent.spawn", args: {} },
    ];
    const internal = agent as unknown as { partitionToolCalls: (t: typeof calls) => typeof calls[] };
    const phases = internal.partitionToolCalls(calls);
    expect(phases.length).toBe(1);
    expect(phases[0].length).toBe(2);
  });
});
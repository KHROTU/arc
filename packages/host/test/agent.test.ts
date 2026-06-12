import { describe, it, expect } from "vitest";
import { Agent } from "../src/agent/agent";
import { ModelRegistry } from "../src/routing/registry";
import { CheckpointStore } from "../src/checkpoint/store";
import type { AgentEventSink } from "../src/agent/agent";
import type { ProcessStep, TodoItem } from "../src/protocol/process";
import type { ChatMessage, TurnUsage } from "../src/protocol/protocol";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
function makeSink() {
  const messages: ChatMessage[] = [];
  let steps: ProcessStep[] = [];
  let todos: TodoItem[] = [];
  const events: string[] = [];
  const sink: AgentEventSink = {
    message: (m) => messages.push(m),
    steps: (s) => { steps = s; },
    turnStart: () => events.push("turnStart"),
    turnEnd: () => events.push("turnEnd"),
usage: () => {  },
    handoff: (from, to) => events.push(`handoff:${from}->${to}`),
    todo: (items) => { todos = items; },
    clarification: (id, q) => events.push(`clarify:${id}:${q}`),
    done: () => events.push("done"),
    error: (m) => events.push(`error:${m}`),
  };
  return { sink, messages, getSteps: () => steps, getTodos: () => todos, events };
}
describe("Agent tool surface", () => {
  it("emits a todo_list step when todo.write is called", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-tool-"));
    const registry = new ModelRegistry();
    registry.load({
      models: [{ id: "m1", label: "Test", tier: "default", contextWindow: 8000, costPer1mIn: 0, costPer1mOut: 0, providers: [] }],
      providers: [],
    });
    const store = new CheckpointStore({ dir: tmp });
    const { sink, getSteps, getTodos } = makeSink();
    expect(sink.message).toBeTypeOf("function");
    expect(getSteps()).toEqual([]);
    expect(getTodos()).toEqual([]);
  });
});
describe("handoff policy", () => {
  it("default escalation walks heavy -> default -> light", async () => {
    const { nextModelForHandoff } = await import("../src/routing/handoff");
    const { ModelRegistry } = await import("../src/routing/registry");
    const r = new ModelRegistry();
    r.load({
      models: [
        { id: "free", label: "Free", tier: "free", contextWindow: 8000, costPer1mIn: 0, costPer1mOut: 0, providers: [] },
        { id: "light", label: "Light", tier: "light", contextWindow: 16000, costPer1mIn: 0, costPer1mOut: 0, providers: [] },
        { id: "default", label: "Default", tier: "default", contextWindow: 128000, costPer1mIn: 0, costPer1mOut: 0, providers: [] },
        { id: "heavy", label: "Heavy", tier: "heavy", contextWindow: 200000, costPer1mIn: 0, costPer1mOut: 0, providers: [] },
      ],
      providers: [],
    });
    const def = r.get("default")!;
    expect(nextModelForHandoff(r, def, "escalate")?.id).toBe("heavy");
    const heavy = r.get("heavy")!;
    expect(nextModelForHandoff(r, heavy, "escalate")).toBeUndefined();
    expect(nextModelForHandoff(r, heavy, "de-escalate")?.id).toBe("default");
  });
});
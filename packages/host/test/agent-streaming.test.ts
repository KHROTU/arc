import { describe, it, expect } from "vitest";
import { Agent, type AgentEventSink } from "../src/agent/agent";
import { ModelRegistry } from "../src/routing/registry";
import { CheckpointStore } from "../src/checkpoint/store";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
function makeSink() {
  const stepSnapshots: { output: string; pending: boolean | undefined }[] = [];
  let lastSteps: any[] = [];
  const sink: AgentEventSink & { stepSnapshots: typeof stepSnapshots } = {
    message: () => {},
    steps: (s) => {
      lastSteps = s.map((x) => ({ ...x }));
      stepSnapshots.push({ output: lastSteps[lastSteps.length - 1]?.output ?? "", pending: lastSteps[lastSteps.length - 1]?.pending });
    },
    turnStart: () => {},
    turnEnd: () => {},
    usage: () => {},
    handoff: () => {},
    todo: () => {},
    clarification: () => {},
    done: () => {},
    error: () => {},
    stepSnapshots,
  };
  return { sink, stepSnapshots, getSteps: () => lastSteps };
}
describe("Agent streaming tool output", () => {
  it("flushes chunked output to the step", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-stream-"));
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
      enabledTools: new Set(["shell.run"]),
      toolContext: {} as any,
    });
    const tc = { id: "call-1", name: "shell.run", args: { command: "node -e \"console.log('chunk-1'); console.log('chunk-2');\"" } };
    (agent as any).steps.push({ id: tc.id, type: "tool", title: "test", ts: Date.now(), output: "" });
    const internal = agent as unknown as { makeChunkHandler: (t: typeof tc) => (s: "stdout" | "stderr", t: string) => void };
    const handler = internal.makeChunkHandler(tc);
    handler("stdout", "partial-1");
    handler("stdout", "-partial-2");
    await new Promise((r) => setTimeout(r, 120));
    const steps = sink.stepSnapshots;
    const last = steps[steps.length - 1];
    expect(last.output).toContain("partial-1-partial-2");
  });
  it("throttles chunk flushes to 80ms", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-stream-"));
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
      toolContext: {} as any,
    });
    const tc = { id: "call-2", name: "shell.run", args: { command: "" } };
    (agent as any).steps.push({ id: tc.id, type: "tool", title: "test", ts: Date.now(), output: "" });
    const internal = agent as unknown as { makeChunkHandler: (t: typeof tc) => (s: "stdout" | "stderr", t: string) => void };
    const handler = internal.makeChunkHandler(tc);
    handler("stdout", "a");
    handler("stdout", "b");
    handler("stdout", "c");
    await new Promise((r) => setTimeout(r, 120));
    const steps = sink.stepSnapshots;
    const last = steps[steps.length - 1];
    expect(last.output).toBe("abc");
  });
});
describe("shell.run streams stdout", () => {
  it("emits chunks for streaming commands", async () => {
    const { tools } = await import("../src/agent/tools");
    const chunks: string[] = [];
    const result = await tools["shell.run"].fn(
      { command: "node -e \"console.log('a'); console.log('b'); console.log('c');\"" },
      {
        root: process.cwd(),
        workspacePath: process.cwd(),
        shell: { policy: "always", allowlist: [] },
        onChunk: (_s, t) => chunks.push(t),
      } as any,
    );
    expect(result.ok).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toContain("a");
  });
});
import { describe, it, expect } from "vitest";
import { Agent, type AgentEventSink } from "../src/agent/agent";
import { ModelRegistry } from "../src/routing/registry";
import { CheckpointStore } from "../src/checkpoint/store";
import { ModeRegistry } from "../src/modes/index";
import type { ChatMessage } from "../src/protocol/protocol";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
function makeSink(): AgentEventSink {
  return {
    message: () => {},
    steps: () => {},
    turnStart: () => {},
    turnEnd: () => {},
    usage: () => {},
    handoff: () => {},
    todo: () => {},
    clarification: () => {},
    done: () => {},
    error: () => {},
  };
}
async function makeAgent(overrides: Record<string, unknown> = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-agent-resume-"));
  const registry = new ModelRegistry();
  registry.load({
    models: [{ id: "m1", label: "Test", tier: "default", contextWindow: 8000, costPer1mIn: 0, costPer1mOut: 0, providers: [] }],
    providers: [],
  });
  const store = new CheckpointStore({ dir: tmp });
  return new Agent(registry, store, makeSink(), {
    isMain: true,
    systemPrompt: "You are a test assistant.",
    enabledTools: new Set([]),
    mode: "code",
    modeRegistry: new ModeRegistry(),
    workspaceRoot: tmp,
    toolContext: { problems: async () => [], problemsFor: async () => [], summaryForFiles: async () => ({ hasErrors: false, hasWarnings: false, text: "" }) },
    ...overrides,
  } as any);
}
describe("Agent full resume snapshot/restore", () => {
  it("snapshot() includes background processes when getBackgroundProcesses is set", async () => {
    const agent = await makeAgent({
      getBackgroundProcesses: () => [{ id: "1", command: "npm run dev" }],
    });
    const snap = agent.snapshot();
    expect(snap.backgroundProcesses).toEqual([{ command: "npm run dev" }]);
  });
  it("snapshot() omits backgroundProcesses when there are none running", async () => {
    const agent = await makeAgent({ getBackgroundProcesses: () => [] });
    const snap = agent.snapshot();
    expect(snap.backgroundProcesses).toBeUndefined();
  });
  it("snapshotWithBrowser() includes non-blank browser tabs", async () => {
    const agent = await makeAgent({
      getBrowserTabs: async () => [
        { id: "a", url: "https://example.com", active: true },
        { id: "b", url: "about:blank", active: false },
      ],
    });
    const snap = await agent.snapshotWithBrowser();
    expect(snap.browserTabs).toEqual([{ url: "https://example.com" }]);
  });
  it("snapshotWithBrowser() degrades gracefully when getBrowserTabs throws", async () => {
    const agent = await makeAgent({
      getBrowserTabs: async () => { throw new Error("browser not available"); },
    });
    const snap = await agent.snapshotWithBrowser();
    expect(snap.browserTabs).toBeUndefined();
  });
  it("restore() injects a system note about lost background processes and restores browser tabs", async () => {
    const restoredTabs: { url: string }[] = [];
    const agent = await makeAgent({
      restoreBrowserTabs: async (tabs: { url: string }[]) => { restoredTabs.push(...tabs); },
    });
    await agent.restore({
      messages: [{ id: "u1", role: "user", content: "hello", ts: Date.now() } as ChatMessage],
      steps: [],
      mode: "code",
      todoItems: [],
      backgroundProcesses: [{ command: "npm run watch" }],
      browserTabs: [{ url: "https://example.com" }],
    });
    const messages = agent.getMessages();
    const note = messages.find((m) => m.role === "system" && m.content.includes("npm run watch"));
    expect(note).toBeDefined();
    expect(note?.content).toContain("were NOT resumed");
    expect(restoredTabs).toEqual([{ url: "https://example.com" }]);
  });
  it("restore() is a no-op for background/browser state when none was saved", async () => {
    const agent = await makeAgent();
    await agent.restore({ messages: [], steps: [], mode: "code", todoItems: [] });
    expect(agent.getMessages()).toEqual([]);
  });
});

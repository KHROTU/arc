import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "../src/agent/agent";
import { ModelRegistry } from "../src/routing/registry";
import { CheckpointStore } from "../src/checkpoint/store";
import { ModeRegistry } from "../src/modes/index";
import type { AgentEventSink } from "../src/agent/agent";
import type { ProcessStep, TodoItem } from "../src/protocol/process";
import type { ChatMessage } from "../src/protocol/protocol";
function makeSink() {
  const messages: ChatMessage[] = [];
  let steps: ProcessStep[] = [];
  let todos: TodoItem[] = [];
  const sink: AgentEventSink = {
    message: (m) => messages.push(m),
    steps: (s) => { steps = s; },
    turnStart: () => {},
    turnEnd: () => {},
    usage: () => {},
    handoff: () => {},
    todo: (items) => { todos = items; },
    clarification: () => {},
    guidance: () => {},
    done: () => {},
    error: () => {},
    compaction: () => {},
  };
  return { sink, messages, getSteps: () => steps, getTodos: () => todos };
}
let tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
  tmpDirs = [];
});
async function makeAgent(initialMessages: ChatMessage[], archived: ChatMessage[], workspaceRoot: string) {
  const registry = new ModelRegistry();
  registry.load({
    models: [{ id: "m1", label: "Test", tier: "default", contextWindow: 8000, costPer1mIn: 0, costPer1mOut: 0, providers: [] }],
    providers: [],
  });
  const store = new CheckpointStore({ dir: path.join(workspaceRoot, ".ckpt") });
  const { sink } = makeSink();
  const agent = new Agent(registry, store, sink, {
    systemPrompt: "base prompt",
    enabledTools: new Set(),
    workspaceRoot,
    mode: "code",
    modeRegistry: new ModeRegistry(),
    isMain: true,
    toolContext: {},
    initialMessages,
    initialArchivedMessages: archived,
  });
  return { agent, store };
}
describe("Agent.revertToMessage across a compaction boundary", () => {
  it("restores pre-compaction context when the target lives in the archived region", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-revert-"));
    tmpDirs.push(tmp);
    const f = path.join(tmp, "f.txt");
    await fs.writeFile(f, "pre-edit");
    const summary = { id: "sum1", role: "system", content: "## Compaction summary of 2 earlier messages\n\nold stuff", ts: 10 } as ChatMessage;
    const postU = { id: "post-u", role: "user", content: "new question", ts: 20 } as ChatMessage;
    const postA = { id: "post-a", role: "assistant", content: "answer", ts: 21 } as ChatMessage;
    const archU = { id: "arch-u", role: "user", content: "original request", ts: 5 } as ChatMessage;
    const archA = { id: "arch-a", role: "assistant", content: "early answer", ts: 6 } as ChatMessage;
    const { agent, store } = await makeAgent([summary, postU, postA], [archU, archA], tmp);
    await new Promise((r2) => setTimeout(r2, 5));
    await store.snapshot("u1", tmp, ["f.txt"]);
    await fs.writeFile(f, "edited");
    const r = await agent.revertToMessage("arch-u", true);
    expect(r.reverted).toBe(true);
    const msgs = agent.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
    expect(agent.getArchivedMessages()).toHaveLength(0);
    expect(r.messagesRemoved).toBe(5);
    expect(await fs.readFile(f, "utf-8")).toBe("pre-edit");
    expect(r.filesRestored).toContain("f.txt");
  });
  it("still works for current-region targets and folds the archive back into live context in chronological order", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-revert2-"));
    tmpDirs.push(tmp);
    const postU = { id: "post-u", role: "user", content: "keep me", ts: 9 } as ChatMessage;
    const cut = { id: "cut-me", role: "user", content: "revert to me", ts: 30 } as ChatMessage;
    const tail = { id: "tail", role: "assistant", content: "later", ts: 40 } as ChatMessage;
    const archOld = { id: "old-u", role: "user", content: "deep history", ts: 2 } as ChatMessage;
    const { agent } = await makeAgent([postU, cut, tail], [archOld], tmp);
    const r = await agent.revertToMessage("cut-me", false);
    expect(r.reverted).toBe(true);
    const msgs = agent.getMessages();
    expect(msgs.map((m) => m.role === "system" ? "SYS" : m.id)).toEqual(["SYS", "old-u", "post-u"]);
    expect(r.messagesRemoved).toBe(2);
    expect(agent.getArchivedMessages()).toHaveLength(0);
  });
  it("matches by content when the id no longer exists after compaction", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-revert3-"));
    tmpDirs.push(tmp);
    const summary = { id: "sum1", role: "system", content: "## Compaction summary of 4 earlier messages\n\nstuff", ts: 50 } as ChatMessage;
    const archivedUser = { id: "gone-id", role: "user", content: "please fix the wobbly widget alignment", ts: 3 } as ChatMessage;
    const { agent } = await makeAgent([summary], [archivedUser], tmp);
    const r = await agent.revertToMessage("not-found-anymore", false, "please fix the wobbly widget alignment");
    expect(r.reverted).toBe(true);
    expect(agent.getMessages()).toHaveLength(1);
    expect(agent.getArchivedMessages()).toHaveLength(0);
    expect(r.messagesRemoved).toBe(2);
  });
});
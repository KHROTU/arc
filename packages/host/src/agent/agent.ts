import { randomUUID } from "node:crypto";
import { ModelRegistry } from "../routing/registry.js";
import { pickProvider, recordSuccess, estimateCost } from "../routing/router.js";
import { transportFor } from "../providers/transport.js";
import { CheckpointStore } from "../checkpoint/store.js";
import { compact, decideCompaction, CompactionTracker } from "../compaction/compaction.js";
import { defaultPolicy, nextModelForHandoff, type HandoffRecord } from "../routing/handoff.js";
import { tools as builtinTools, type ToolContext } from "./tools.js";
import { buildToolSpecs } from "./tool-specs.js";
import { SubagentRunner } from "./subagent.js";
import type { ChatMessage, ToolCall, TurnUsage } from "../protocol/protocol.js";
import type { ProcessStep, TodoItem } from "../protocol/process.js";
const PSEUDO_TOOLS = new Set(["handoff", "subagent.spawn", "subagent.askParent", "clarification.askUser"]);
export interface AgentEventSink {
  message(m: ChatMessage): void;
  assistantDelta?(id: string, text: string): void;
  steps(steps: ProcessStep[]): void;
  turnStart(turnId: string): void;
  turnEnd(turnId: string, ok: boolean, error?: string): void;
  usage(usage: TurnUsage, perModel: Record<string, TurnUsage>): void;
  handoff(fromModel: string, toModel: string, reason: string): void;
  todo(items: TodoItem[]): void;
  clarification(id: string, question: string, options: string[]): void;
  done(): void;
  error(message: string): void;
  compaction(before: number, after: number, reason: string): void;
}
export interface AgentOptions {
  systemPrompt: string;
  enabledTools: Set<string>;
  workspaceRoot: string;
  askUser?: (question: string, options: string[]) => Promise<string>;
  approveShell?: (description: string) => Promise<boolean>;
  toolContext: Omit<ToolContext, "shell" | "requestApproval" | "root" | "workspacePath">;
  isMain: boolean;
  ownerTier?: import("../protocol/protocol.js").ModelTier;
  parent?: Agent;
}
export class Agent {
  private messages: ChatMessage[] = [];
  private steps: ProcessStep[] = [];
  private usageByModel: Record<string, TurnUsage> = {};
  private tracker = new CompactionTracker();
  private handoffs: HandoffRecord[] = [];
  private todoItems: TodoItem[] = [];
  private abortController?: AbortController;
  private active = false;
  private subagentRunner: SubagentRunner;
  private pendingClarifications = new Map<string, { resolve: (answer: string) => void; question: string; options: string[] }>();
  constructor(
    private registry: ModelRegistry,
    private store: CheckpointStore,
    private sink: AgentEventSink,
    private opts: AgentOptions,
  ) {
    this.subagentRunner = new SubagentRunner(registry, store);
    if (opts.systemPrompt) {
      this.messages.push({ id: randomUUID(), role: "system", content: opts.systemPrompt, ts: Date.now() });
    }
  }
  getMessages() { return this.messages.slice(); }
  getSteps() { return this.steps.slice(); }
  getTodo() { return this.todoItems.slice(); }
  getUsage() { return this.usageByModel; }
  getHandoffs() { return this.handoffs.slice(); }
  async send(text: string, attachments?: { uri: string; preview?: string }[]): Promise<void> {
    if (this.active) throw new Error("Agent is already running");
    let content = text;
    if (attachments && attachments.length) {
      const lines = attachments.map((a) => `- ${a.preview ?? a.uri}`);
      content = `${text}\n\nAttached context:\n${lines.join("\n")}`;
    }
    const userMsg: ChatMessage = { id: randomUUID(), role: "user", content, ts: Date.now() };
    this.messages.push(userMsg);
    this.sink.message(userMsg);
    await this.runTurn();
  }
  async continue(): Promise<void> {
    if (this.active) return;
    await this.runTurn();
  }
  async stop() {
    this.abortController?.abort();
    for (const [id, p] of this.pendingClarifications) {
      p.resolve("");
      this.pendingClarifications.delete(id);
    }
  }
  async retract(turnId: string): Promise<{ restored: string[]; conflicts: string[] }> {
    const r = await this.store.restore(this.opts.workspaceRoot, turnId);
    this.steps = this.steps.filter((s) => !s.id.startsWith(`turn-${turnId}-`));
    this.sink.steps(this.steps);
    const snap = await this.store.load(this.opts.workspaceRoot, turnId);
    if (snap && snap.todoItems) {
      this.todoItems = snap.todoItems;
      this.sink.todo(this.todoItems);
    } else if (this.todoItems.length) {
      this.todoItems = this.todoItems.filter((t) => !t.id.startsWith("sub-"));
      this.sink.todo(this.todoItems);
    }
    return r;
  }
  answerClarification(id: string, answer: string): boolean {
    const p = this.pendingClarifications.get(id);
    if (!p) return false;
    p.resolve(answer);
    this.pendingClarifications.delete(id);
    return true;
  }
  private async runTurn() {
    this.active = true;
    const turnId = randomUUID();
    this.sink.turnStart(turnId);
    this.abortController = new AbortController();
    try {
      const current = this.registry.getCurrent();
      if (current) {
        const dec = decideCompaction(this.messages, current, this.tracker);
        if (dec.shouldCompact) {
          const before = this.messages.length;
          this.messages = compact(this.messages, undefined, (msgs) => summarizeInProcess(msgs));
          this.sink.compaction(before, this.messages.length, dec.reason);
        }
      }
      let model = this.registry.getCurrent();
      if (!model) {
        const msg: ChatMessage = { id: randomUUID(), role: "assistant", content: "No model configured. Open Arc settings → Models to add one.", ts: Date.now() };
        this.messages.push(msg);
        this.sink.message(msg);
        this.sink.turnEnd(turnId, false, "no-model");
        this.active = false;
        return;
      }
      const decision = pickProvider(this.registry, model);
      if (!decision) {
        const msg: ChatMessage = { id: randomUUID(), role: "assistant", content: `No enabled provider for model ${model.label}. Add one in Arc settings.`, ts: Date.now() };
        this.messages.push(msg);
        this.sink.message(msg);
        this.sink.turnEnd(turnId, false, "no-provider");
        this.active = false;
        return;
      }
      const transport = transportFor(decision.provider);
      let text = "";
      let thinking = "";
      const toolCalls: ToolCall[] = [];
      const assistantId = randomUUID();
      const turnTs = Date.now();
      let firstTextTs = 0;
      let thoughtStart = 0;
      const toolSpecs = buildToolSpecs(this.opts.enabledTools ?? []);
      const stream = await transport.stream({
        model,
        provider: decision.provider,
        messages: this.messages,
        tools: toolSpecs.length ? toolSpecs : undefined,
        signal: this.abortController.signal,
      });
      for await (const ev of stream.events) {
        if (this.abortController.signal.aborted) break;
        switch (ev.type) {
          case "text": {
            if (!firstTextTs) firstTextTs = Date.now();
            if (thoughtStart) this.finalizeThought(assistantId, thoughtStart);
            text += ev.delta;
            this.sink.assistantDelta?.(assistantId, text);
            break;
          }
          case "thinking": {
            if (!thoughtStart) thoughtStart = Date.now();
            thinking += ev.delta;
            this.emitLiveAssistant(assistantId, thinking, thoughtStart);
            break;
          }
          case "tool_call": {
            if (thoughtStart) this.finalizeThought(assistantId, thoughtStart);
            const tc: ToolCall = { id: ev.id, name: ev.name, args: ev.args };
            toolCalls.push(tc);
            if (ev.name !== "todo.write") {
              this.openStep({
                id: ev.id,
                type: "tool",
                title: prettyToolTitle(ev.name, ev.args),
                content: "",
                command: ev.name === "shell.run" ? String(ev.args.command ?? "") : undefined,
              });
            }
            break;
          }
          case "tool_call_delta": {
            break;
          }
          case "usage": {
            this.tracker.observe(model.id, ev.usage);
            this.usageByModel[model.id] = addUsage(this.usageByModel[model.id], ev.usage);
            this.usageByModel[model.id].cost = estimateCost(model, this.usageByModel[model.id]);
            this.sink.usage(this.usageByModel[model.id], this.usageByModel);
            recordSuccess(model.id, decision.provider.id);
            break;
          }
          case "error": {
            this.sink.error(ev.message);
            break;
          }
          case "done": {
            break;
          }
        }
      }
      if (thoughtStart) this.finalizeThought(assistantId, thoughtStart);
      const finalAssistant: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: text,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        ts: firstTextTs || turnTs,
        meta: { modelId: model.id, providerId: decision.provider.id, tier: model.tier },
      };
      this.messages.push(finalAssistant);
      this.sink.message(finalAssistant);
      if (toolCalls.length) {
        for (const tc of toolCalls) {
          if (this.abortController.signal.aborted) break;
          await this.executeToolCall(tc, turnId);
        }
        if (!this.abortController.signal.aborted) {
          await this.runTurn();
        } else {
          this.sink.turnEnd(turnId, true);
          this.sink.done();
        }
      } else {
        if (this.opts.isMain) {
          const m = /<arc-handoff\s+reason="([^"]*)"\s*\/>/.exec(text);
          if (m && this.handoffs.filter((h) => h.direction === "escalate").length < defaultPolicy.maxEscalations) {
            const target = nextModelForHandoff(this.registry, model, "escalate", defaultPolicy);
            if (target) {
              this.handoffs.push({ turnId, direction: "escalate", fromModelId: model.id, toModelId: target.id, reason: m[1] ?? "(no reason)", ts: Date.now(), costIncurred: this.usageByModel[model.id]?.cost ?? 0 });
              this.sink.handoff(model.label, target.label, m[1] ?? "");
              this.registry.setCurrent(target.id);
              if (this.todoItems.length) {
                const planMsg = `Current plan (preserved across handoff to ${target.label}):\n` + this.todoItems.map((t) => `- [${t.state}] ${t.text}`).join("\n");
                this.messages.push({ id: randomUUID(), role: "system", content: planMsg, ts: Date.now() });
              }
              await this.runTurn();
              const back = nextModelForHandoff(this.registry, target, "de-escalate", defaultPolicy);
              if (back) {
                this.handoffs.push({ turnId, direction: "de-escalate", fromModelId: target.id, toModelId: back.id, reason: "returning control", ts: Date.now(), costIncurred: 0 });
                this.sink.handoff(target.label, back.label, "returning control");
                this.registry.setCurrent(back.id);
                if (this.todoItems.length) {
                  const planMsg = `Returning control to ${back.label}. Current plan:\n` + this.todoItems.map((t) => `- [${t.state}] ${t.text}`).join("\n");
                  this.messages.push({ id: randomUUID(), role: "system", content: planMsg, ts: Date.now() });
                }
              }
              this.active = false;
              return;
            }
          }
        }
        this.sink.turnEnd(turnId, true);
        this.sink.done();
      }
    } catch (e) {
      this.sink.turnEnd(turnId, false, (e as Error).message);
      this.sink.error((e as Error).message);
    } finally {
      this.active = false;
    }
  }
  private async executeToolCall(tc: ToolCall, turnId: string) {
    const def = builtinTools[tc.name];
    const isPseudo = PSEUDO_TOOLS.has(tc.name);
    if (!def && !isPseudo) {
      const out = { ok: false, output: `Unknown tool: ${tc.name}` };
      this.appendToolOutput(tc.id, out.output, out.ok);
      this.messages.push({ id: randomUUID(), role: "tool", content: out.output, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    if (tc.name === "handoff") {
      const reason = String(tc.args.reason ?? "model requested handoff");
      const direction = (tc.args.direction === "de-escalate" ? "de-escalate" : "escalate") as "escalate" | "de-escalate";
      const current = this.registry.getCurrent();
      let output: string;
      let ok = true;
      if (!current) {
        output = "No current model to hand off from.";
        ok = false;
      } else {
        const target = nextModelForHandoff(this.registry, current, direction, defaultPolicy);
        if (target) {
          this.handoffs.push({ turnId, direction, fromModelId: current.id, toModelId: target.id, reason, ts: Date.now(), costIncurred: 0 });
          this.sink.handoff(current.label, target.label, reason);
          this.registry.setCurrent(target.id);
          output = `Handed off to ${target.label} (${direction}). You are now the active model — continue the task.`;
        } else {
          output = `No model available in the target tier for ${direction}. Staying on ${current.label}; continue without handing off.`;
          ok = false;
        }
      }
      this.appendToolOutput(tc.id, output, ok);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    if (tc.name === "subagent.spawn") {
      if (!this.opts.isMain) {
        this.appendToolOutput(tc.id, "Subagents cannot spawn further subagents.", false);
        return;
      }
      const spec: import("./subagent.js").SubagentSpec = {
        name: String(tc.args.name ?? "subagent"),
        instructions: String(tc.args.instructions ?? ""),
        tier: (tc.args.tier as import("../protocol/protocol.js").ModelTier | undefined) ?? undefined,
        modelId: tc.args.modelId ? String(tc.args.modelId) : undefined,
      };
      const parent = this.registry.getCurrent();
      if (!parent) {
        this.appendToolOutput(tc.id, "No current model to spawn from.", false);
        return;
      }
      const result = await this.subagentRunner.run(spec, parent, {
        ...this.opts.toolContext,
        root: this.opts.workspaceRoot,
      });
      this.appendToolOutput(tc.id, result.ok ? result.output : `Subagent failed: ${result.output}`, result.ok);
      this.messages.push({
        id: randomUUID(),
        role: "tool",
        content: result.ok ? result.output : `Subagent failed: ${result.output}`,
        toolCallId: tc.id,
        ts: Date.now(),
      });
      if (result.steps.length) {
        const sub = { id: `sub-${tc.id}`, type: "subagent" as const, title: spec.name, children: result.steps, ts: Date.now() };
        this.steps.push(sub);
        this.sink.steps(this.steps);
      }
      if (result.todo.length) {
        const idPrefix = `sub-${tc.id}-`;
        const rolled: TodoItem[] = result.todo.map((t) => ({ id: idPrefix + t.id, text: `[${spec.name}] ${t.text}`, state: t.state }));
        this.todoItems = [...this.todoItems, ...rolled];
        const stepId = `todo-${turnId}-${randomUUID().slice(0, 6)}`;
        this.steps.push({ id: stepId, type: "todo_list", title: "Plan", todos: this.todoItems, ts: Date.now() });
        this.sink.steps(this.steps);
        this.sink.todo(this.todoItems);
      }
      return;
    }
    if (tc.name === "subagent.askParent") {
      if (this.opts.isMain) {
        this.appendToolOutput(tc.id, "The main agent cannot ask its parent (it has no parent).", false);
        return;
      }
      if (!this.opts.parent) {
        this.appendToolOutput(tc.id, "No parent agent available.", false);
        return;
      }
      const question = String(tc.args.question ?? "");
      const options = Array.isArray(tc.args.options) ? (tc.args.options as string[]) : [];
      const clId = `cl-${randomUUID()}`;
      this.openStep({ id: clId, type: "clarification", title: "Asking parent", content: question, options });
      const answer = await this.opts.parent.askFromSubagent(question, options);
      this.appendToolOutput(tc.id, answer || "(parent gave no answer)", true);
      this.messages.push({
        id: randomUUID(),
        role: "tool",
        content: answer || "(parent gave no answer)",
        toolCallId: tc.id,
        ts: Date.now(),
      });
      return;
    }
    if (tc.name === "clarification.askUser") {
      if (!this.opts.isMain) {
        this.appendToolOutput(tc.id, "Subagents must use subagent.askParent, not askUser.", false);
        return;
      }
      const question = String(tc.args.question ?? "");
      const options = Array.isArray(tc.args.options) ? (tc.args.options as string[]) : [];
      const answer = await this.askUserInteractive(question, options);
      this.appendToolOutput(tc.id, answer || "(no answer)", true);
      this.messages.push({
        id: randomUUID(),
        role: "tool",
        content: answer || "(no answer)",
        toolCallId: tc.id,
        ts: Date.now(),
      });
      return;
    }
    if (!def) return;
    const target = (tc.args.path as string) ?? (tc.args.file as string);
    if (target && this.opts.enabledTools.has(tc.name)) {
      try {
        await this.store.snapshot(turnId, this.opts.workspaceRoot, [target], this.todoItems);
} catch {  }
    }
    const ctx: ToolContext = {
      ...this.opts.toolContext,
      root: this.opts.workspaceRoot,
      workspacePath: this.opts.workspaceRoot,
      shell: { policy: "allowlist", allowlist: [] },
      requestApproval: this.opts.approveShell,
    };
    let result;
    try {
      result = await def.fn(tc.args, ctx);
    } catch (e) {
      result = { ok: false, output: `Tool error: ${(e as Error).message}` };
    }
    this.appendToolOutput(tc.id, result.output, result.ok, result.ok ? undefined : prettyToolTitle(tc.name, tc.args, false));
    if (result.todoState) {
      this.todoItems = result.todoState.items.map((it) => ({ ...it }));
      const stepId = `todo-${turnId}-${randomUUID().slice(0, 6)}`;
      this.steps.push({ id: stepId, type: "todo_list", title: "Plan", todos: this.todoItems, ts: Date.now() });
      this.sink.steps(this.steps);
      this.sink.todo(this.todoItems);
    }
    this.messages.push({ id: randomUUID(), role: "tool", content: result.output, toolCallId: tc.id, ts: Date.now() });
    if (result.touchedFiles && result.touchedFiles.length && this.opts.toolContext.summaryForFiles) {
      const summary = await this.opts.toolContext.summaryForFiles(result.touchedFiles);
      if (summary.text) {
        const fbId = `lsp-fb-${randomUUID()}`;
        this.openStep({ id: fbId, type: "tool", title: "Checked diagnostics", output: summary.text });
        this.messages.push({
          id: randomUUID(),
          role: "tool",
          content: summary.text,
          toolCallId: tc.id,
          ts: Date.now(),
        });
      }
    }
  }
  private askFromSubagent(question: string, options: string[]): Promise<string> {
    return this.askUserInteractive(question, options);
  }
  private askUserInteractive(question: string, options: string[]): Promise<string> {
    return new Promise((resolve) => {
      const id = `cl-${randomUUID()}`;
      this.pendingClarifications.set(id, { resolve, question, options });
      this.sink.clarification(id, question, options);
      setTimeout(() => {
        if (this.pendingClarifications.has(id)) {
          this.pendingClarifications.delete(id);
          resolve("");
        }
      }, 5 * 60_000);
    });
  }
  private openStep(step: ProcessStep) {
    this.steps.push({ ...step, ts: step.ts ?? Date.now() });
    this.sink.steps(this.steps);
  }
  private appendToolOutput(id: string, output: string, ok: boolean, title?: string) {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].id === id) {
        this.steps[i] = { ...this.steps[i], output, type: ok ? this.steps[i].type : "error", ...(title ? { title } : {}) };
        this.sink.steps(this.steps);
        return;
      }
    }
  }
  private emitLiveAssistant(id: string, thinking: string, startTs: number) {
    if (!thinking) return;
    const stepId = `thought-${id}`;
    const existing = this.steps.find((s) => s.id === stepId);
    if (existing) {
      existing.content = thinking;
      existing.durationMs = Date.now() - startTs;
      existing.pending = true;
    } else {
      this.steps.push({ id: stepId, type: "thought", title: "Thinking", content: thinking, ts: startTs, durationMs: 0, pending: true });
    }
    this.sink.steps(this.steps);
  }
  private finalizeThought(id: string, startTs: number) {
    const step = this.steps.find((s) => s.id === `thought-${id}`);
    if (step && step.pending) {
      step.pending = false;
      step.durationMs = Date.now() - startTs;
      this.sink.steps(this.steps);
    }
  }
}
function addUsage(a: TurnUsage | undefined, b: TurnUsage): TurnUsage {
  return {
    prompt: (a?.prompt ?? 0) + b.prompt,
    completion: (a?.completion ?? 0) + b.completion,
    thinking: (a?.thinking ?? 0) + b.thinking,
    cost: (a?.cost ?? 0) + b.cost,
  };
}
function prettyToolTitle(name: string, args: Record<string, unknown>, ok = true): string {
  const path = String(args.path ?? args.file ?? "");
  const clip = (s: string, n = 64) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  if (!ok) {
    switch (name) {
      case "file.read": return `Failed to read ${path}`;
      case "file.edit": return `Failed to edit ${path}`;
      case "file.write": return `Failed to write ${path}`;
      case "shell.run": return `Command failed: ${clip(String(args.command ?? ""))}`;
      case "lsp.problems": return "Failed to check problems";
      case "lsp.problemsFor": return `Failed to check ${path}`;
      case "todo.write": return "Failed to update plan";
      case "browser.navigate": return `Failed to navigate to ${clip(String(args.url ?? ""))}`;
      case "browser.click": return `Failed to click ${clip(String(args.selector ?? ""))}`;
      case "browser.type": return `Failed to type into ${clip(String(args.selector ?? ""))}`;
      case "browser.screenshot": return "Failed to take screenshot";
      case "browser.evaluate": return "Failed to evaluate script";
      case "browser.readDom": return "Failed to read page DOM";
      case "mcp.call": return `Failed MCP ${args.server ?? ""}/${args.tool ?? ""}`;
      case "subagent.spawn": return `Subagent ${args.name ?? ""} failed`;
      case "handoff": return `Handoff failed`;
      default: return `Failed: ${name}`;
    }
  }
  switch (name) {
    case "file.read": return `Read ${path}`;
    case "file.edit": return `Edited ${path}`;
    case "file.write": return `Wrote ${path}`;
    case "shell.run": return `Ran ${clip(String(args.command ?? ""))}`;
    case "lsp.problems": return "Checked workspace problems";
    case "lsp.problemsFor": return `Checked problems in ${path}`;
    case "todo.write": return "Updated plan";
    case "browser.navigate": return `Navigated to ${clip(String(args.url ?? ""))}`;
    case "browser.click": return `Clicked ${clip(String(args.selector ?? ""))}`;
    case "browser.type": return `Typed into ${clip(String(args.selector ?? ""))}`;
    case "browser.screenshot": return "Took screenshot";
    case "browser.evaluate": return "Evaluated script";
    case "browser.readDom": return "Read page DOM";
    case "browser.close": return "Closed browser";
    case "mcp.call": return `Called ${args.server ?? ""}/${args.tool ?? ""}`;
    case "subagent.spawn": return `Spawned subagent ${args.name ?? ""}`;
    case "subagent.askParent": return `Asked parent: ${clip(String(args.question ?? ""), 80)}`;
    case "handoff": return `Handed off (${args.direction ?? "escalate"})`;
    case "clarification.askUser": return `Asked: ${clip(String(args.question ?? ""), 80)}`;
    default: return name;
  }
}
function summarizeInProcess(msgs: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of msgs) {
    if (m.role === "tool") lines.push(`- [tool ${m.toolCallId ?? ""}]: ${m.content.slice(0, 80)}`);
    else if (m.role === "assistant") lines.push(`- [assistant]: ${m.content.slice(0, 120)}`);
    else if (m.role === "user") lines.push(`- [user]: ${m.content.slice(0, 120)}`);
  }
  return lines.join("\n");
}
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getWorkspaceArcDir } from "../arc-dir.js";
import { ModelRegistry } from "../routing/registry.js";
import { pickProvider, recordSuccess, estimateCost } from "../routing/router.js";
import { transportFor } from "../providers/transport.js";
import { CheckpointStore } from "../checkpoint/store.js";
import { compactAsync, decideCompaction, CompactionTracker } from "../compaction/compaction.js";
import { defaultPolicy, nextModelForHandoff, type HandoffRecord } from "../routing/handoff.js";
import { tools as builtinTools, type ToolContext, killActiveProcesses } from "./tools.js";
import { buildToolSpecs, isMcpToolSpec, parseMcpToolSpec } from "./tool-specs.js";
import { SubagentRunner } from "./subagent.js";
import type { ChatMessage, ModelDescriptor, ToolCall, TurnUsage } from "../protocol/protocol.js";
import type { ProcessStep, TodoItem } from "../protocol/process.js";
const PSEUDO_TOOLS = new Set(["handoff", "subagent.spawn", "subagent.askParent", "clarification.askUser", "checkpoint.revert", "checkpoint.list"]);
const TOOL_OUTPUT_MAX_CHARS = 8000;
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
  guidance(text: string): void;
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
  initialMessages?: ChatMessage[];
}
export class Agent {
  private messages: ChatMessage[] = [];
  private steps: ProcessStep[] = [];
  private usageByModel: Record<string, TurnUsage> = {};
  private tracker = new CompactionTracker();
  private lastPromptTokens = 0;
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
    if (opts.initialMessages?.length) {
      this.messages.push(...opts.initialMessages);
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
    if (shouldPlanFirst(content)) {
      const planMsg: ChatMessage = {
        id: randomUUID(),
        role: "system",
        content: "The user's request appears complex (spans multiple files/features). Before making ANY changes, you MUST:\n1. Create a detailed todo list via `todo.write` breaking the work into sequential, verifiable steps.\n2. Ask the user for sign-off via `clarification.askUser` with the question \"Review the plan above. Ready to proceed?\" and options [\"Proceed\", \"Revise plan\"].\n3. Only start executing after the user selects \"Proceed\".\nDo NOT call file.edit, file.write, or shell.run until the user approves the plan.",
        ts: Date.now(),
      };
      this.messages.push(planMsg);
      this.sink.message(planMsg);
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
    const killed = killActiveProcesses();
    for (const [id, p] of this.pendingClarifications) {
      p.resolve("");
      this.pendingClarifications.delete(id);
    }
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].pending && (this.steps[i].type === "tool")) {
        this.steps[i] = { ...this.steps[i], pending: false, interrupted: true };
      }
    }
    if (killed.count > 0) {
      this.sink.steps(this.steps);
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
  async guidance(text: string) {
    if (!this.active) return;
    this.abortController?.abort();
    const killed = killActiveProcesses();
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].pending && (this.steps[i].type === "tool")) {
        this.steps[i] = { ...this.steps[i], pending: false, interrupted: true };
      }
    }
    if (killed.count > 0) {
      this.sink.steps(this.steps);
    }
    const stepId = `guidance-${randomUUID().slice(0, 6)}`;
    this.steps.push({
      id: stepId,
      type: "tool",
      title: `User guidance: ${text.slice(0, 80)}`,
      content: text,
      ts: Date.now(),
    });
    this.sink.steps(this.steps);
    const contextMsg = `The user has added this context while observing your work:\n\n${text}\n\nContinue with this guidance in mind. Do NOT re-acknowledge or repeat the guidance — just incorporate it into your ongoing work.`;
    this.messages.push({ id: randomUUID(), role: "user", content: contextMsg, ts: Date.now() });
    this.sink.guidance(text);
    this.active = false;
    await this.runTurn();
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
      const toolSpecs = buildToolSpecs(this.opts.enabledTools ?? [], this.opts.toolContext.mcp?.listTools());
      if (current) {
        const dec = decideCompaction(this.messages, current, this.tracker, undefined, this.lastPromptTokens, toolSpecs);
        if (dec.shouldCompact) {
          const before = this.messages.length;
          this.messages = await compactAsync(this.messages, (msgs) => this.summarizeForCompaction(msgs, current));
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
                toolName: ev.name,
                content: "",
                command: (ev.name === "shell.run" || ev.name === "shell.backgroundRun") ? String(ev.args.command ?? "") : undefined,
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
            if (typeof ev.usage.prompt === "number" && ev.usage.prompt > 0) {
              this.lastPromptTokens = Math.max(this.lastPromptTokens, ev.usage.prompt);
            }
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
        thinking: thinking || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        ts: firstTextTs || turnTs,
        meta: { modelId: model.id, providerId: decision.provider.id, tier: model.tier },
      };
      this.messages.push(finalAssistant);
      this.sink.message(finalAssistant);
      if (toolCalls.length) {
        const tcs = this.abortController.signal.aborted ? [] : this.partitionToolCalls(toolCalls);
        for (const phase of tcs) {
          if (this.abortController.signal.aborted) break;
          await this.executePhase(phase, turnId);
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
      if (!this.abortController?.signal.aborted) {
        this.sink.turnEnd(turnId, false, (e as Error).message);
        this.sink.error((e as Error).message);
      }
    } finally {
      this.active = false;
    }
  }
  private partitionToolCalls(toolCalls: ToolCall[]): ToolCall[][] {
    const phases: ToolCall[][] = [];
    const parallelSafe = (n: string): boolean =>
      n !== "handoff" && n !== "subagent.spawn";
    let current: ToolCall[] = [];
    for (const tc of toolCalls) {
      if (current.length === 0) {
        current.push(tc);
        continue;
      }
      const curSafe = parallelSafe(current[0].name);
      const newSafe = parallelSafe(tc.name);
      if (curSafe === newSafe) {
        current.push(tc);
      } else {
        phases.push(current);
        current = [tc];
      }
    }
    if (current.length) phases.push(current);
    return phases;
  }
  private async executePhase(phase: ToolCall[], turnId: string): Promise<void> {
    if (phase.length === 1) {
      await this.executeToolCall(phase[0], turnId);
      return;
    }
    const settled = await Promise.allSettled(phase.map((tc) => this.executeToolCall(tc, turnId)));
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status === "rejected") {
        const tc = phase[i];
        const msg = `Tool error (parallel): ${(r.reason as Error)?.message ?? r.reason}`;
        this.appendToolOutput(tc.id, msg, false);
        this.messages.push({ id: randomUUID(), role: "tool", content: msg, toolCallId: tc.id, ts: Date.now() });
      }
    }
  }
  private async executeToolCall(tc: ToolCall, turnId: string) {
    if (isMcpToolSpec(tc.name)) {
      const parsed = parseMcpToolSpec(tc.name);
      if (!parsed) {
        const out = { ok: false, output: `Bad MCP tool spec: ${tc.name}` };
        this.appendToolOutput(tc.id, out.output, out.ok);
        this.messages.push({ id: randomUUID(), role: "tool", content: out.output, toolCallId: tc.id, ts: Date.now() });
        return;
      }
      const mcp = this.opts.toolContext.mcp;
      if (!mcp) {
        const out = { ok: false, output: "MCP not available." };
        this.appendToolOutput(tc.id, out.output, out.ok);
        this.messages.push({ id: randomUUID(), role: "tool", content: out.output, toolCallId: tc.id, ts: Date.now() });
        return;
      }
      const result = await mcp.call(parsed.server, parsed.tool, tc.args);
      const raw = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
      const output = await this.truncateToolOutput(raw, tc.name);
      this.appendToolOutput(tc.id, output, result.ok);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      return;
    }
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
      const parent = this.registry.getCurrent();
      if (!parent) {
        this.appendToolOutput(tc.id, "No current model to spawn from.", false);
        return;
      }
      const batch = Array.isArray(tc.args.batch) ? (tc.args.batch as any[]) : null;
      if (batch && batch.length) {
        const specs: import("./subagent.js").SubagentSpec[] = batch.map((b: any) => ({
          name: String(b.name ?? "subagent"),
          instructions: String(b.instructions ?? ""),
          tier: (b.tier as import("../protocol/protocol.js").ModelTier | undefined) ?? undefined,
          modelId: b.modelId ? String(b.modelId) : undefined,
          rules: b.rules as import("./subagent.js").SubagentRules | undefined,
        }));
        const results = await this.subagentRunner.runBatch(specs, parent, {
          ...this.opts.toolContext,
          root: this.opts.workspaceRoot,
          shell: { policy: "allowlist" as const, allowlist: [] },
          requestApproval: this.opts.approveShell,
        }, (question: string, options: string[]) => this.askFromSubagent(question, options, parent));
        const outputs = results.map((r, i) =>
          r.ok ? `[${specs[i].name}] ${r.output}` : `[${specs[i].name}] FAILED: ${r.output}`,
        );
        const combinedOutput = outputs.join("\n\n");
        this.appendToolOutput(tc.id, combinedOutput, results.every((r) => r.ok));
        this.messages.push({
          id: randomUUID(),
          role: "tool",
          content: combinedOutput,
          toolCallId: tc.id,
          ts: Date.now(),
        });
        const allChildren: ProcessStep[] = [];
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const spec = specs[i];
          if (result.steps.length) {
            allChildren.push({ id: `sub-${tc.id}-${i}`, type: "subagent", title: spec.name, children: result.steps, ts: Date.now() });
          }
          if (result.todo.length) {
            const idPrefix = `sub-${tc.id}-${i}-`;
            const rolled: TodoItem[] = result.todo.map((t) => ({ id: idPrefix + t.id, text: `[${spec.name}] ${t.text}`, state: t.state }));
            this.todoItems = [...this.todoItems, ...rolled];
          }
        }
        if (allChildren.length) {
          this.appendStepChildren(tc.id, allChildren);
        }
        if (this.todoItems.length) {
          const stepId = `todo-${turnId}-${randomUUID().slice(0, 6)}`;
          this.steps.push({ id: stepId, type: "todo_list", title: "Plan", todos: this.todoItems, ts: Date.now() });
          this.sink.steps(this.steps);
          this.sink.todo(this.todoItems);
        }
        return;
      }
      const spec: import("./subagent.js").SubagentSpec = {
        name: String(tc.args.name ?? "subagent"),
        instructions: String(tc.args.instructions ?? ""),
        tier: (tc.args.tier as import("../protocol/protocol.js").ModelTier | undefined) ?? undefined,
        modelId: tc.args.modelId ? String(tc.args.modelId) : undefined,
        rules: tc.args.rules as import("./subagent.js").SubagentRules | undefined,
      };
      const result = await this.subagentRunner.run(spec, parent, {
        ...this.opts.toolContext,
        root: this.opts.workspaceRoot,
        shell: { policy: "allowlist" as const, allowlist: [] },
        requestApproval: this.opts.approveShell,
      }, (question: string, options: string[]) => this.askFromSubagent(question, options, parent), (steps) => {
        this.appendStepChildren(tc.id, steps);
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
        this.appendStepChildren(tc.id, result.steps);
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
        this.messages.push({ id: randomUUID(), role: "tool", content: "The main agent cannot ask its parent (it has no parent).", toolCallId: tc.id, ts: Date.now() });
        return;
      }
      if (!this.opts.parent) {
        this.appendToolOutput(tc.id, "No parent agent available.", false);
        this.messages.push({ id: randomUUID(), role: "tool", content: "No parent agent available.", toolCallId: tc.id, ts: Date.now() });
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
    if (tc.name === "checkpoint.revert") {
      const targetId = tc.args.turnId ? String(tc.args.turnId) : "";
      const rawIdx = tc.args.index !== undefined ? Number(tc.args.index) : undefined;
      let resolvedId: string | undefined = targetId || undefined;
      if (!resolvedId && rawIdx !== undefined) {
        const turns = await this.store.listTurns(this.opts.workspaceRoot);
        const idx = rawIdx - 1;
        if (idx >= 0 && idx < turns.length) resolvedId = turns[idx];
      }
      if (!resolvedId) {
        this.appendToolOutput(tc.id, "checkpoint.revert requires a valid index (1=most recent) or turnId. Use checkpoint.list to see available turns.", false);
        this.messages.push({ id: randomUUID(), role: "tool", content: "checkpoint.revert requires a valid index or turnId.", toolCallId: tc.id, ts: Date.now() });
        return;
      }
      const snap = await this.store.load(this.opts.workspaceRoot, resolvedId);
      if (!snap) {
        this.appendToolOutput(tc.id, `No checkpoint snapshot found for '${resolvedId}'.`, false);
        this.messages.push({ id: randomUUID(), role: "tool", content: `No checkpoint snapshot found for '${resolvedId}'.`, toolCallId: tc.id, ts: Date.now() });
        return;
      }
      const { restored, conflicts } = await this.retract(resolvedId);
      const conflictNote = conflicts.length ? ` (note: ${conflicts.length} file(s) had uncommitted changes since snapshot: ${conflicts.map((f) => `\`${f}\``).join(", ")})` : "";
      const output = `Reverted to checkpoint ${resolvedId}. Restored ${restored.length} file(s).${conflictNote}`;
      this.appendToolOutput(tc.id, output, true);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    if (tc.name === "checkpoint.list") {
      const turns = await this.store.listTurns(this.opts.workspaceRoot);
      if (turns.length === 0) {
        this.appendToolOutput(tc.id, "No checkpoints available.", true);
        this.messages.push({ id: randomUUID(), role: "tool", content: "No checkpoints available.", toolCallId: tc.id, ts: Date.now() });
        return;
      }
      const lines: string[] = [];
      for (let i = 0; i < turns.length; i++) {
        const snap = await this.store.load(this.opts.workspaceRoot, turns[i]);
        if (snap) {
          const files = Object.keys(snap.files).join(", ") || "(none)";
          lines.push(`${i + 1}. turnId=${turns[i]}  ts=${new Date(snap.ts).toISOString()}  files=${files}`);
        }
      }
      const output = lines.join("\n");
      this.appendToolOutput(tc.id, output, true);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
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
      requestApproval: this.opts.approveShell ?? (this.opts.toolContext as any).requestApproval,
      onChunk: this.makeChunkHandler(tc),
    };
    let result;
    try {
      result = await def.fn(tc.args, ctx);
    } catch (e) {
      result = { ok: false, output: `Tool error: ${(e as Error).message}` };
    }
    const truncatedOutput = await this.truncateToolOutput(result.output, tc.name);
    const isEditOrWrite = tc.name === "file.edit" || tc.name === "file.write";
    this.appendToolOutput(tc.id, isEditOrWrite ? "" : truncatedOutput, result.ok, result.ok ? undefined : prettyToolTitle(tc.name, tc.args, false), result.diffHunks, result.filePath, result.runAfter?.command, result.runAfter?.output);
    if (result.todoState) {
      this.todoItems = result.todoState.items.map((it) => ({ ...it }));
      const stepId = `todo-${turnId}-${randomUUID().slice(0, 6)}`;
      this.steps.push({ id: stepId, type: "todo_list", title: "Plan", todos: this.todoItems, ts: Date.now() });
      this.sink.steps(this.steps);
      this.sink.todo(this.todoItems);
    }
    const toolContent = result.runAfter
      ? `${truncatedOutput}\n[runAfter] ${result.runAfter.command}\n${result.runAfter.output}`
      : truncatedOutput;
    this.messages.push({ id: randomUUID(), role: "tool", content: toolContent, toolCallId: tc.id, ts: Date.now() });
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
  askFromSubagent(question: string, options: string[], parentModel?: import("../protocol/protocol.js").ModelDescriptor): Promise<string> {
    return this.askModel(question, options, parentModel);
  }
  private async askModel(question: string, options: string[], parentModel?: import("../protocol/protocol.js").ModelDescriptor): Promise<string> {
    const model = parentModel ?? this.registry.getCurrent();
    if (!model) return options[options.length - 1] ?? "";
    const decision = pickProvider(this.registry, model);
    if (!decision) return options[options.length - 1] ?? "";
    const transport = transportFor(decision.provider);
    try {
      const optsStr = options.map((o, i) => `${i + 1}. ${o}`).join("\n");
      const prompt: ChatMessage[] = [
        { id: randomUUID(), role: "system", content: `You are an agentic coding assistant. A subagent you delegated work to is asking for your approval. Answer with ONLY a single digit (1 or 2) corresponding to the option. Do not explain.`, ts: Date.now() },
        { id: randomUUID(), role: "user", content: `${question}\n\nOptions:\n${optsStr}`, ts: Date.now() },
      ];
      const stream = await transport.stream({
        model,
        provider: decision.provider,
        messages: prompt,
        signal: AbortSignal.timeout(10_000),
      });
      let text = "";
      for await (const ev of stream.events) {
        if (ev.type === "text") text += ev.delta;
        if (ev.type === "done") break;
        if (ev.type === "error") break;
      }
      const answer = text.trim();
      const digitMatch = answer.match(/^[12]/);
      if (digitMatch) {
        const idx = parseInt(digitMatch[0]) - 1;
        if (idx >= 0 && idx < options.length) return options[idx];
      }
      const lower = answer.toLowerCase();
      if (lower.includes(options[options.length - 1].toLowerCase())) return options[options.length - 1];
      if (lower.includes(options[0].toLowerCase())) return options[0];
      return options[options.length - 1];
    } catch {
      return options[options.length - 1] ?? "";
    }
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
  private async summarizeForCompaction(msgs: ChatMessage[], fallback: ModelDescriptor): Promise<string> {
    try {
      const provider = pickProvider(this.registry, fallback);
      if (!provider) return summarizeInProcess(msgs);
      const transport = transportFor(provider.provider);
      const transcript = renderForSummary(msgs);
      const prompt: ChatMessage[] = [
        {
          id: randomUUID(),
          role: "system",
          content: "You are a context compressor for an agentic coding assistant. Summarize the prior conversation so the assistant can continue the task. Preserve:\n- Concrete decisions made and the reasoning.\n- File paths touched and what changed (read/edit/write, with brief description).\n- Error messages and their resolutions.\n- Outstanding TODOs or unfinished work.\n- Key user preferences or constraints mentioned.\n\nUse terse bullet points. Skip pleasantries. Do not invent facts.",
          ts: Date.now(),
        },
        {
          id: randomUUID(),
          role: "user",
          content: transcript,
          ts: Date.now(),
        },
      ];
      const stream = await transport.stream({
        model: fallback,
        provider: provider.provider,
        messages: prompt,
        signal: AbortSignal.timeout(20_000),
      });
      let text = "";
      for await (const ev of stream.events) {
        if (ev.type === "text") text += ev.delta;
        if (ev.type === "done" || ev.type === "error") break;
      }
      const cleaned = text.trim();
      if (!cleaned) return summarizeInProcess(msgs);
      return cleaned.length > 4000 ? cleaned.slice(0, 4000) + "\n…(truncated)" : cleaned;
    } catch {
      return summarizeInProcess(msgs);
    }
  }
  private openStep(step: ProcessStep) {
    this.steps.push({ ...step, ts: step.ts ?? Date.now() });
    this.sink.steps(this.steps);
  }
  private makeChunkHandler(tc: ToolCall): (stream: "stdout" | "stderr", text: string) => void {
    let buffer = "";
    let lastFlush = 0;
    let pendingFlush: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      pendingFlush = undefined;
      if (!buffer) return;
      const snapshot = buffer;
      buffer = "";
      lastFlush = Date.now();
      for (let i = this.steps.length - 1; i >= 0; i--) {
        if (this.steps[i].id === tc.id) {
          const step = this.steps[i];
          const next = (step.output ?? "") + snapshot;
          this.steps[i] = { ...step, output: next.length > 8000 ? next.slice(-8000) : next, pending: true };
          this.sink.steps(this.steps);
          return;
        }
      }
    };
    return (_stream, text) => {
      buffer += text;
      const now = Date.now();
      if (now - lastFlush >= 80) {
        flush();
      } else if (!pendingFlush) {
        pendingFlush = setTimeout(flush, 80);
      }
    };
  }
  private appendToolOutput(id: string, output: string, ok: boolean, title?: string, diffHunks?: import("../protocol/process.js").DiffHunk[], filePath?: string, runAfterCommand?: string, runAfterOutput?: string) {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].id === id) {
        this.steps[i] = {
          ...this.steps[i],
          output,
          pending: false,
          type: ok ? this.steps[i].type : "error",
          ...(title ? { title } : {}),
          ...(diffHunks ? { diffHunks } : {}),
          ...(filePath !== undefined ? { filePath } : {}),
          ...(runAfterCommand ? { runAfterCommand } : {}),
          ...(runAfterOutput ? { runAfterOutput } : {}),
        };
        this.sink.steps(this.steps);
        return;
      }
    }
  }
  private appendStepChildren(id: string, children: ProcessStep[]) {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].id === id) {
        this.steps[i] = { ...this.steps[i], children };
        this.sink.steps(this.steps);
        return;
      }
    }
  }
  private async truncateToolOutput(output: string, toolName: string): Promise<string> {
    if (output.length <= TOOL_OUTPUT_MAX_CHARS) return output;
    const dir = path.join(getWorkspaceArcDir(this.opts.workspaceRoot), "tool_outputs");
    await fs.mkdir(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = toolName.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filePath = path.join(dir, `${name}_${ts}.txt`);
    await fs.writeFile(filePath, output, "utf-8");
    const truncated = output.slice(0, TOOL_OUTPUT_MAX_CHARS);
    return `${truncated}\n\n...(output truncated from ${output.length} to ${TOOL_OUTPUT_MAX_CHARS} chars, full output saved to ${filePath})`;
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
  const rangeInfo = (): string => {
    const o = args.offset ? Number(args.offset) : undefined;
    const l = args.limit ? Number(args.limit) : undefined;
    if (!o && !l) return "";
    if (o && l) return ` [L${o}-L${o + l - 1}]`;
    if (o) return ` [L${o}+]`;
    return ` [${l} lines]`;
  };
  if (!ok) {
    switch (name) {
      case "file.read": return `Failed to read ${path}${rangeInfo()}`;
      case "file.edit": return `Failed to edit ${path}`;
      case "file.write": return `Failed to write ${path}`;
      case "file.grep": return `Grep failed: ${clip(String(args.pattern ?? ""))}`;
      case "file.glob": return `Glob failed: ${clip(String(args.pattern ?? ""))}`;
      case "shell.run": return `Command failed: ${clip(String(args.command ?? ""))}`;
      case "shell.backgroundRun": return `Background command failed: ${clip(String(args.command ?? ""))}`;
      case "shell.check": return `Failed to check process ${args.id ?? ""}`;
      case "shell.write": return `Failed to write to process ${args.id ?? ""}`;
      case "shell.customRun": return `Failed to create custom run ${String(args.name ?? "")}`;
      case "shell.editCustomRun": return `Failed to edit custom run ${String(args.id ?? "")}`;
      case "shell.runCustomRun": return `Custom run ${String(args.id ?? "").slice(0, 12)} failed`;
      case "lsp.problems": return "Failed to check problems";
      case "lsp.problemsFor": return `Failed to check ${path}`;
      case "todo.write": return "Failed to update plan";
      case "browser.navigate": return `Failed to navigate to ${clip(String(args.url ?? ""))}`;
      case "browser.click": return `Failed to click ${clip(String(args.selector ?? ""))}`;
      case "browser.type": return `Failed to type into ${clip(String(args.selector ?? ""))}`;
      case "browser.screenshot": return "Failed to take screenshot";
      case "browser.evaluate": return "Failed to evaluate script";
      case "browser.readDom": return "Failed to read page DOM";
      case "browser.close": return "Failed to close browser";
      case "mcp.call": return `Failed MCP ${args.server ?? ""}/${args.tool ?? ""}`;
      case "mcp.create": return `Failed to register MCP server ${args.name ?? ""}`;
      case "mcp.remove": return `Failed to remove MCP server ${args.name ?? ""}`;
      case "mcp.toggle": return `Failed to toggle MCP server ${args.name ?? ""}`;
      case "mcp.resources/list": return `Failed to list MCP resources on ${args.server ?? ""}`;
      case "mcp.resources/read": return `Failed to read MCP resource ${args.uri ?? ""}`;
      case "mcp.prompts/list": return `Failed to list MCP prompts on ${args.server ?? ""}`;
      case "mcp.prompts/get": return `Failed to get MCP prompt ${args.name ?? ""}`;
      case "subagent.spawn": return `Subagent ${args.name ?? ""} failed`;
      case "handoff": return `Handoff failed`;
      case "checkpoint.revert": return `Failed to revert to ${String(args.turnId ?? args.index ?? "")}`;
      case "checkpoint.list": return "Failed to list checkpoints";
      case "file.semanticSearch": return `Semantic search failed: ${clip(String(args.query ?? ""))}`;
      case "webfetch": return `Failed to fetch ${clip(String(args.url ?? ""))}`;
      default: return `Failed: ${name}`;
    }
  }
  switch (name) {
    case "file.read": return `Read ${path}${rangeInfo()}`;
    case "file.edit": return `Edited ${path}`;
    case "file.write": return `Wrote ${path}`;
    case "file.grep": return `Grepped /${clip(String(args.pattern ?? ""))}/`;
    case "file.glob": return `Globbed ${clip(String(args.pattern ?? ""))}`;
    case "shell.run": return `Ran ${clip(String(args.command ?? ""))}`;
    case "shell.backgroundRun": return `Started ${clip(String(args.command ?? ""))}`;
    case "shell.check": return `Checked process ${args.id ?? ""}`;
    case "shell.write": return `Wrote to process ${args.id ?? ""}`;
    case "shell.customRun": return `Created custom run ${clip(String(args.name ?? ""), 40)}`;
    case "shell.editCustomRun": return `Edited custom run ${String(args.id ?? "").slice(0, 12)}`;
    case "shell.runCustomRun": return `Ran custom run ${String(args.id ?? "").slice(0, 12)}`;
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
    case "mcp.create": return `Registered MCP server ${args.name ?? ""}`;
    case "mcp.remove": return `Removed MCP server ${args.name ?? ""}`;
    case "mcp.toggle": return `Toggled MCP server ${args.name ?? ""}`;
    case "mcp.resources/list": return `Listed MCP resources on ${args.server ?? ""}`;
    case "mcp.resources/read": return `Read MCP resource ${args.uri ?? ""}`;
    case "mcp.prompts/list": return `Listed MCP prompts on ${args.server ?? ""}`;
    case "mcp.prompts/get": return `Fetched MCP prompt ${args.name ?? ""}`;
    case "subagent.spawn": return `Spawned subagent ${args.name ?? ""}`;
    case "checkpoint.revert": return `Reverted to turn ${String(args.turnId ?? args.index ?? "").slice(0, 12)}`;
    case "checkpoint.list": return "Listed checkpoints";
    case "subagent.askParent": return `Asked parent: ${clip(String(args.question ?? ""), 80)}`;
    case "handoff": return `Handed off (${args.direction ?? "escalate"})`;
    case "clarification.askUser": return `Asked: ${clip(String(args.question ?? ""), 80)}`;
    case "file.semanticSearch": return `Searched: ${clip(String(args.query ?? ""), 80)}`;
    case "webfetch": return `Fetched ${clip(String(args.url ?? ""))}`;
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
function shouldPlanFirst(text: string): boolean {
  if (text.length < 120) return false;
  const lower = text.toLowerCase();
  let score = 0;
  const featureWords = ["feature", "refactor", "component", "page", "screen", "module", "build a", "create a", "implement", "migrate"];
  for (const w of featureWords) {
    if (lower.includes(w)) { score += 2; break; }
  }
  const scopeWords = ["across", "multiple", "several", "all", "entire", "every"];
  for (const w of scopeWords) {
    if (lower.includes(w)) score++;
  }
  const fileMentions = text.match(/\.(tsx?|jsx?|css|html|json|md)/g);
  if (fileMentions && fileMentions.length >= 2) score += 2;
  const pathMentions = text.match(/src\//g);
  if (pathMentions && pathMentions.length >= 2) score += 2;
  const bulletCount = (text.match(/^[*-]\s/gm) || []).length;
  if (bulletCount >= 3) score += 2;
  return score >= 3;
}
function renderForSummary(msgs: ChatMessage[]): string {
  const out: string[] = [];
  for (const m of msgs) {
    if (m.role === "system") {
      if (m.content.startsWith("## Compaction summary")) continue;
      out.push(`[system] ${m.content.slice(0, 300)}`);
    } else if (m.role === "user") {
      out.push(`[user] ${m.content}`);
    } else if (m.role === "assistant") {
      const tc = m.toolCalls?.length ? ` tools=${m.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.args).slice(0, 80)})`).join("; ")}` : "";
      out.push(`[assistant] ${m.content.slice(0, 300)}${tc}`);
    } else if (m.role === "tool") {
      out.push(`[tool:${m.toolCallId ?? ""}] ${m.content.slice(0, 300)}`);
    }
  }
  return out.join("\n");
}
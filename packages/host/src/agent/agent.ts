import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getWorkspaceArcDir } from "../arc-dir.js";
import { ModelRegistry } from "../routing/registry.js";
import { pickProvider, routeStream, recordSuccess, estimateCost } from "../routing/router.js";
import { transportFor, sanitizeToolChains } from "../providers/transport.js";
export { sanitizeToolChains } from "../providers/transport.js";
import { CheckpointStore } from "../checkpoint/store.js";
import { compactAsync, decideCompaction, CompactionTracker } from "../compaction/compaction.js";
import { defaultPolicy, nextModelForHandoff, type HandoffRecord } from "../routing/handoff.js";
import { generateDependencyGraph, formatDepGraph } from "../util/dep-graph.js";
import { tools as builtinTools, type ToolContext, killActiveProcesses, checkWriteGlob } from "./tools.js";
import { buildToolSpecs, isMcpToolSpec, parseMcpToolSpec } from "./tool-specs.js";
import { SubagentRunner } from "./subagent.js";
import { runHooks } from "../hooks/hooks.js";
import { loadVerifyConfig, runVerification, type VerifyConfig } from "../verify/verify.js";
import { appendAuditEntry } from "../audit/audit.js";
import { diffLines } from "../edit/line-diff.js";
import { tryExtractDiffBlock } from "../edit/apply.js";
import { classifyWorkspacePath } from "../security/path-policy.js";
import type { ModeRegistry } from "../modes/index.js";
import { type ApprovalsConfig, type SessionApprovals, type ApproveShellMeta, DEFAULT_APPROVALS, initSession, resolveApproval } from "../approvals/index.js";
import type { ChatMessage, ModelDescriptor, ToolCall, TurnUsage, ExecutionEvent } from "../protocol/protocol.js";
import type { ProcessStep, TodoItem } from "../protocol/process.js";
const PSEUDO_TOOLS = new Set(["handoff", "subagent.spawn", "subagent.askParent", "clarification.askUser", "checkpoint.revert", "checkpoint.list", "checkpoint.compare", "mode.switch", "skill.use", "memory.add", "memory.note", "session.exportTrace"]);
const TOOL_OUTPUT_MAX_CHARS = 8000;
export interface AgentEventSink {
  message(m: ChatMessage): void;
  assistantDelta?(id: string, text: string): void;
  steps(steps: ProcessStep[]): void;
  stepUpdate?(step: ProcessStep): void;
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
  timeline?(events: import("../protocol/protocol.js").ExecutionEvent[]): void;
}
export interface AgentOptions {
  systemPrompt: string;
  enabledTools: Set<string>;
  workspaceRoot: string;
  mode: string;
  modeRegistry: ModeRegistry;
  userRequestedMode?: string;
  approvalsConfig?: ApprovalsConfig;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  askUser?: (question: string, options: string[]) => Promise<string>;
  approveShell?: (description: string, meta?: ApproveShellMeta) => Promise<boolean>;
  toolContext: Omit<ToolContext, "shell" | "root" | "workspacePath" | "approvalsConfig" | "sessionApprovals" | "addSessionCommand" | "onChunk" | "skillRegistry">;
  isMain: boolean;
  ownerTier?: import("../protocol/protocol.js").ModelTier;
  parent?: Agent;
  initialMessages?: ChatMessage[];
  initialSteps?: ProcessStep[];
  initialSessionApprovals?: SessionApprovals;
  modelOverride?: ModelDescriptor;
  proxyUrl?: string;
  proxyProvider?: string;
  proxyWeb?: string;
  proxyShell?: string;
  fileContextTracker?: import("../context/tracker.js").FileContextTracker;
  verifyMode?: "none" | "default" | "custom";
  verifyMaxRetries?: number;
  condensingPrompt?: string;
  getBrowserTabs?: () => Promise<{ id: string; url: string; active: boolean }[]>;
  getBackgroundProcesses?: () => { id: string; command: string }[];
  restoreBrowserTabs?: (tabs: { url: string }[]) => Promise<void>;
  autoSessionNotes?: boolean;
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
  private currentMode: string;
  private userRequestedMode: string | undefined;
  private sessionApprovals: SessionApprovals;
  private sessionStarted = false;
  private turnCount = 0;
  private lastTodoUpdate = 0;
  private pendingChain: { toolName: string; args: Record<string, unknown>; resultText: string; displayTitle: string } | null = null;
  private mcpReverse: Map<string, { server: string; tool: string }> = new Map();
  private toolMeta = new Map<string, { name: string; args: Record<string, unknown> }>();
  private toolAcc = new Map<string, { name: string; argsJson: string }>();
  private toolAccPrevContent = new Map<string, string>();
  private timeline: ExecutionEvent[] = [];
  private readonly TIMELINE_MAX = 2000;
  private verifyAttempts = 0;
  private consecutiveMistakes = 0;
  private consecutiveStreamErrors = 0;
  private lastToolSig = "";
  private sessionToolCounts = new Map<string, number>();
  private readonly maxSessionCaps: Record<string, number> = (() => {
    const num = (name: string, def: number): number => {
      const v = Number(process.env[name]);
      return Number.isFinite(v) && v >= 0 ? v : def;
    };
    return {
      "web.search": num("ARC_MAX_WEB_SEARCHES_PER_SESSION", Number.POSITIVE_INFINITY),
      "subagent.spawn": num("ARC_MAX_SUBAGENTS_PER_SESSION", Number.POSITIVE_INFINITY),
      "mcp.call": num("ARC_MAX_MCP_CALLS_PER_SESSION", Number.POSITIVE_INFINITY),
    };
  })();
  private verifyConfigPromise?: Promise<VerifyConfig | undefined>;
  private getVerifyConfig(): Promise<VerifyConfig | undefined> {
    if (!this.verifyConfigPromise) this.verifyConfigPromise = loadVerifyConfig(this.opts.workspaceRoot);
    return this.verifyConfigPromise;
  }
  private pushTimeline(ev: ExecutionEvent): void {
    this.timeline.push(ev);
    if (this.timeline.length > this.TIMELINE_MAX) {
      this.timeline = this.timeline.slice(-this.TIMELINE_MAX);
    }
    if (!process.env.VITEST) void appendAuditEntry(this.opts.workspaceRoot, ev.type, redactAuditData(ev)).catch((error) => this.sink.error(`Audit log failure: ${(error as Error).message}`));
  }
  getTimeline(): ExecutionEvent[] { return this.timeline.slice(); }
  private async persistPlan(): Promise<void> {
    try {
      const arcDir = getWorkspaceArcDir(this.opts.workspaceRoot);
      await fs.mkdir(arcDir, { recursive: true });
      await fs.writeFile(
        path.join(arcDir, "plan-current.json"),
        JSON.stringify({ todoItems: this.todoItems, updatedAt: new Date().toISOString() }, null, 2),
        "utf-8",
      );
    } catch (e) {
      console.warn(`[arc] plan persistence failed: ${(e as Error)?.message ?? e}`);
    }
  }
  constructor(
    private registry: ModelRegistry,
    private store: CheckpointStore,
    private sink: AgentEventSink,
    private opts: AgentOptions,
  ) {
    this.subagentRunner = new SubagentRunner(registry, store, opts.modeRegistry);
    this.currentMode = opts.modeRegistry.resolveDefault(opts.mode);
    this.userRequestedMode = opts.userRequestedMode;
    this.sessionApprovals = opts.initialSessionApprovals
      ? {
          autoApproveAll: opts.initialSessionApprovals.autoApproveAll,
          sessionCommandAllowlist: [...(opts.initialSessionApprovals.sessionCommandAllowlist ?? [])],
          commandPrefixMemory: [...(opts.initialSessionApprovals.commandPrefixMemory ?? [])],
          ...(opts.initialSessionApprovals.taskOverride ? { taskOverride: opts.initialSessionApprovals.taskOverride } : {}),
        }
      : initSession();
    const modeDef = opts.modeRegistry.get(this.currentMode);
    this.applyModeModelOverride(modeDef);
    const modeRole = modeDef?.roleDefinition ?? "";
    const fullPrompt = modeRole ? `${modeRole}\n\n---\n\n${opts.systemPrompt}` : opts.systemPrompt;
    if (fullPrompt) {
      this.messages.push({ id: randomUUID(), role: "system", content: fullPrompt, ts: Date.now() });
    }
    if (opts.initialMessages?.length) {
      this.messages.push(...opts.initialMessages);
    }
    if (opts.initialSteps?.length) {
      this.steps = [...opts.initialSteps];
    }
  }
  private getCurrentModel(): ModelDescriptor | undefined {
    return this.opts.modelOverride ?? this.registry.getCurrent();
  }
  getModel(): ModelDescriptor | undefined {
    return this.getCurrentModel();
  }
  setModelOverride(model: ModelDescriptor | undefined): void {
    this.opts.modelOverride = model;
  }
  getModelOverride(): ModelDescriptor | undefined {
    return this.opts.modelOverride;
  }
  private resolveProviderProxy(): string | undefined {
    return this.opts.proxyProvider || this.opts.proxyUrl;
  }
  private applyModeModelOverride(modeDef: import("../modes/index.js").Mode | undefined): void {
    if (!modeDef?.model) return;
    const found = this.registry.list().find((m) => m.id === modeDef.model);
    if (found) this.opts.modelOverride = found;
  }
  getCurrentMode(): string { return this.currentMode; }
  getModeRegistry(): ModeRegistry { return this.opts.modeRegistry; }
  getMessages() { return this.messages.slice(); }
  getSteps() { return this.steps.slice(); }
  getTodo() { return this.todoItems.slice(); }
  getUsage() { return this.usageByModel; }
  getHandoffs() { return this.handoffs.slice(); }
  injectSystemNote(text: string): void {
    if (!text) return;
    const m: ChatMessage = { id: randomUUID(), role: "system", content: text, ts: Date.now() };
    this.messages.push(m);
    this.sink.message(m);
  }
  snapshot(): { messages: ChatMessage[]; steps: ProcessStep[]; mode: string; todoItems: TodoItem[]; browserTabs?: { url: string }[]; backgroundProcesses?: { command: string }[] } {
    const backgroundProcesses = this.opts.getBackgroundProcesses?.().map((p) => ({ command: p.command }));
    return {
      messages: this.messages.slice(),
      steps: this.steps.slice(),
      mode: this.currentMode,
      todoItems: this.todoItems.slice(),
      ...(backgroundProcesses?.length ? { backgroundProcesses } : {}),
    };
  }
  async snapshotWithBrowser(): Promise<{ messages: ChatMessage[]; steps: ProcessStep[]; mode: string; todoItems: TodoItem[]; browserTabs?: { url: string }[]; backgroundProcesses?: { command: string }[] }> {
    const base = this.snapshot();
    if (!this.opts.getBrowserTabs) return base;
    try {
      const tabs = await this.opts.getBrowserTabs();
      const browserTabs = tabs.filter((t) => t.url && t.url !== "about:blank").map((t) => ({ url: t.url }));
      return browserTabs.length ? { ...base, browserTabs } : base;
    } catch {
      return base;
    }
  }
  async restore(snapshot: { messages: ChatMessage[]; steps?: ProcessStep[]; mode?: string; todoItems?: TodoItem[]; browserTabs?: { url: string }[]; backgroundProcesses?: { command: string }[] }): Promise<void> {
    this.messages = snapshot.messages;
    this.steps = snapshot.steps ?? [];
    this.currentMode = snapshot.mode ?? "code";
    this.todoItems = snapshot.todoItems ?? [];
    this.sessionStarted = true;
    if (snapshot.backgroundProcesses?.length) {
      const list = snapshot.backgroundProcesses.map((p) => `- ${p.command}`).join("\n");
      const note = `The following background process(es) were running before the editor restarted and were NOT resumed (they terminate when the extension host stops):\n${list}\nRestart them with shell.backgroundRun if the task still needs them.`;
      this.messages.push({ id: randomUUID(), role: "system", content: note, ts: Date.now() });
    }
    if (snapshot.browserTabs?.length && this.opts.restoreBrowserTabs) {
      try {
        await this.opts.restoreBrowserTabs(snapshot.browserTabs);
      } catch {
      }
    }
  }
  toggleAutoApprove(): boolean {
    this.sessionApprovals.autoApproveAll = !this.sessionApprovals.autoApproveAll;
    return this.sessionApprovals.autoApproveAll;
  }
  isAutoApproveEnabled(): boolean { return this.sessionApprovals.autoApproveAll; }
  addSessionCommand(command: string) { this.sessionApprovals.sessionCommandAllowlist.push(command); }
  addCommandPrefix(prefix: string) { this.sessionApprovals.commandPrefixMemory.push({ prefix, createdAt: new Date().toISOString() }); }
  getSessionApprovals(): SessionApprovals { return this.sessionApprovals; }
  switchMode(slug: string): string {
    const modeDef = this.opts.modeRegistry.get(slug);
    if (!modeDef) return `Unknown mode '${slug}'`;
    this.currentMode = slug;
    this.userRequestedMode = slug;
    this.applyModeModelOverride(modeDef);
    const output = `Switched to '${slug}' mode.\n\n${modeDef.roleDefinition}`;
    this.messages.push({ id: randomUUID(), role: "system", content: output, ts: Date.now() });
    return output;
  }
  addContextMessage(content: string): void {
    this.messages.push({ id: randomUUID(), role: "system", content, ts: Date.now() });
  }
  setPendingToolChain(toolName: string, args: Record<string, unknown>, resultText: string, displayTitle: string): void {
    this.pendingChain = { toolName, args, resultText, displayTitle };
  }
  private flushPendingToolChain(): void {
    if (!this.pendingChain) return;
    const { toolName, args, resultText, displayTitle } = this.pendingChain;
    this.pendingChain = null;
    const callId = `describe-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: randomUUID(), role: "assistant", content: "",
      toolCalls: [{ id: callId, name: toolName, args }], ts: Date.now(),
    };
    const toolMsg: ChatMessage = {
      id: randomUUID(), role: "tool", content: resultText, toolCallId: callId, ts: Date.now(),
    };
    this.messages.push(assistantMsg);
    this.messages.push(toolMsg);
    this.sink.message(assistantMsg);
    this.sink.message(toolMsg);
    this.openStep({ id: callId, type: "tool", title: displayTitle, toolName, content: resultText });
  }
  async send(text: string, attachments?: { uri: string; preview?: string }[], images?: string[]): Promise<void> {
    if (this.active) throw new Error("Agent is already running");
    this.verifyAttempts = 0;
    this.consecutiveStreamErrors = 0;
    if (!this.sessionStarted) {
      this.sessionStarted = true;
      runHooks({
        event: "session.start",
        workspaceRoot: this.opts.workspaceRoot,
        sandboxProfile: this.opts.toolContext.sandboxProfile,
        mode: this.currentMode,
        userMessage: text,
      }).then((decisions) => {
        for (const d of decisions) {
          if (d.contextMessage) {
            this.messages.push({ id: randomUUID(), role: "system", content: `[Hooks] ${d.contextMessage}`, ts: Date.now() });
          }
        }
      });
    }
    void runHooks({
      event: "user.submit",
      workspaceRoot: this.opts.workspaceRoot,
      sandboxProfile: this.opts.toolContext.sandboxProfile,
      mode: this.currentMode,
      userMessage: text,
    });
    this.turnCount++;
    if (this.todoItems.length > 0 && this.turnCount - this.lastTodoUpdate > 5) {
      const staleFor = this.turnCount - this.lastTodoUpdate;
      this.messages.push({
        id: randomUUID(),
        role: "system",
        content: `Your plan was last updated ${staleFor} turns ago. If the task has shifted, consider updating your plan via \`todo.write\`.`,
        ts: Date.now(),
      });
    }
    let content = text;
    if (attachments && attachments.length) {
      const lines = attachments.map((a) => `- ${a.preview ?? a.uri}`);
      content = `${text}\n\nAttached context:\n${lines.join("\n")}`;
    }
    const modeDef = this.opts.modeRegistry.get(this.currentMode);
    const isPlanMode = modeDef?.slug === "plan" || (modeDef?.allowedTools && !modeDef.allowedTools.includes("file.edit") && !modeDef.allowedTools.includes("file.write") && !modeDef.allowedTools.includes("shell.run"));
    const userExplicitCodeOrDebug = this.userRequestedMode && (this.userRequestedMode === "code" || this.userRequestedMode === "debug");
    if (isPlanMode && !userExplicitCodeOrDebug && content.length >= 80) {
      const planMsg: ChatMessage = {
        id: randomUUID(),
        role: "system",
        content: "The user's request appears to need planning. Before making ANY changes, you MUST:\n1. Create a detailed todo list via `todo.write` breaking the work into sequential, verifiable steps.\n2. Ask the user for sign-off via `clarification.askUser` with the question \"Review the plan above. Ready to proceed?\" and options [\"Proceed\", \"Revise plan\"].\n3. After approval, use `mode.switch` to switch to \"code\" mode to implement.\nDo NOT call file.edit, file.write, or shell.run until the user approves the plan.",
        ts: Date.now(),
        noCompact: true,
      };
      this.messages.push(planMsg);
      this.sink.message(planMsg);
    }
    const userMsg: ChatMessage = { id: randomUUID(), role: "user", content, ts: Date.now() };
    if (images?.length) {
      (userMsg as unknown as Record<string, unknown>).images = images.map((dataUrl) => ({ type: "image_url", image_url: { url: dataUrl } }));
    }
    this.messages.push(userMsg);
    this.sink.message(userMsg);
    this.pushTimeline({ type: "user_message", turnId: "", content: content.slice(0, 200), ts: Date.now() });
    this.flushPendingToolChain();
    await this.runTurn();
  }
  async continue(): Promise<void> {
    if (this.active) return;
    await this.runTurn();
  }
  async stop() {
    void runHooks({
      event: "stop",
      workspaceRoot: this.opts.workspaceRoot,
      sandboxProfile: this.opts.toolContext.sandboxProfile,
      mode: this.currentMode,
    });
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
    this.active = false;
    if (this.turnCount > 0) {
      this.sink.turnEnd(`stop-${Date.now()}`, true);
    }
  }
  async retract(turnId: string, skipSteps = false): Promise<{ restored: string[]; conflicts: string[] }> {
    const r = await this.store.restore(this.opts.workspaceRoot, turnId);
    if (!skipSteps) {
      this.steps = this.steps.filter((s) => !s.id.startsWith(`turn-${turnId}-`));
      this.sink.steps(this.steps);
    }
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
  async revertToMessage(messageId: string, restoreFiles: boolean, content?: string): Promise<{ reverted: boolean; filesRestored?: string[]; conflicts?: string[]; messagesRemoved: number }> {
    let msgIdx = this.messages.findIndex((m) => m.id === messageId);
    if (msgIdx < 0 && content) {
      msgIdx = this.messages.findIndex((m) => m.role === "user" && m.content.trim() === content.trim());
      if (msgIdx < 0) {
        msgIdx = this.messages.findIndex((m) => m.role === "user" && m.content.includes(content.slice(0, 30)));
      }
    }
    if (msgIdx < 0) return { reverted: false, messagesRemoved: 0 };
    const revertTs = this.messages[msgIdx].ts;
    const removed = this.messages.length - msgIdx;
    this.messages = this.messages.slice(0, msgIdx);
    const keptSteps = this.steps.filter((s) => (s.ts ?? 0) <= revertTs);
    this.steps = keptSteps;
    this.sink.steps(keptSteps);
    this.sink.message({ id: randomUUID(), role: "system", content: `Conversation reverted to before message ${messageId.slice(0, 8)}. ${removed} messages removed.`, ts: Date.now() });
    if (restoreFiles) {
      const turns = await this.store.listTurns(this.opts.workspaceRoot);
      for (const turnId of turns) {
        const snap = await this.store.load(this.opts.workspaceRoot, turnId);
        if (snap && snap.ts <= (this.messages.length ? this.messages[this.messages.length - 1].ts : Date.now())) {
          const r = await this.retract(turnId, true);
          return { reverted: true, filesRestored: r.restored, conflicts: r.conflicts, messagesRemoved: removed };
        }
      }
    }
    return { reverted: true, messagesRemoved: removed };
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
      const current = this.getCurrentModel();
      const modeDef = this.opts.modeRegistry.get(this.currentMode);
      const modeAllowed = modeDef ? new Set(modeDef.allowedTools) : this.opts.enabledTools;
      const effectiveTools = new Set([...this.opts.enabledTools].filter((t) => modeAllowed.has(t)));
      const { specs: toolSpecs, mcpReverse } = buildToolSpecs(effectiveTools, this.opts.toolContext.mcp?.listTools());
      this.mcpReverse = mcpReverse;
      if (current) {
        const dec = decideCompaction(this.messages, current, this.tracker, undefined, this.lastPromptTokens, toolSpecs);
        if (dec.shouldCompact) {
          const hookDecisions = await runHooks({
            event: "pre.compact",
            workspaceRoot: this.opts.workspaceRoot,
            sandboxProfile: this.opts.toolContext.sandboxProfile,
            mode: this.currentMode,
            extra: { reason: dec.reason, estimatedTokens: dec.currentUsage },
          });
          if (!hookDecisions.some((d) => d.decision === "block")) {
            const before = this.messages.length;
            this.messages = await compactAsync(this.messages, (msgs) => this.summarizeForCompaction(msgs, current));
            const summaryMsg = this.messages.find(
              (m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith("## Compaction summary of"),
            );
            if (summaryMsg) this.sink.message(summaryMsg);
            this.sink.compaction(before, this.messages.length, dec.reason);
            this.pushTimeline({ type: "compaction", turnId, before, after: this.messages.length, reason: dec.reason, ts: Date.now() });
          }
        }
      }
      let model = this.getCurrentModel();
      if (!model) {
        const msg: ChatMessage = { id: randomUUID(), role: "assistant", content: "No model configured. Open Arc settings → Models to add one.", ts: Date.now() };
        this.messages.push(msg);
        this.sink.message(msg);
        this.sink.turnEnd(turnId, false, "no-model");
        this.active = false;
        return;
      }
      this.messages = sanitizeToolChains(this.messages);
      let usedProvider: import("../providers/transport.js").StreamRequest["provider"] | undefined;
      const stream = await routeStream(this.registry, model, (decision) => {
        usedProvider = decision.provider;
        const t = transportFor(decision.provider);
        return t.stream({
          model: decision.model,
          provider: decision.provider,
          messages: this.messages,
          tools: toolSpecs.length ? toolSpecs : undefined,
          signal: this.abortController!.signal,
          proxyUrl: this.resolveProviderProxy(),
          reasoningEffort: this.opts.reasoningEffort,
        });
      }, { rerank: true, ...(this.opts.reasoningEffort !== "none" ? { stallMs: 180_000, firstByteMs: 180_000 } : {}) });
      let text = "";
      let thinking = "";
      const toolCalls: ToolCall[] = [];
      const assistantId = randomUUID();
      const turnTs = Date.now();
      let firstTextTs = 0;
      let thoughtStart = 0;
      this.toolAcc.clear();
      for await (const ev of stream.events) {
        if (this.abortController.signal.aborted) break;
        if (ev.type !== "error") this.consecutiveStreamErrors = 0;
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
            this.toolMeta.set(tc.id, { name: tc.name, args: tc.args });
            if (tc.name !== "todo.write") {
              const command = (tc.name === "shell.run" || tc.name === "shell.backgroundRun") ? String(tc.args.command ?? "") : undefined;
              const title = prettyToolTitle(tc.name, tc.args, "processing");
              this.upsertToolStep(tc.id, tc.name, title, command);
            }
            break;
          }
          case "tool_call_delta": {
            if (ev.name === "todo.write") break;
            if (thoughtStart) { this.finalizeThought(assistantId, thoughtStart); thoughtStart = 0; }
            let acc = this.toolAcc.get(ev.id);
            if (!acc) { acc = { name: ev.name, argsJson: "" }; this.toolAcc.set(ev.id, acc); }
            if (ev.name) acc.name = ev.name;
            acc.argsJson += ev.argsDelta;
            const partialArgs = parsePartialArgs(acc.argsJson);
            const command = (acc.name === "shell.run" || acc.name === "shell.backgroundRun") ? String(partialArgs.command ?? "") : undefined;
            const title = prettyToolTitle(acc.name, partialArgs, "processing");
            this.upsertToolStep(ev.id, acc.name, title, command);
            if ((acc.name === "file.write" || acc.name === "file.edit") && typeof partialArgs.path === "string" && partialArgs.path.length > 0) {
              const stepIndex = this.steps.findIndex((s) => s.id === ev.id);
              if (stepIndex >= 0 && this.steps[stepIndex].pending !== false) {
                const isWrite = acc.name === "file.write";
                const curText = isWrite
                  ? (typeof partialArgs.content === "string" ? partialArgs.content : "")
                  : (typeof partialArgs.search === "string" ? partialArgs.search : "") + "\u0000" + (typeof partialArgs.replace === "string" ? partialArgs.replace : "");
                const prevText = this.toolAccPrevContent.get(ev.id);
                if (curText && curText !== prevText) {
                  this.toolAccPrevContent.set(ev.id, curText);
                  const hunks = isWrite
                    ? streamDiffContent("", typeof partialArgs.content === "string" ? partialArgs.content : "")
                    : streamEditDiffHunks(
                        typeof partialArgs.search === "string" ? partialArgs.search : "",
                        typeof partialArgs.replace === "string" ? partialArgs.replace : "",
                      );
                  if (hunks.length > 0) {
                    const step = this.steps[stepIndex];
                    this.steps[stepIndex] = { ...step, diffHunks: hunks, filePath: partialArgs.path as string, pending: true };
                    this.sink.steps(this.steps);
                  }
                }
              }
            }
            break;
          }
          case "usage": {
            this.tracker.observe(model.id, ev.usage);
            const turnCost = estimateCost(model, ev.usage);
            this.usageByModel[model.id] = addUsage(this.usageByModel[model.id], { ...ev.usage, cost: turnCost });
            if (typeof ev.usage.prompt === "number" && ev.usage.prompt > 0) {
              this.lastPromptTokens = Math.max(this.lastPromptTokens, ev.usage.prompt);
            }
            this.sink.usage({ ...ev.usage, cost: turnCost }, this.usageByModel);
            recordSuccess(model.id, usedProvider!.id);
            break;
          }
          case "error": {
            this.consecutiveStreamErrors++;
            this.sink.error(ev.message);
            if (this.consecutiveStreamErrors >= 3) {
              throw new Error(`Provider stream failed ${this.consecutiveStreamErrors} consecutive times: ${ev.message}`);
            }
            break;
          }
          case "done": {
            break;
          }
        }
      }
      if (thoughtStart) this.finalizeThought(assistantId, thoughtStart);
      this.pushTimeline({ type: "model_call", turnId, modelId: model.id, providerId: usedProvider!.id, tier: model.tier, ts: Date.now(), durationMs: Date.now() - turnTs, usage: this.usageByModel[model.id] });
      const abortedTurn = this.abortController.signal.aborted;
      const finalAssistant: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: text,
        thinking: thinking || undefined,
        toolCalls: (!abortedTurn && toolCalls.length) ? toolCalls : undefined,
        ts: firstTextTs || turnTs,
        meta: { modelId: model.id, providerId: usedProvider!.id, tier: model.tier },
      };
      if (!abortedTurn || text.trim() || thinking) {
        this.messages.push(finalAssistant);
        this.sink.message(finalAssistant);
      }
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
          const cleanText = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
          const m = /<arc-handoff\s+reason="([^"]*)"\s*\/>/.exec(cleanText);
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
        this.recordSessionNote();
        this.sink.done();
      }
    } catch (e) {
      if (this.abortController?.signal.aborted) {
        this.sink.turnEnd(turnId, true);
        this.sink.done();
      } else {
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
      const resolved = this.mcpReverse.get(tc.name);
      const server = resolved?.server ?? parsed.server;
      const tool = resolved?.tool ?? parsed.tool;
      const result = await mcp.call(server, tool, tc.args);
      const raw = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
      const output = await this.truncateToolOutput(raw, tc.name);
      this.appendToolOutput(tc.id, output, result.ok);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    const cap = this.maxSessionCaps[tc.name];
    if (cap !== undefined) {
      const used = this.sessionToolCounts.get(tc.name) ?? 0;
      if (used >= cap) {
        const envVar = {
          "web.search": "ARC_MAX_WEB_SEARCHES_PER_SESSION",
          "subagent.spawn": "ARC_MAX_SUBAGENTS_PER_SESSION",
          "mcp.call": "ARC_MAX_MCP_CALLS_PER_SESSION",
        }[tc.name];
        const out = { ok: false, output: `Session cap reached for ${tc.name}: ${used} used, max ${cap} per session (${envVar}). Stop using this tool.` };
        this.appendToolOutput(tc.id, out.output, out.ok);
        this.messages.push({ id: randomUUID(), role: "tool", content: out.output, toolCallId: tc.id, ts: Date.now() });
        return;
      }
      this.sessionToolCounts.set(tc.name, used + 1);
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
      const current = this.getCurrentModel();
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
          this.pushTimeline({ type: "handoff", turnId, fromModel: current.id, toModel: target.id, direction, reason, ts: Date.now() });
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
      const approvalHandler = this.opts.approveShell ?? this.opts.toolContext.requestApproval;
      const spawnSummary = Array.isArray(tc.args.batch)
        ? `Spawn ${tc.args.batch.length} subagent(s):\n\n${JSON.stringify(tc.args.batch, null, 2)}`
        : `Spawn subagent '${String(tc.args.name ?? "subagent")}':\n\n${String(tc.args.instructions ?? "")}`;
      if (!approvalHandler || !await approvalHandler(spawnSummary)) {
        this.appendToolOutput(tc.id, "Subagent spawn denied by user.", false);
        this.messages.push({ id: randomUUID(), role: "tool", content: "Denied by user.", toolCallId: tc.id, ts: Date.now() });
        return;
      }
      void runHooks({
        event: "subagent.spawn",
        tool: tc.name,
        args: tc.args,
        workspaceRoot: this.opts.workspaceRoot,
        sandboxProfile: this.opts.toolContext.sandboxProfile,
        mode: this.currentMode,
      });
      if (!this.opts.isMain) {
        this.appendToolOutput(tc.id, "Subagents cannot spawn further subagents.", false);
        return;
      }
      const parent = this.getCurrentModel();
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
          approvalsConfig: this.opts.approvalsConfig,
          sessionApprovals: this.getSessionApprovals(),
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
            allChildren.push({
              id: `sub-${tc.id}-${i}`,
              type: "subagent",
              title: spec.name,
              children: result.steps,
              ts: Date.now(),
              ...(result.model ? { modelId: result.model.id, modelLabel: result.model.label } : {}),
            });
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
        for (const spec of specs) {
          this.pushTimeline({ type: "subagent_spawn", turnId, name: spec.name, tier: spec.tier ?? parent.tier, ts: Date.now() });
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
        approvalsConfig: this.opts.approvalsConfig,
        sessionApprovals: this.getSessionApprovals(),
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
      if (result.model) {
        this.appendStepChildren(tc.id, result.steps, { modelId: result.model.id, modelLabel: result.model.label });
      } else if (result.steps.length) {
        this.appendStepChildren(tc.id, result.steps);
      }
      this.pushTimeline({ type: "subagent_spawn", turnId, name: spec.name, tier: spec.tier ?? parent.tier, ts: Date.now() });
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
      const approvalHandler = this.opts.approveShell ?? this.opts.toolContext.requestApproval;
      if (!approvalHandler || !await approvalHandler(`Restore workspace files from checkpoint '${resolvedId}'?`)) {
        this.appendToolOutput(tc.id, "Checkpoint restore denied by user.", false);
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
          const label = snap.label ? `  label="${snap.label}"` : "";
          lines.push(`${i + 1}. turnId=${turns[i]}  ts=${new Date(snap.ts).toISOString()}  files=${files}${label}`);
        }
      }
      const output = lines.join("\n");
      this.appendToolOutput(tc.id, output, true);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    if (tc.name === "checkpoint.compare") {
      const indexA = tc.args.indexA ? Number(tc.args.indexA) : undefined;
      const indexB = tc.args.indexB ? Number(tc.args.indexB) : undefined;
      const turnIdA = tc.args.turnIdA ? String(tc.args.turnIdA) : undefined;
      const turnIdB = tc.args.turnIdB ? String(tc.args.turnIdB) : undefined;
      const turns = await this.store.listTurns(this.opts.workspaceRoot);
      const resolveId = (idOrIndex: string | number | undefined): string | undefined => {
        if (typeof idOrIndex === "number" && idOrIndex > 0 && idOrIndex <= turns.length) return turns[idOrIndex - 1];
        if (typeof idOrIndex === "string" && turns.includes(idOrIndex)) return idOrIndex;
        return undefined;
      };
      const idA = resolveId(turnIdA ?? indexA);
      const idB = resolveId(turnIdB ?? indexB);
      if (!idA || !idB) {
        this.appendToolOutput(tc.id, "Provide two valid turn indices (1-based) or turnIds. Use checkpoint.list first.", false);
        this.messages.push({ id: randomUUID(), role: "tool", content: "Invalid checkpoint indices. Use checkpoint.list first.", toolCallId: tc.id, ts: Date.now() });
        return;
      }
      try {
        const diff = await this.store.compare(this.opts.workspaceRoot, idA, idB);
        const lines: string[] = [];
        if (diff.modified.length) lines.push(`Modified (${diff.modified.length}):\n${diff.modified.map((f) => `  - ${f}`).join("\n")}`);
        if (diff.added.length) lines.push(`Added (${diff.added.length}):\n${diff.added.map((f) => `  + ${f}`).join("\n")}`);
        if (diff.removed.length) lines.push(`Removed (${diff.removed.length}):\n${diff.removed.map((f) => `  - ${f}`).join("\n")}`);
        const output = lines.join("\n\n") || "(no differences between checkpoints)";
        this.appendToolOutput(tc.id, output, true);
        this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      } catch (e: unknown) {
        this.appendToolOutput(tc.id, `Compare failed: ${(e as Error).message}`, false);
        this.messages.push({ id: randomUUID(), role: "tool", content: `Compare failed: ${(e as Error).message}`, toolCallId: tc.id, ts: Date.now() });
      }
      return;
    }
    if (tc.name === "mode.switch") {
      const slug = String(tc.args.slug ?? "").trim();
      if (!slug) {
        this.appendToolOutput(tc.id, "mode.switch requires a `slug` argument. Use one of: " + this.opts.modeRegistry.list().map((m) => m.slug).join(", "), false);
        this.messages.push({ id: randomUUID(), role: "tool", content: "mode.switch requires a slug.", toolCallId: tc.id, ts: Date.now() });
        return;
      }
      const targetMode = this.opts.modeRegistry.get(slug);
      if (!targetMode) {
        const available = this.opts.modeRegistry.list().map((m) => m.slug).join(", ");
        this.appendToolOutput(tc.id, `Unknown mode '${slug}'. Available modes: ${available}`, false);
        this.messages.push({ id: randomUUID(), role: "tool", content: `Unknown mode '${slug}'. Available modes: ${available}.`, toolCallId: tc.id, ts: Date.now() });
        return;
      }
      const oldMode = this.currentMode;
      this.currentMode = slug;
      this.userRequestedMode = slug;
      this.applyModeModelOverride(targetMode);
      this.pushTimeline({ type: "mode_switch", turnId, from: oldMode, to: slug, ts: Date.now() });
      const output = `Switched from '${oldMode}' to '${slug}' mode.\n\n## ${slug} mode\n\n${targetMode.roleDefinition}`;
      this.appendToolOutput(tc.id, `Switched to ${slug} mode.`, true);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      if (slug === "audit") {
        generateDependencyGraph(this.opts.workspaceRoot).then((nodes) => {
          this.addContextMessage(formatDepGraph(nodes, this.opts.workspaceRoot));
        }).catch(() => {});
      }
      return;
    }
    if (tc.name === "session.exportTrace") {
      const events = this.timeline.slice();
      const mdLines: string[] = ["# Session Execution Trace", "", `Exported: ${new Date().toISOString()}`, ""];
      let turnId = "";
      for (const ev of events) {
        if (ev.turnId !== turnId) {
          turnId = ev.turnId;
          mdLines.push(`## Turn ${turnId.slice(0, 8)}`, "");
        }
        switch (ev.type) {
          case "model_call":
            mdLines.push(`- **Model call** — ${ev.modelId} (${ev.tier}) via ${ev.providerId} — ${ev.durationMs}ms${ev.usage ? ` — ${ev.usage.prompt}+${ev.usage.completion} tokens, $${ev.usage.cost.toFixed(4)}` : ""}`);
            break;
          case "tool_call":
            mdLines.push(`- **${ev.toolName}** — ${ev.ok ? "OK" : "FAILED"} — ${ev.durationMs}ms${ev.output ? ` — ${ev.output.slice(0, 120)}` : ""}`);
            break;
          case "handoff":
            mdLines.push(`- **Handoff** ${ev.direction} — ${ev.fromModel} → ${ev.toModel} — ${ev.reason}`);
            break;
          case "compaction":
            mdLines.push(`- **Compaction** — ${ev.before} → ${ev.after} messages — ${ev.reason}`);
            break;
          case "approval":
            mdLines.push(`- **Approval** — ${ev.toolName} (${ev.category}) — ${ev.allowed ? "Allowed" : "Denied"}`);
            break;
          case "subagent_spawn":
            mdLines.push(`- **Subagent** — ${ev.name} (${ev.tier})`);
            break;
          case "user_message":
            mdLines.push(`- **User** — ${ev.content.slice(0, 120)}`);
            break;
          case "checkpoint_snapshot":
            mdLines.push(`- **Checkpoint** — ${ev.fileCount} file(s)`);
            break;
          case "mode_switch":
            mdLines.push(`- **Mode switch** — ${ev.from} → ${ev.to}`);
            break;
          case "error":
            mdLines.push(`- **Error** — ${ev.message}`);
            break;
          default:
            break;
        }
        mdLines.push("");
      }
      const md = mdLines.join("\n");
      const json = JSON.stringify(events, null, 2);
      const output = `## Session Trace (${events.length} events)\n\n${md}\n\n## JSON\n\n\`\`\`json\n${json.slice(0, 4000)}\n\`\`\``;
      this.appendToolOutput(tc.id, `Exported ${events.length} event(s).`, true);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    if (tc.name === "skill.use") {
      const name = String(tc.args.name ?? "").trim();
      if (!name) {
        this.appendToolOutput(tc.id, "skill.use requires a `name` argument.", false);
        return;
      }
      const reg = (this.opts.toolContext as unknown as ToolContext).skillRegistry;
      if (!reg) {
        this.appendToolOutput(tc.id, "Skill registry not available.", false);
        return;
      }
      const meta = reg.get(name);
      if (!meta) {
        const available = reg.list().map((s) => s.name).join(", ");
        this.appendToolOutput(tc.id, `Skill '${name}' not found. Available: ${available}`, false);
        this.messages.push({ id: randomUUID(), role: "tool", content: `Skill '${name}' not found.`, toolCallId: tc.id, ts: Date.now() });
        return;
      }
      const body = await reg.readBody(name);
      const resources: string[] = [];
      if (meta.scripts.length) resources.push("## Scripts\n" + meta.scripts.map((s: string) => `- ${s}`).join("\n"));
      if (meta.references.length) resources.push("## References\n" + meta.references.map((r: string) => `- ${r}`).join("\n"));
      if (meta.assets.length) resources.push("## Assets\n" + meta.assets.map((a: string) => `- ${a}`).join("\n"));
      const output = (body ?? "(empty skill)") + (resources.length ? "\n\n" + resources.join("\n\n") : "");
      this.appendToolOutput(tc.id, `Loaded skill '${name}'.`, true);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    if (tc.name === "memory.add") {
      const category = String(tc.args.category ?? "preferences");
      const content = String(tc.args.content ?? "");
      if (!content) {
        this.appendToolOutput(tc.id, "memory.add requires a `content` argument.", false);
        return;
      }
      const { addMemory, loadMemory } = await import("../memory/store.js");
      const entry = await addMemory(this.opts.workspaceRoot, category, content);
      const entries = await loadMemory(this.opts.workspaceRoot);
      const idx = entries.length - 1;
      const output = `Memory added under **${entry.category}** (index ${idx}).\n\n${entry.content}`;
      this.appendToolOutput(tc.id, `Memory added: ${entry.content.slice(0, 80)}`, true);
      this.messages.push({ id: randomUUID(), role: "tool", content: output, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    if (tc.name === "memory.note") {
      const content = String(tc.args.content ?? "");
      if (!content) {
        this.appendToolOutput(tc.id, "memory.note requires a `content` argument.", false);
        return;
      }
      const { appendNote } = await import("../memory/notes.js");
      const r = await appendNote(this.opts.workspaceRoot, content.slice(0, 500));
      if (r.index < 0) {
        this.appendToolOutput(tc.id, "memory.note requires a `content` argument.", false);
        return;
      }
      this.appendToolOutput(tc.id, `Note saved (entry ${r.index} of ${r.total}).`, true);
      this.messages.push({ id: randomUUID(), role: "tool", content: `Note saved to workspace notes. It will be shown to future sessions in this workspace.`, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    if (!def) return;
    const modeDef = this.opts.modeRegistry.get(this.currentMode);
    if (modeDef && !modeDef.allowedTools.includes(tc.name)) {
      this.appendToolOutput(tc.id, `Tool '${tc.name}' is not allowed in '${this.currentMode}' mode.`, false);
      this.messages.push({ id: randomUUID(), role: "tool", content: `Tool '${tc.name}' not allowed in ${this.currentMode} mode.`, toolCallId: tc.id, ts: Date.now() });
      return;
    }
    const hookTools = new Set(["shell.run", "browser.navigate", "browser.click", "browser.type", "browser.screenshot", "browser.evaluate", "browser.readDom", "browser.drag", "browser.dialog", "browser.runCode", "browser.readPage", "web.fetch", "web.search", "mcp.call", "file.edit", "file.write", "file.read", "subagent.spawn", "handoff", "notebook.editCell", "notebook.addCell", "notebook.deleteCell", "notebook.execute"]);
    if (hookTools.has(tc.name)) {
      const decisions = await runHooks({
        event: "pre.tool",
        tool: tc.name,
        args: tc.args,
        workspaceRoot: this.opts.workspaceRoot,
        sandboxProfile: this.opts.toolContext.sandboxProfile,
        mode: this.currentMode,
      });
      for (const hookDecision of decisions) {
        if (hookDecision.decision === "deny") {
          const msg = hookDecision.message ?? `Tool '${tc.name}' blocked by pre.tool hook.`;
          this.appendToolOutput(tc.id, msg, false);
          this.messages.push({ id: randomUUID(), role: "tool", content: msg, toolCallId: tc.id, ts: Date.now() });
          return;
        }
        if (hookDecision.decision === "ask") {
          const approvalHandler = this.opts.approveShell ?? this.opts.toolContext.requestApproval;
          if (!approvalHandler || !await approvalHandler(hookDecision.message ?? `Hook requires approval for ${tc.name}`)) {
            this.appendToolOutput(tc.id, `Tool '${tc.name}' denied by user via hook.`, false);
            return;
          }
        }
        if (hookDecision.modifiedArgs) tc.args = hookDecision.modifiedArgs;
      }
    }
    const target = (tc.args.path as string) ?? (tc.args.file as string);
    const shouldSnapshot = target && this.opts.enabledTools.has(tc.name);
    const isShellOrBrowser = tc.name === "shell.run" || tc.name.startsWith("browser.");
    const isMcpMutation = tc.name === "mcp.create" || tc.name === "mcp.remove" || tc.name === "mcp.toggle";
    if (shouldSnapshot || isShellOrBrowser || isMcpMutation) {
      try {
        const label = tc.name === "shell.run"
          ? `shell.run: ${String(tc.args.command ?? "").slice(0, 60)}`
          : tc.name.startsWith("browser.")
            ? `${tc.name}: ${String(tc.args.url ?? tc.args.selector ?? "").slice(0, 60)}`
            : isMcpMutation
              ? `${tc.name}: ${String(tc.args.name ?? "").slice(0, 60)}`
              : `${tc.name}: ${target}`;
        const filesToSnapshot = shouldSnapshot ? [target] : [];
        await this.store.snapshot(turnId, this.opts.workspaceRoot, filesToSnapshot, this.todoItems, label);
        this.pushTimeline({ type: "checkpoint_snapshot", turnId, fileCount: filesToSnapshot.length || 1, ts: Date.now() });
      } catch (e) {
        console.error(`[arc] checkpoint snapshot failed: ${(e as Error)?.message ?? e}`);
      }
    }
    if (WRITE_TOOLS.has(tc.name)) {
      const writeFilePath = String(tc.args.path);
      if (modeDef?.writeGlob) {
        const check = checkWriteGlob(writeFilePath, modeDef.writeGlob);
        if (!check.allowed) {
          const msg = `Write blocked by mode '${this.currentMode}': path '${writeFilePath}' does not match writeGlob pattern '${modeDef.writeGlob}'. Switch to a different mode via mode.switch or narrow your edit scope.`;
          this.appendToolOutput(tc.id, msg, false);
          this.messages.push({ id: randomUUID(), role: "tool", content: msg, toolCallId: tc.id, ts: Date.now() });
          return;
        }
      }
    }
    const approvalCategory = categoryForTool(tc.name);
    let allowExternalPath = false;
    if (approvalCategory) {
      const extra = buildApprovalExtra(tc.name, tc.args, this.opts.workspaceRoot);
      allowExternalPath = !!(extra?.filePath && extra.workspaceRoot && classifyWorkspacePath(extra.workspaceRoot, extra.filePath).external);
      const level = resolveApproval(this.opts.approvalsConfig ?? DEFAULT_APPROVALS, this.sessionApprovals, approvalCategory, extra);
      if (level === "ask") {
        const approvalHandler = this.opts.approveShell ?? this.opts.toolContext.requestApproval;
        if (!approvalHandler) {
          this.appendToolOutput(tc.id, `Tool '${tc.name}' requires approval and no approval handler is set.`, false);
          this.messages.push({ id: randomUUID(), role: "tool", content: `Approval required but no handler available.`, toolCallId: tc.id, ts: Date.now() });
          return;
        }
        const rawCommand = extra?.command || String(tc.args.command ?? "");
        const approved = await approvalHandler(`Run ${tc.name}?\n\n${prettyToolSummary(tc.name, tc.args)}`, rawCommand ? { command: rawCommand } : undefined);
        this.pushTimeline({ type: "approval", turnId, toolName: tc.name, category: approvalCategory, allowed: approved, ts: Date.now() });
        if (!approved) {
          this.appendToolOutput(tc.id, `Tool '${tc.name}' denied by user.`, false);
          this.messages.push({ id: randomUUID(), role: "tool", content: "Denied by user.", toolCallId: tc.id, ts: Date.now() });
          return;
        }
      }
    }
    const ctx: ToolContext = {
      ...this.opts.toolContext,
      root: this.opts.workspaceRoot,
      workspacePath: this.opts.workspaceRoot,
      approvalsConfig: this.opts.approvalsConfig ?? DEFAULT_APPROVALS,
      sessionApprovals: this.sessionApprovals,
      allowExternalPath,
      requestApproval: this.opts.approveShell ?? this.opts.toolContext.requestApproval,
      addSessionCommand: (cmd: string) => { this.sessionApprovals.sessionCommandAllowlist.push(cmd); },
      signal: this.abortController?.signal,
      onChunk: this.makeChunkHandler(tc),
      onDiff: (diffHunks, filePath) => {
        for (let i = this.steps.length - 1; i >= 0; i--) {
          if (this.steps[i].id === tc.id) {
            if (this.steps[i].pending === false) return;
            this.steps[i] = { ...this.steps[i], diffHunks, filePath, pending: true };
            this.sink.steps(this.steps);
            return;
          }
        }
      },
    };
    let result;
    const toolStartTs = Date.now();
    try {
      result = await def.fn(tc.args, ctx);
    } catch (e) {
      result = { ok: false, output: `Tool error: ${(e as Error).message}` };
    }
    this.pushTimeline({ type: "tool_call", turnId, toolCallId: tc.id, toolName: tc.name, args: tc.args, ts: toolStartTs, durationMs: Date.now() - toolStartTs, ok: result.ok, output: (result.output ?? "").slice(0, 500) });
    const truncatedOutput = await this.truncateToolOutput(result.output, tc.name);
    const isEditOrWrite = tc.name === "file.edit" || tc.name === "file.write";
    this.appendToolOutput(tc.id, isEditOrWrite ? "" : truncatedOutput, result.ok, result.ok ? undefined : prettyToolTitle(tc.name, tc.args, "error"), result.diffHunks, result.filePath, result.runAfter?.command, result.runAfter?.output);
    if (result.todoState) {
      this.todoItems = result.todoState.items.map((it) => ({ ...it }));
      this.lastTodoUpdate = this.turnCount;
      const stepId = `todo-${turnId}-${randomUUID().slice(0, 6)}`;
      this.steps.push({ id: stepId, type: "todo_list", title: "Plan", todos: this.todoItems, ts: Date.now() });
      this.sink.steps(this.steps);
      this.sink.todo(this.todoItems);
      this.persistPlan().catch(() => {});
    }
    const toolContent = result.runAfter
      ? `${truncatedOutput}\n[runAfter] ${result.runAfter.command}\n${result.runAfter.output}`
      : truncatedOutput;
    const toolMsg: ChatMessage = { id: randomUUID(), role: "tool", content: toolContent, toolCallId: tc.id, ts: Date.now() };
    this.messages.push(toolMsg);
    if (result.images?.length) {
      this.messages.push({ id: randomUUID(), role: "user", content: result.output, images: result.images, ts: Date.now() });
    }
    runHooks({
      event: "post.tool",
      tool: tc.name,
      args: tc.args,
      workspaceRoot: this.opts.workspaceRoot,
      sandboxProfile: this.opts.toolContext.sandboxProfile,
      mode: this.currentMode,
      extra: { ok: result.ok },
    }).then((decisions) => {
      for (const d of decisions) {
        if (d.contextMessage) {
          this.messages.push({ id: randomUUID(), role: "system", content: `[Hooks] ${d.contextMessage}`, ts: Date.now() });
        }
      }
    });
    if (result.touchedFiles && result.touchedFiles.length && this.opts.fileContextTracker) {
      const kind = isEditOrWrite ? "edit" : "read";
      for (const f of result.touchedFiles) this.opts.fileContextTracker.touch(f, kind);
    }
    if (result.touchedFiles && result.touchedFiles.length && isEditOrWrite && this.opts.toolContext.summaryForFiles) {
      const summary = await this.opts.toolContext.summaryForFiles(result.touchedFiles);
      if (summary.text) {
        const fbId = `lsp-fb-${randomUUID()}`;
        this.openStep({ id: fbId, type: "tool", title: "Checked diagnostics", output: summary.text });
        toolMsg.content = toolMsg.content ? `${toolMsg.content}\n\n${summary.text}` : summary.text;
      }
    }
    if (result.ok && result.touchedFiles && result.touchedFiles.length && isEditOrWrite) {
      const verifyMode = this.opts.verifyMode ?? "default";
      const verifyConfig = verifyMode === "none" ? undefined : await this.getVerifyConfig();
      if (verifyConfig && verifyConfig.commands.length) {
        const maxRetries = verifyMode === "custom" && this.opts.verifyMaxRetries != null ? this.opts.verifyMaxRetries : verifyConfig.maxRetries;
        const verifyResult = await runVerification(this.opts.workspaceRoot, verifyConfig, result.touchedFiles, this.opts.toolContext.sandboxProfile);
        if (!verifyResult.ok) {
          this.verifyAttempts++;
          const failing = verifyResult.results.filter((r) => !r.ok);
          const report = failing.map((r) => `[${r.name}] FAILED\n${r.output}`).join("\n\n");
          const exhausted = this.verifyAttempts >= maxRetries;
          const note = exhausted
            ? `Verification failed after ${this.verifyAttempts} attempt(s) (max ${maxRetries}). Stop retrying automatically and report the remaining failures to the user:\n\n${report}`
            : `Post-edit verification failed (attempt ${this.verifyAttempts}/${maxRetries}). Fix the issues below before continuing:\n\n${report}`;
          const vfId = `verify-fb-${randomUUID()}`;
          this.openStep({ id: vfId, type: "tool", title: exhausted ? "Verification failed (retries exhausted)" : "Verification failed", output: note });
          toolMsg.content = toolMsg.content ? `${toolMsg.content}\n\n${note}` : note;
        } else {
          this.verifyAttempts = 0;
        }
      }
    }
  }
  askFromSubagent(question: string, options: string[], parentModel?: import("../protocol/protocol.js").ModelDescriptor): Promise<string> {
    return this.askModel(question, options, parentModel);
  }
  private async askModel(question: string, options: string[], parentModel?: import("../protocol/protocol.js").ModelDescriptor): Promise<string> {
    const model = parentModel ?? this.getCurrentModel();
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
          proxyUrl: this.resolveProviderProxy(),
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
          content: this.opts.condensingPrompt?.trim()
            ? this.opts.condensingPrompt
            : "You are a context compressor for an agentic coding assistant. Summarize the prior conversation so the assistant can continue the task. Preserve:\n- Concrete decisions made and the reasoning.\n- File paths touched and what changed (read/edit/write, with brief description).\n- Error messages and their resolutions.\n- Outstanding TODOs or unfinished work.\n- Key user preferences or constraints mentioned.\n\nUse terse bullet points. Skip pleasantries. Do not invent facts.",
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
        proxyUrl: this.resolveProviderProxy(),
      });
      let text = "";
      for await (const ev of stream.events) {
        if (ev.type === "text") text += ev.delta;
        if (ev.type === "done" || ev.type === "error") break;
      }
      const cleaned = text.trim();
      if (!cleaned) return summarizeInProcess(msgs);
      return cleaned.length > 4000 ? cleaned.slice(0, 4000) + "\n…(truncated)" : cleaned;
    } catch (e) {
      console.warn(`[arc] LLM compaction summary failed, falling back to in-process summary: ${(e as Error)?.message ?? e}`);
      return summarizeInProcess(msgs);
    }
  }
  private openStep(step: ProcessStep) {
    this.steps.push({ ...step, ts: step.ts ?? Date.now() });
    this.sink.steps(this.steps);
  }
  private upsertToolStep(id: string, name: string, title: string, command?: string) {
    const existing = this.steps.findIndex((s) => s.id === id);
    if (existing >= 0) {
      this.steps[existing] = { ...this.steps[existing], title, ...(command !== undefined ? { command } : {}) };
    } else {
      this.steps.push({ id, type: "tool", title, toolName: name, content: "", ...(command ? { command } : {}), ts: Date.now(), pending: true });
    }
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
          if (step.pending === false) return;
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
    const resolvedTitle = title ?? (this.toolMeta.has(id) ? prettyToolTitle(this.toolMeta.get(id)!.name, this.toolMeta.get(id)!.args, ok ? "done" : "error") : undefined);
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].id === id) {
        this.steps[i] = {
          ...this.steps[i],
          output,
          pending: false,
          type: ok ? this.steps[i].type : "error",
          ...(resolvedTitle ? { title: resolvedTitle } : {}),
          ...(diffHunks ? { diffHunks } : {}),
          ...(filePath !== undefined ? { filePath } : {}),
          ...(runAfterCommand ? { runAfterCommand } : {}),
          ...(runAfterOutput ? { runAfterOutput } : {}),
        };
        this.sink.steps(this.steps);
        this.trackToolMistakes(id, ok);
        return;
      }
    }
  }
  private trackToolMistakes(id: string, ok: boolean): void {
    if (ok) {
      this.consecutiveMistakes = 0;
      this.lastToolSig = "";
      return;
    }
    const meta = this.toolMeta.get(id);
    const name = meta?.name ?? "";
    if (name === "web.fetch" || name === "web.search") return;
    const sig = `${name}|${JSON.stringify(meta?.args ?? {})}`;
    this.consecutiveMistakes = sig === this.lastToolSig ? this.consecutiveMistakes + 1 : 1;
    this.lastToolSig = sig;
    if (this.consecutiveMistakes >= 3) {
      this.consecutiveMistakes = 0;
      this.lastToolSig = "";
      const question = "You have made 3 consecutive failing or identical tool calls. Stop retrying the same action and tell me how you'd like to proceed.";
      const clId = `clar-${Date.now()}-${randomUUID().slice(0, 4)}`;
      this.sink.clarification(clId, question, []);
      this.messages.push({ id: randomUUID(), role: "system", content: `[Paused] ${question}`, ts: Date.now() });
    }
  }
  private appendStepChildren(id: string, children: ProcessStep[], model?: { modelId: string; modelLabel: string }) {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].id === id) {
        this.steps[i] = { ...this.steps[i], children, ...(model ?? {}) };
        this.sink.steps(this.steps);
        return;
      }
    }
  }
  private async truncateToolOutput(output: string, toolName: string): Promise<string> {
    if (output.length <= TOOL_OUTPUT_MAX_CHARS) return output;
    const { compressForContext } = await import("../compress/compress.js");
    try {
      const comp = await compressForContext(output, toolName, this.opts.workspaceRoot);
      if (comp.kind !== "none" && comp.output.length < output.length * 0.7) {
        this.pushTimeline({ type: "context_compressed", turnId: "", toolName, kind: comp.kind, saved: comp.saved, ts: Date.now() });
        return comp.output;
      }
    } catch {}
    const dir = path.join(getWorkspaceArcDir(this.opts.workspaceRoot), "tool_outputs");
    await fs.mkdir(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = toolName.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filePath = path.join(dir, `${name}_${ts}.txt`);
    const persisted = output.slice(0, 1024 * 1024);
    await fs.writeFile(filePath, persisted, { encoding: "utf-8", mode: 0o600 });
    const truncated = output.slice(0, TOOL_OUTPUT_MAX_CHARS);
    return `${truncated}\n\n...(output truncated from ${output.length} to ${TOOL_OUTPUT_MAX_CHARS} chars, capped output saved to ${filePath})`;
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
  private recordSessionNote(): void {
    if (!this.opts.isMain || this.opts.autoSessionNotes === false) return;
    let lastUser: ChatMessage | undefined;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === "user" && !(m as unknown as { images?: unknown }).images) { lastUser = m; break; }
    }
    if (!lastUser) return;
    const task = lastUser.content.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!task || task.startsWith("The user has added this context")) return;
    const doneCount = this.todoItems.filter((t) => t.state === "done").length;
    const suffix = this.todoItems.length ? ` (${doneCount}/${this.todoItems.length} plan items done)` : "";
    void import("../memory/notes.js").then(({ appendNote }) => appendNote(this.opts.workspaceRoot, `Task: ${task}${suffix}`)).catch(() => {});
  }
}
function redactAuditData<T>(value: T): T {
  const sensitive = /^(?:args|content|replace|search|code|command|env|input|instructions|systemPrompt|apiKey|headers|authorization|token|password|secret)$/i;
  const visit = (input: unknown, key = ""): unknown => {
    if (sensitive.test(key)) return "[REDACTED]";
    if (Array.isArray(input)) return input.map((item) => visit(item));
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([name, item]) => [name, visit(item, name)]));
    return input;
  };
  return visit(value) as T;
}
function addUsage(a: TurnUsage | undefined, b: TurnUsage): TurnUsage {
  return {
    prompt: Math.max(a?.prompt ?? 0, b.prompt),
    completion: (a?.completion ?? 0) + b.completion,
    thinking: (a?.thinking ?? 0) + b.thinking,
    cost: (a?.cost ?? 0) + b.cost,
  };
}
function streamDiffContent(before: string, after: string): import("../protocol/process.js").DiffHunk[] {
  return diffLines(before, after).map((c) => ({ added: c.added ?? false, removed: c.removed ?? false, value: c.value }));
}
function streamEditDiffHunks(search: string, replace: string): import("../protocol/process.js").DiffHunk[] {
  const block = tryExtractDiffBlock(search);
  const s = block?.search ?? search;
  const r = block?.replace ?? replace;
  if (!s && !r) return [];
  return streamDiffContent(s, r);
}
function parsePartialArgs(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown>; } catch {}
  const result: Record<string, unknown> = {};
  for (const key of ["path", "file", "command", "pattern", "url", "query", "name", "question", "selector", "server", "tool", "slug", "id", "content", "replace", "search"]) {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)(?:"|$)`, "g");
    let m: RegExpExecArray | null;
    let last: string | undefined;
    while ((m = re.exec(json)) !== null) { last = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r"); }
    if (last !== undefined) result[key] = last;
  }
  for (const key of ["offset", "limit", "index", "cellIndex", "tabId", "direction"]) {
    const re = new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`, "g");
    let m: RegExpExecArray | null;
    let last: number | undefined;
    while ((m = re.exec(json)) !== null) { last = Number(m[1]); }
    if (last !== undefined) result[key] = last;
  }
  return result;
}
function prettyToolTitle(name: string, args: Record<string, unknown>, state: "processing" | "done" | "error" = "done"): string {
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
  const cleanFilePath = (p: string): string => {
    const m = p.match(/[/\\]tool_outputs[/\\]([a-zA-Z0-9_]+)_(\d{4}-\d{2}-\d{2}T[^/\\]*)$/);
    if (m) return `${m[1].replace(/_/g, ".")} output`;
    return p.replace(/[/\\]\.arc[/\\]workspaces[/\\][a-f0-9-]+[/\\]/g, "/.arc/.../");
  };
  if (state === "processing") {
    switch (name) {
      case "file.read": return `Reading ${cleanFilePath(path)}${rangeInfo()}`;
      case "file.edit": return `Editing ${cleanFilePath(path)}`;
      case "file.write": return `Writing ${cleanFilePath(path)}`;
      case "file.grep": return `Grepping /${clip(String(args.pattern ?? ""))}/`;
      case "file.glob": return `Globbing ${clip(String(args.pattern ?? ""))}`;
      case "shell.run": return `Running ${clip(String(args.command ?? ""))}`;
      case "shell.backgroundRun": return `Starting ${clip(String(args.command ?? ""))}`;
      case "shell.check": return `Checking process ${args.id ?? ""}`;
      case "shell.write": return `Writing to process ${args.id ?? ""}`;
      case "shell.customRun": return `Creating custom run ${clip(String(args.name ?? ""), 40)}`;
      case "shell.editCustomRun": return `Editing custom run ${String(args.id ?? "").slice(0, 12)}`;
      case "shell.runCustomRun": return `Running custom run ${String(args.id ?? "").slice(0, 12)}`;
      case "lsp.problems": return "Checking workspace problems";
      case "lsp.problemsFor": return `Checking problems in ${path}`;
      case "todo.write": return "Updating plan";
      case "browser.navigate": return `Navigating to ${clip(String(args.url ?? ""))}`;
      case "browser.click": return `Clicking ${clip(String(args.selector ?? ""))}`;
      case "browser.type": return `Typing into ${clip(String(args.selector ?? ""))}`;
      case "browser.screenshot": return "Taking screenshot";
      case "browser.evaluate": return "Evaluating script";
      case "browser.readDom": return "Reading page DOM";
      case "browser.drag": return `Dragging ${clip(String(args.from ?? ""))}`;
      case "browser.dialog": return "Handling dialog";
      case "browser.runCode": return "Running Playwright code";
      case "browser.readPage": return "Reading page content";
      case "browser.close": return "Closing browser";
      case "browser.hover": return `Hovering ${clip(String(args.selector ?? ""))}`;
      case "browser.scroll": return `Scrolling ${args.selector ? "to " + String(args.selector) : ""}`;
      case "browser.waitFor": return `Waiting for ${args.selector ?? args.url ?? args.state ?? "condition"}`;
      case "browser.newTab": return `Opening new tab${args.url ? " for " + clip(String(args.url)) : ""}`;
      case "browser.switchTab": return `Switching to tab ${args.tabId ?? ""}`;
      case "browser.closeTab": return `Closing tab ${args.tabId ?? ""}`;
      case "browser.listTabs": return "Listing browser tabs";
      case "browser.intercept": return `Intercepting ${clip(String(args.pattern ?? ""))}`;
      case "browser.unintercept": return `Stopping interception for ${clip(String(args.pattern ?? ""))}`;
      case "mcp.call": return `Calling ${args.server ?? ""}/${args.tool ?? ""}`;
      case "mcp.create": return `Registering MCP server ${args.name ?? ""}`;
      case "mcp.remove": return `Removing MCP server ${args.name ?? ""}`;
      case "mcp.toggle": return `Toggling MCP server ${args.name ?? ""}`;
      case "mcp.resources/list": return `Listing MCP resources on ${args.server ?? ""}`;
      case "mcp.resources/read": return `Reading MCP resource ${args.uri ?? ""}`;
      case "mcp.prompts/list": return `Listing MCP prompts on ${args.server ?? ""}`;
      case "mcp.prompts/get": return `Fetching MCP prompt ${args.name ?? ""}`;
      case "subagent.spawn": return `Spawning subagent ${args.name ?? ""}`;
      case "checkpoint.revert": return `Reverting to turn ${String(args.turnId ?? args.index ?? "").slice(0, 12)}`;
      case "checkpoint.list": return "Listing checkpoints";
      case "checkpoint.compare": return "Comparing checkpoints";
      case "subagent.askParent": return `Asking parent: ${clip(String(args.question ?? ""), 80)}`;
      case "handoff": return `Handing off (${args.direction ?? "escalate"})`;
      case "clarification.askUser": return `Asking: ${clip(String(args.question ?? ""), 80)}`;
      case "file.semanticSearch": return `Searching: ${clip(String(args.query ?? ""), 80)}`;
      case "web.fetch": return `Fetching ${clip(String(args.url ?? ""))}`;
      case "web.search": return `Searching for: ${clip(String(args.query ?? ""), 60)}`;
      case "mode.switch": return `Switching to ${String(args.slug ?? "")} mode`;
      case "skill.read": return `Reading skill ${clip(String(args.name ?? ""), 40)}`;
      case "skill.use": return `Loading skill ${clip(String(args.name ?? ""), 40)}`;
      case "memory.add": return `Adding memory`;
      case "memory.list": return `Listing memories`;
      case "memory.edit": return `Editing memory`;
      case "memory.delete": return `Deleting memory`;
      case "rule.list": return `Listing rules`;
      case "rule.read": return `Reading rule ${clip(String(args.name ?? ""), 40)}`;
      case "rule.create": return `Creating rule ${clip(String(args.name ?? ""), 40)}`;
      case "git.diffStaged": return "Reading staged diff";
      case "git.diffUnstaged": return "Reading unstaged diff";
      case "git.changedFiles": return "Listing changed files";
      case "git.branchDiff": return "Reading branch diff";
      case "git.commitMessage": return "Generating commit message";
      case "browser.console": return "Reading browser console";
      case "browser.network": return "Reading browser network";
      case "browser.domSnapshot": return "Reading browser snapshot";
      case "test.run": return `Running tests${args.scope ? " (" + String(args.scope) + ")" : ""}`;
      case "session.exportTrace": return "Exporting session trace";
      case "notebook.read": return args.cellIndex !== undefined ? `Reading cell ${args.cellIndex} of ${cleanFilePath(path)}` : `Reading notebook ${cleanFilePath(path)}`;
      case "notebook.editCell": return `Editing cell ${args.cellIndex ?? ""} in ${cleanFilePath(path)}`;
      case "notebook.addCell": return `Adding a cell to ${cleanFilePath(path)}`;
      case "notebook.deleteCell": return `Deleting cell ${args.cellIndex ?? ""} from ${cleanFilePath(path)}`;
      case "notebook.execute": return `Executing cell ${args.cellIndex ?? ""} in ${cleanFilePath(path)}`;
      case "wait.for": return `Waiting ${String(args.seconds ?? "")}s`;
      case "wait.until": return `Waiting until ${clip(String(args.time ?? ""), 40)}`;
      case "wait.forProcess": return `Waiting for process ${args.id ?? ""}`;
      case "wait.forCommand": return `Waiting for: ${clip(String(args.command ?? ""))}`;
      case "context.retrieve": return `Retrieving context ${String(args.id ?? "").slice(0, 12)}`;
      case "memory.note": return `Saving note`;
      default: return name;
    }
  }
  if (state === "error") {
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
      case "browser.drag": return `Failed to drag ${clip(String(args.from ?? ""))}`;
      case "browser.dialog": return "Failed to handle dialog";
      case "browser.runCode": return "Failed to run Playwright code";
      case "browser.readPage": return "Failed to read page content";
      case "browser.close": return "Failed to close browser";
      case "browser.hover": return `Failed to hover ${clip(String(args.selector ?? ""))}`;
      case "browser.scroll": return `Failed to scroll ${args.selector ? "to " + String(args.selector) : ""}`;
      case "browser.waitFor": return `Wait failed for ${args.selector ?? args.url ?? args.state ?? "condition"}`;
      case "browser.newTab": return `Failed to open new tab${args.url ? " for " + clip(String(args.url)) : ""}`;
      case "browser.switchTab": return `Failed to switch to tab ${args.tabId ?? ""}`;
      case "browser.closeTab": return `Failed to close tab ${args.tabId ?? ""}`;
      case "browser.listTabs": return "Failed to list browser tabs";
      case "browser.intercept": return `Failed to intercept ${clip(String(args.pattern ?? ""))}`;
      case "browser.unintercept": return `Failed to remove interception for ${clip(String(args.pattern ?? ""))}`;
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
      case "subagent.askParent": return `Failed to ask parent: ${clip(String(args.question ?? ""), 80)}`;
      case "clarification.askUser": return `Failed to ask: ${clip(String(args.question ?? ""), 80)}`;
      case "checkpoint.revert": return `Failed to revert to ${String(args.turnId ?? args.index ?? "")}`;
      case "checkpoint.list": return "Failed to list checkpoints";
      case "checkpoint.compare": return "Failed to compare checkpoints";
      case "file.semanticSearch": return `Semantic search failed: ${clip(String(args.query ?? ""))}`;
      case "web.fetch": return `Failed to fetch ${clip(String(args.url ?? ""))}`;
      case "web.search": return `Search failed: ${clip(String(args.query ?? ""))}`;
      case "mode.switch": return `Failed to switch to ${String(args.slug ?? "")} mode`;
      case "skill.read": return `Failed to read skill ${String(args.name ?? "")}`;
      case "skill.use": return `Failed to load skill ${String(args.name ?? "")}`;
      case "memory.add": return `Failed to add memory`;
      case "memory.list": return `Failed to list memories`;
      case "memory.edit": return `Failed to edit memory`;
      case "memory.delete": return `Failed to delete memory`;
      case "rule.list": return `Failed to list rules`;
      case "rule.read": return `Failed to read rule ${String(args.name ?? "")}`;
      case "rule.create": return `Failed to create rule ${String(args.name ?? "")}`;
      case "git.diffStaged": return "Failed to read staged diff";
      case "git.diffUnstaged": return "Failed to read unstaged diff";
      case "git.changedFiles": return "Failed to list changed files";
      case "git.branchDiff": return "Failed to read branch diff";
      case "git.commitMessage": return "Failed to generate commit message";
      case "browser.console": return "Failed to read browser console";
      case "browser.network": return "Failed to read browser network";
      case "browser.domSnapshot": return "Failed to read browser snapshot";
      case "test.run": return "Tests failed";
      case "session.exportTrace": return "Failed to export trace";
      case "notebook.read": return `Failed to read notebook ${path}`;
      case "notebook.editCell": return `Failed to edit cell ${args.cellIndex ?? ""} in ${path}`;
      case "notebook.addCell": return `Failed to add cell to ${path}`;
      case "notebook.deleteCell": return `Failed to delete cell ${args.cellIndex ?? ""} from ${path}`;
      case "notebook.execute": return `Failed to execute cell ${args.cellIndex ?? ""} in ${path}`;
      case "wait.for": return `Wait interrupted (${String(args.seconds ?? "")}s)`;
      case "wait.until": return `Wait until ${clip(String(args.time ?? ""), 40)} interrupted`;
      case "wait.forProcess": return `Wait for process ${args.id ?? ""} interrupted`;
      case "wait.forCommand": return `Wait failed: ${clip(String(args.command ?? ""))}`;
      case "context.retrieve": return `Failed to retrieve context ${String(args.id ?? "").slice(0, 12)}`;
      case "memory.note": return `Failed to save note`;
      default: return `Failed: ${name}`;
    }
  }
  switch (name) {
    case "file.read": return `Read ${cleanFilePath(path)}${rangeInfo()}`;
    case "file.edit": return `Edited ${cleanFilePath(path)}`;
    case "file.write": return `Wrote ${cleanFilePath(path)}`;
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
    case "browser.drag": return `Dragged ${clip(String(args.from ?? ""))}`;
    case "browser.dialog": return "Handled dialog";
    case "browser.runCode": return "Ran Playwright code";
    case "browser.readPage": return "Read page content";
    case "browser.close": return "Closed browser";
    case "browser.hover": return `Hovered ${clip(String(args.selector ?? ""))}`;
    case "browser.scroll": return `Scrolled ${args.selector ? "to " + String(args.selector) : ""}`;
    case "browser.waitFor": return `Waited for ${args.selector ?? args.url ?? args.state ?? "condition"}`;
    case "browser.newTab": return `Opened new tab${args.url ? " for " + clip(String(args.url)) : ""}`;
    case "browser.switchTab": return `Switched to tab ${args.tabId ?? ""}`;
    case "browser.closeTab": return `Closed tab ${args.tabId ?? ""}`;
    case "browser.listTabs": return "Listed browser tabs";
    case "browser.intercept": return `Intercepting ${clip(String(args.pattern ?? ""))}`;
    case "browser.unintercept": return `Stopped intercepting ${clip(String(args.pattern ?? ""))}`;
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
    case "checkpoint.compare": return "Compared checkpoints";
    case "subagent.askParent": return `Asked parent: ${clip(String(args.question ?? ""), 80)}`;
    case "handoff": return `Handed off (${args.direction ?? "escalate"})`;
    case "clarification.askUser": return `Asked: ${clip(String(args.question ?? ""), 80)}`;
    case "file.semanticSearch": return `Searched: ${clip(String(args.query ?? ""), 80)}`;
    case "web.fetch": return `Fetched ${clip(String(args.url ?? ""))}`;
    case "web.search": return `Searched for: ${clip(String(args.query ?? ""), 60)}`;
    case "mode.switch": return `Switched to ${String(args.slug ?? "")} mode`;
    case "skill.read": return `Read skill ${clip(String(args.name ?? ""), 40)}`;
    case "skill.use": return `Loaded skill ${clip(String(args.name ?? ""), 40)}`;
    case "memory.add": return `Memory added`;
    case "memory.list": return `Listed memories`;
    case "memory.edit": return `Edited memory`;
    case "memory.delete": return `Deleted memory`;
    case "rule.list": return `Listed rules`;
    case "rule.read": return `Read rule ${clip(String(args.name ?? ""), 40)}`;
    case "rule.create": return `Created rule ${clip(String(args.name ?? ""), 40)}`;
    case "git.diffStaged": return "Read staged diff";
    case "git.diffUnstaged": return "Read unstaged diff";
    case "git.changedFiles": return "Listed changed files";
    case "git.branchDiff": return "Read branch diff";
    case "git.commitMessage": return "Generated commit message";
    case "browser.console": return "Read browser console";
    case "browser.network": return "Read browser network";
    case "browser.domSnapshot": return "Read browser snapshot";
    case "test.run": return `Ran tests${args.scope ? " (" + String(args.scope) + ")" : ""}`;
    case "session.exportTrace": return "Exported session trace";
    case "notebook.read": return args.cellIndex !== undefined ? `Read cell ${args.cellIndex} of ${cleanFilePath(path)}` : `Read notebook ${cleanFilePath(path)}`;
    case "notebook.editCell": return `Edited cell ${args.cellIndex ?? ""} in ${cleanFilePath(path)}`;
    case "notebook.addCell": return `Added a cell to ${cleanFilePath(path)}`;
    case "notebook.deleteCell": return `Deleted cell ${args.cellIndex ?? ""} from ${cleanFilePath(path)}`;
    case "notebook.execute": return `Executed cell ${args.cellIndex ?? ""} in ${cleanFilePath(path)}`;
    case "wait.for": return `Waited ${String(args.seconds ?? "")}s`;
    case "wait.until": return `Waited until ${clip(String(args.time ?? ""), 40)}`;
    case "wait.forProcess": return `Waited for process ${args.id ?? ""}`;
    case "wait.forCommand": return `Waited for: ${clip(String(args.command ?? ""))}`;
    case "context.retrieve": return `Retrieved context ${String(args.id ?? "").slice(0, 12)}`;
    case "memory.note": return `Note saved`;
    default: return name;
  }
}
const READ_TOOLS = new Set(["file.read", "file.grep", "file.glob", "file.semanticSearch", "notebook.read"]);
const WRITE_TOOLS = new Set(["file.edit", "file.write", "notebook.editCell", "notebook.addCell", "notebook.deleteCell"]);
const SHELL_TOOLS = new Set(["shell.run", "shell.backgroundRun", "shell.check", "shell.write", "shell.customRun", "shell.editCustomRun", "shell.runCustomRun"]);
const BROWSER_TOOLS = new Set(["browser.navigate", "browser.click", "browser.type", "browser.screenshot", "browser.evaluate", "browser.readDom", "browser.close", "browser.hover", "browser.scroll", "browser.waitFor", "browser.console", "browser.network", "browser.domSnapshot", "browser.drag", "browser.dialog", "browser.runCode", "browser.readPage", "browser.newTab", "browser.switchTab", "browser.closeTab", "browser.listTabs", "browser.intercept", "browser.unintercept"]);
const MCP_TOOLS = new Set(["mcp.call", "mcp.create", "mcp.remove", "mcp.toggle", "mcp.resources/list", "mcp.resources/read", "mcp.prompts/list", "mcp.prompts/get"]);
const GIT_TOOLS = new Set(["git.diffStaged", "git.diffUnstaged", "git.changedFiles", "git.branchDiff", "git.commitMessage"]);
const CODE_EXECUTE_TOOLS = new Set(["test.run", "browser.runCode", "notebook.execute"]);
function categoryForTool(name: string): string | undefined {
  if (READ_TOOLS.has(name)) return "read";
  if (WRITE_TOOLS.has(name)) return "write.local";
  if (SHELL_TOOLS.has(name)) return "shell.other";
  if (CODE_EXECUTE_TOOLS.has(name)) return "code.execute";
  if (name === "subagent.spawn") return "subagent";
  if (name === "rule.create") return "write.external";
  if (name === "mcp.create" || name === "mcp.remove" || name === "mcp.toggle") return "mcp.configure";
  if (BROWSER_TOOLS.has(name)) return "browser";
  if (name === "web.fetch") return "web.fetch";
  if (name === "web.search") return "web.fetch";
  if (MCP_TOOLS.has(name)) return "mcp";
  if (GIT_TOOLS.has(name)) return "read";
  return undefined;
}
function buildApprovalExtra(name: string, args: Record<string, unknown>, workspaceRoot: string): { filePath?: string; workspaceRoot?: string; command?: string; mcpServer?: string } | undefined {
  if (WRITE_TOOLS.has(name) || name === "file.read" || name === "notebook.read" || name === "notebook.execute") return { filePath: String(args.path ?? ""), workspaceRoot };
  if (name === "rule.create") return { filePath: path.join(getWorkspaceArcDir(workspaceRoot), "rules", `${String(args.name ?? "")}.md`), workspaceRoot };
  if (SHELL_TOOLS.has(name)) return { command: String(args.command ?? ""), workspaceRoot };
  if (MCP_TOOLS.has(name)) return { mcpServer: String(args.server ?? args.name ?? ""), workspaceRoot };
  return undefined;
}
function prettyToolSummary(name: string, args: Record<string, unknown>): string {
  const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  switch (name) {
    case "file.read": return `Read ${clip(String(args.path ?? ""))}`;
    case "file.edit": return `Edit ${clip(String(args.path ?? ""))}`;
    case "file.write": return `Write ${clip(String(args.path ?? ""))}`;
    case "file.grep": return `Search for /${clip(String(args.pattern ?? ""))}/`;
    case "file.glob": return `Glob ${clip(String(args.pattern ?? ""))}`;
    case "shell.run": return clip(String(args.command ?? ""));
    case "shell.backgroundRun": return `[background] ${clip(String(args.command ?? ""))}`;
    case "shell.check": return `Check process ${args.id ?? ""}`;
    case "shell.write": return `Write to process ${args.id ?? ""}`;
    case "browser.navigate": return `Navigate to ${clip(String(args.url ?? ""))}`;
    case "browser.click": return `Click ${clip(String(args.selector ?? ""))}`;
    case "browser.type": return `Type into ${clip(String(args.selector ?? ""))}`;
    case "browser.screenshot": return "Take screenshot";
    case "browser.evaluate": return `Evaluate: ${clip(String(args.script ?? ""), 60)}`;
    case "browser.readDom": return "Read page DOM";
    case "browser.drag": return `Drag ${clip(String(args.from ?? ""))}`;
    case "browser.dialog": return "Handle dialog";
    case "browser.runCode": return `Run Playwright code:\n\n${String(args.code ?? "")}`;
    case "browser.readPage": return "Read page content";
    case "browser.close": return "Close browser";
    case "browser.newTab": return `Open new tab${args.url ? " for " + clip(String(args.url)) : ""}`;
    case "browser.switchTab": return `Switch to tab ${args.tabId ?? ""}`;
    case "browser.closeTab": return `Close tab ${args.tabId ?? ""}`;
    case "browser.listTabs": return "List browser tabs";
    case "browser.intercept": return `Intercept ${clip(String(args.pattern ?? ""))}`;
    case "browser.unintercept": return `Stop intercepting ${clip(String(args.pattern ?? ""))}`;
    case "web.fetch": return `Fetch ${clip(String(args.url ?? ""))}`;
    case "web.search": return `Search for ${clip(String(args.query ?? ""), 40)}`;
    case "mcp.call": return `MCP ${args.server ?? ""}/${args.tool ?? ""}`;
    case "mcp.create": return `Register MCP server ${args.name ?? ""}:\n\n${JSON.stringify(args.transport ?? {}, null, 2)}`;
    case "mcp.remove": return `Remove MCP server ${args.name ?? ""}`;
    case "mcp.toggle": return `Toggle MCP server ${args.name ?? ""}`;
    case "git.diffStaged": return "Staged diff";
    case "git.diffUnstaged": return "Unstaged diff";
    case "git.changedFiles": return "Changed files";
    case "git.branchDiff": return `Branch diff${args.base ? " vs " + String(args.base) : ""}`;
    case "git.commitMessage": return "Commit message";
    case "browser.console": return "Browser console";
    case "browser.network": return "Browser network";
    case "browser.domSnapshot": return "Browser snapshot";
    case "test.run": return `Run tests (${args.scope ?? "workspace"}${args.path ? `: ${args.path}` : ""})`;
    case "notebook.read": return args.cellIndex !== undefined ? `Read notebook cell ${args.cellIndex}` : "List notebook cells";
    case "notebook.editCell": return `Edit notebook cell ${args.cellIndex ?? ""}`;
    case "notebook.addCell": return "Add notebook cell";
    case "notebook.deleteCell": return `Delete notebook cell ${args.cellIndex ?? ""}`;
    case "notebook.execute": return `Execute notebook cell ${args.cellIndex ?? ""} in ${String(args.path ?? "")}`;
    case "shell.customRun": return `Define custom run '${String(args.name ?? "")}'`;
    case "shell.editCustomRun": return `Edit custom run ${args.id ?? ""}`;
    case "shell.runCustomRun": return `Run custom run ${args.id ?? ""}`;
    case "lsp.problems": return "Check workspace problems";
    case "lsp.problemsFor": return `Check problems in ${clip(String(args.path ?? ""))}`;
    case "todo.write": return `Update plan (${Array.isArray(args.items) ? `${args.items.length} items` : "items"})`;
    case "file.semanticSearch": return `Semantic search for ${clip(String(args.query ?? ""), 40)}`;
    case "mcp.resources/list": return `List MCP resources on ${args.server ?? ""}`;
    case "mcp.resources/read": return `Read MCP resource ${args.uri ?? ""}`;
    case "mcp.prompts/list": return `List MCP prompts on ${args.server ?? ""}`;
    case "mcp.prompts/get": return `Get MCP prompt ${args.name ?? ""} from ${args.server ?? ""}`;
    case "session.exportTrace": return "Export session trace";
    case "checkpoint.revert": return args.turnId ? `Revert to checkpoint ${args.turnId}` : `Revert ${args.index !== undefined ? `checkpoint #${args.index}` : "checkpoint"}`;
    case "checkpoint.list": return "List checkpoints";
    case "checkpoint.compare": return `Compare checkpoints ${args.indexA !== undefined ? `#${args.indexA}` : ""}${args.indexB !== undefined ? ` and #${args.indexB}` : ""}`;
    case "subagent.spawn": return Array.isArray(args.batch) ? `Spawn ${args.batch.length} subagents in parallel` : `Spawn subagent ${String(args.name ?? "")}`;
    case "subagent.askParent": return `Ask parent: ${clip(String(args.question ?? ""), 40)}`;
    case "handoff": return `Hand off (${args.direction ?? "escalate"})`;
    case "clarification.askUser": return `Ask: ${clip(String(args.question ?? ""), 40)}`;
    case "mode.switch": return `Switch to mode '${String(args.slug ?? "")}'`;
    case "skill.read": return `Read skill ${String(args.name ?? "")}`;
    case "skill.use": return `Load skill ${String(args.name ?? "")}`;
    case "memory.list": return "List memories";
    case "memory.edit": return `Edit memory #${args.index ?? ""}`;
    case "memory.delete": return `Delete memory #${args.index ?? ""}`;
    case "memory.add": return `Add memory (${args.category ?? "general"})`;
    case "memory.note": return "Append workspace note";
    case "rule.list": return "List rules";
    case "rule.read": return `Read rule ${String(args.name ?? "")}`;
    case "rule.create": return `Create rule ${String(args.name ?? "")}`;
    case "browser.hover": return `Hover ${clip(String(args.selector ?? ""))}`;
    case "browser.scroll": return args.pixels !== undefined ? `Scroll ${args.pixels}px` : `Scroll to ${clip(String(args.selector ?? ""))}`;
    case "browser.waitFor": return `Wait for ${clip(String(args.selector ?? args.url ?? ""))}`;
    case "wait.for": return `Wait ${args.seconds ?? ""}s`;
    case "wait.until": return `Wait until ${String(args.time ?? "")}`;
    case "wait.forProcess": return `Wait for process ${args.id ?? ""}`;
    case "wait.forCommand": return `Wait until: ${clip(String(args.command ?? ""), 40)}`;
    case "context.retrieve": return `Restore compressed output ${args.id ?? ""}`;
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
function renderForSummary(msgs: ChatMessage[]): string {
  const out: string[] = [];
  for (const m of msgs) {
    if (m.role === "system") {
      if (m.content.startsWith("## Compaction summary")) continue;
      out.push(`[system] ${m.content.slice(0, 300)}`);
    } else if (m.role === "user") {
      out.push(`[user] ${m.content}`);
    } else if (m.role === "assistant") {
      const tc = m.toolCalls?.length ? ` tools=${m.toolCalls.map((t) => `${t.name}(${(JSON.stringify(t.args) ?? "").slice(0, 80)})`).join("; ")}` : "";
      out.push(`[assistant] ${m.content.slice(0, 300)}${tc}`);
    } else if (m.role === "tool") {
      out.push(`[tool:${m.toolCallId ?? ""}] ${m.content.slice(0, 300)}`);
    }
  }
  return out.join("\n");
}
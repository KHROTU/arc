import { Agent, type AgentEventSink, type AgentOptions } from "./agent.js";
import { ModelRegistry } from "../routing/registry.js";
import { CheckpointStore } from "../checkpoint/store.js";
import { pickForTier } from "../routing/router.js";
import { subagentTierFor } from "../routing/handoff.js";
import { ModeRegistry } from "../modes/index.js";
import { DEFAULT_APPROVALS } from "../approvals/index.js";
import * as tools from "./tools.js";
import type { ModelDescriptor, ModelTier } from "../protocol/protocol.js";
import type { ProcessStep, TodoItem } from "../protocol/process.js";
export interface SubagentRules {
  blockedCommands?: string[];
  requireApproval?: boolean;
}
export interface SubagentSpec {
  name: string;
  instructions: string;
  tier?: ModelTier;
  modelId?: string;
  rules?: SubagentRules;
}
export interface SubagentResult {
  ok: boolean;
  output: string;
  steps: ProcessStep[];
  todo: TodoItem[];
}
export class SubagentRunner {
  constructor(
    private registry: ModelRegistry,
    private store: CheckpointStore,
    private modeRegistry?: ModeRegistry,
  ) {}
  async run(
    spec: SubagentSpec,
    parent: ModelDescriptor,
    ctx: AgentOptions["toolContext"] & { root: string; shell?: { policy: "always" | "allowlist" | "off"; allowlist: string[] }; requestApproval?: (description: string) => Promise<boolean> },
    askParent?: (question: string, options: string[]) => Promise<string>,
    onStep?: (steps: ProcessStep[]) => void,
    onApprovalRequest?: (description: string) => void,
  ): Promise<SubagentResult> {
    const tier = spec.tier ?? subagentTierFor(parent);
    const model = spec.modelId ? this.registry.get(spec.modelId) : pickForTier(this.registry, tier);
    if (!model) {
      return { ok: false, output: `No model available for tier ${tier}.`, steps: [], todo: [] };
    }
    if (!this.registry.providersFor(model.id).length) {
      return { ok: false, output: `Model ${model.label} has no enabled providers.`, steps: [], todo: [] };
    }
    const collected: ProcessStep[] = [];
    const todos: TodoItem[] = [];
    const sink: AgentEventSink = {
      message: () => {},
      assistantDelta: () => {},
      steps: (steps) => {
        collected.length = 0;
        collected.push(...steps);
        onStep?.(steps);
      },
      turnStart: () => {},
      turnEnd: () => {},
      usage: () => {},
      handoff: () => {},
      todo: (items) => { todos.length = 0; todos.push(...items); },
      clarification: () => {},
      done: () => {},
      error: () => {},
      compaction: () => {},
      guidance: () => {},
      timeline: () => {},
    };
    const rules = spec.rules ?? {};
    const blockedCommands = new Set(rules.blockedCommands ?? []);
    const needsApproval = rules.requireApproval ?? false;
    const toolContext = {
      ...ctx,
      requestApproval: async (description: string): Promise<boolean> => {
        onApprovalRequest?.(description);
        if (!askParent) return false;
        const baseCmd = description.split("\n\n")[1]?.trim().split(/\s+/)[0] ?? "";
        if (blockedCommands.has(baseCmd)) {
          return false;
        }
        if (needsApproval) {
          const answer = await askParent(
            `Subagent "${spec.name}" needs approval for:\n\n${description}`,
            ["Allow", "Deny"],
          );
          return answer.toLowerCase().includes("allow");
        }
        const answer = await askParent(
          `Subagent "${spec.name}" wants to run:\n\n${description}\n\nAllow?`,
          ["Allow", "Deny"],
        );
        return answer.toLowerCase().includes("allow");
      },
    };
    const modeReg = this.modeRegistry ?? new ModeRegistry(ctx.root);
    const agent = new Agent(this.registry, this.store, sink, {
      systemPrompt: spec.instructions,
      enabledTools: new Set([...Object.keys(tools.tools), "subagent.askParent"]),
      workspaceRoot: ctx.root,
      mode: "code",
      modeRegistry: modeReg,
      approvalsConfig: DEFAULT_APPROVALS,
      isMain: false,
      ownerTier: tier,
      toolContext,
      modelOverride: model,
      proxyUrl: toolContext.proxyUrl,
      proxyProvider: toolContext.proxyProvider,
    });
    await agent.send(spec.instructions);
    const finalText = agent.getMessages().filter((m) => m.role === "assistant").slice(-1)[0]?.content ?? "";
    return { ok: true, output: finalText, steps: collected, todo: todos };
  }
  async runBatch(
    specs: SubagentSpec[],
    parent: ModelDescriptor,
    ctx: AgentOptions["toolContext"] & { root: string; shell?: { policy: "always" | "allowlist" | "off"; allowlist: string[] }; requestApproval?: (description: string) => Promise<boolean> },
    askParent?: (question: string, options: string[]) => Promise<string>,
    onStep?: (steps: ProcessStep[]) => void,
    onApprovalRequest?: (description: string) => void,
  ): Promise<SubagentResult[]> {
    return Promise.all(specs.map((spec) => this.run(spec, parent, ctx, askParent, onStep, onApprovalRequest)));
  }
}
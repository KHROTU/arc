import { Agent, type AgentEventSink, type AgentOptions } from "./agent.js";
import { ModelRegistry } from "../routing/registry.js";
import { CheckpointStore } from "../checkpoint/store.js";
import { pickForTier } from "../routing/router.js";
import { subagentTierFor } from "../routing/handoff.js";
import * as tools from "./tools.js";
import type { ModelDescriptor, ModelTier } from "../protocol/protocol.js";
import type { ProcessStep, TodoItem } from "../protocol/process.js";
export interface SubagentSpec {
  name: string;
  instructions: string;
  tier?: ModelTier;
  modelId?: string;
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
  ) {}
  async run(
    spec: SubagentSpec,
    parent: ModelDescriptor,
    ctx: AgentOptions["toolContext"] & { root: string },
  ): Promise<SubagentResult> {
    const tier = spec.tier ?? subagentTierFor(parent);
    const model = spec.modelId ? this.registry.get(spec.modelId) : pickForTier(this.registry, tier);
    if (!model) {
      return { ok: false, output: `No model available for tier ${tier}.`, steps: [], todo: [] };
    }
    if (!this.registry.providersFor(model.id).length) {
      return { ok: false, output: `Model ${model.label} has no enabled providers.`, steps: [], todo: [] };
    }
    this.registry.setCurrent(model.id);
    const collected: ProcessStep[] = [];
    const todos: TodoItem[] = [];
    const sink: AgentEventSink = {
message: () => {  },
      steps: (steps) => {
        collected.length = 0;
        collected.push(...steps);
      },
turnStart: () => {  },
turnEnd: () => {  },
usage: () => {  },
handoff: () => {  },
      todo: (items) => { todos.length = 0; todos.push(...items); },
clarification: () => {  },
done: () => {  },
error: () => {  },
compaction: () => {  },
    };
    const agent = new Agent(this.registry, this.store, sink, {
      systemPrompt: spec.instructions,
      enabledTools: new Set(Object.keys(tools.tools)),
      workspaceRoot: ctx.root,
      isMain: false,
      ownerTier: tier,
      toolContext: ctx,
    });
    await agent.send(spec.instructions);
    const finalText = agent.getMessages().filter((m) => m.role === "assistant").slice(-1)[0]?.content ?? "";
    return { ok: true, output: finalText, steps: collected, todo: todos };
  }
}
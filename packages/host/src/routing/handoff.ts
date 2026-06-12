import type { ModelDescriptor, ModelTier } from "../protocol/protocol.js";
import { pickForTier } from "../routing/router.js";
import type { ModelRegistry } from "../routing/registry.js";
export type HandoffDirection = "escalate" | "de-escalate";
export interface HandoffPolicy {
  maxEscalations: number;
  costCeiling: number;
  confidenceThreshold: number;
}
export const defaultPolicy: HandoffPolicy = {
  maxEscalations: 3,
  costCeiling: 5.0,
  confidenceThreshold: 0.4,
};
export interface HandoffRecord {
  turnId: string;
  direction: HandoffDirection;
  fromModelId: string;
  toModelId: string;
  reason: string;
  ts: number;
  costIncurred: number;
}
export function nextModelForHandoff(
  registry: ModelRegistry,
  current: ModelDescriptor,
  direction: HandoffDirection,
  _policy: HandoffPolicy = defaultPolicy,
): ModelDescriptor | undefined {
  const targetTier: ModelTier | undefined =
    direction === "escalate"
      ? current.tier === "heavy"
        ? undefined
        : current.tier === "default"
          ? "heavy"
          : "default"
      : current.tier === "default"
        ? "light"
        : current.tier === "heavy"
          ? "default"
          : undefined;
  if (!targetTier) return undefined;
  return pickForTier(registry, targetTier);
}
export function subagentTierFor(current: ModelDescriptor, hint?: ModelTier): ModelTier {
  if (hint) return hint;
  const ladder: ModelTier[] = ["heavy", "default", "light", "free"];
  const i = ladder.indexOf(current.tier);
  return ladder[Math.min(i + 1, ladder.length - 1)];
}
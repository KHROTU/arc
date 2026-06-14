import type { ModelDescriptor, ModelTier, ProviderConfig, ProviderRef, TurnUsage } from "../protocol/protocol.js";
import type { ModelRegistry } from "./registry.js";
export interface ProviderCallRequest {
  model: ModelDescriptor;
  provider: ProviderConfig;
  attempt: number;
  skipRecentFailures: boolean;
}
export interface RoutingDecision {
  model: ModelDescriptor;
  provider: ProviderConfig;
  attempt: number;
}
class FailureCache {
  private failedAt = new Map<string, number>(); 
  fail(key: string) {
    this.failedAt.set(key, Date.now());
  }
  clear(key: string) {
    this.failedAt.delete(key);
  }
  isRecentlyFailed(key: string, withinMs = 30_000) {
    const t = this.failedAt.get(key);
    if (!t) return false;
    if (Date.now() - t > withinMs) {
      this.failedAt.delete(key);
      return false;
    }
    return true;
  }
}
const failures = new FailureCache();
export function pickForTier(
  registry: ModelRegistry,
  tier: ModelTier,
  preferModelId?: string,
): ModelDescriptor | undefined {
  if (preferModelId) {
    const m = registry.get(preferModelId);
    if (m && m.tier === tier) return m;
  }
  return registry.firstByTier(tier);
}
export function pickProvider(
  registry: ModelRegistry,
  model: ModelDescriptor,
): { provider: ProviderConfig; ref: ProviderRef } | undefined {
  const refs = registry.providersFor(model.id);
  if (refs.length === 0) return undefined;
  const totalWeight = refs.reduce((s, r) => s + (r.weight ?? 0), 0);
  if (totalWeight > 0) {
    const candidates = refs.filter((r) => !failures.isRecentlyFailed(`${model.id}:${r.id}`));
    const pool = candidates.length ? candidates : refs;
    const w = pool.reduce((s, r) => s + (r.weight ?? 0), 0) || 1;
    let pick = Math.random() * w;
    for (const r of pool) {
      pick -= r.weight ?? 0;
      if (pick <= 0) {
        const p = registry.resolveProvider(r);
        if (p) return { provider: p, ref: r };
      }
    }
  }
  for (const r of refs) {
    if (failures.isRecentlyFailed(`${model.id}:${r.id}`)) continue;
    const p = registry.resolveProvider(r);
    if (p) return { provider: p, ref: r };
  }
  const p = registry.resolveProvider(refs[0]);
  return p ? { provider: p, ref: refs[0] } : undefined;
}
export async function routeWithFailover<T>(
  registry: ModelRegistry,
  model: ModelDescriptor,
  invoke: (decision: RoutingDecision) => Promise<T>,
): Promise<T> {
  const refs = registry.providersFor(model.id);
  if (refs.length === 0) throw new Error(`Model ${model.id} has no enabled providers.`);
  let lastErr: unknown;
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    const p = registry.resolveProvider(r);
    if (!p) continue;
    try {
      const out = await invoke({ model, provider: p, attempt: i });
      failures.clear(`${model.id}:${r.id}`);
      return out;
    } catch (e) {
      lastErr = e;
      failures.fail(`${model.id}:${r.id}`);
    }
  }
  throw new Error(
    `All providers for model ${model.id} failed: ${(lastErr as Error)?.message ?? lastErr}`,
  );
}
export function recordFailure(modelId: string, providerId: string) {
  failures.fail(`${modelId}:${providerId}`);
}
export function recordSuccess(modelId: string, providerId: string) {
  failures.clear(`${modelId}:${providerId}`);
}
export function estimateCost(model: ModelDescriptor, usage: { prompt: number; completion: number; thinking?: number }): number {
  const thinking = usage.thinking ?? 0;
  return (usage.prompt / 1_000_000) * model.costPer1mIn
       + (usage.completion / 1_000_000) * model.costPer1mOut
       + (thinking / 1_000_000) * model.costPer1mOut;
}
export function emptyUsage(): TurnUsage {
  return { prompt: 0, completion: 0, thinking: 0, cost: 0 };
}
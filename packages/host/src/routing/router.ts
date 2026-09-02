import type { ModelDescriptor, ModelTier, ProviderConfig, ProviderRef } from "../protocol/protocol.js";
import type { ModelRegistry } from "./registry.js";
import type { StreamEvent, StreamHandle } from "../providers/transport.js";
import { AsyncEventQueue } from "../util/stream.js";
import { perf } from "./performance.js";
export class StallError extends Error {
  constructor(msg: string, public readonly providerId: string, public readonly timeoutMs: number) {
    super(msg); this.name = "StallError";
  }
}
function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("429") || m.includes("rate limit") || m.includes("too many requests");
}
export type { StreamEvent, StreamHandle };
export interface RoutingDecision {
  model: ModelDescriptor;
  provider: ProviderConfig;
  ref: ProviderRef;
  attempt: number;
}
export function withProviderOverrides(model: ModelDescriptor, ref?: ProviderRef): ModelDescriptor {
  if (!ref) return model;
  return {
    ...model,
    contextWindow: ref.contextWindow ?? model.contextWindow,
    maxOutputTokens: ref.maxOutputTokens ?? model.maxOutputTokens,
    costPer1mIn: ref.costPer1mIn ?? model.costPer1mIn,
    costPer1mOut: ref.costPer1mOut ?? model.costPer1mOut,
  };
}
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
  opts?: { rerank?: boolean },
): { provider: ProviderConfig; ref: ProviderRef } | undefined {
  let refs = registry.providersFor(model.id);
  const len = refs.length;
  if (!len) return undefined;
  if (len === 1) {
    const pr = registry.resolveProvider(refs[0]);
    return pr ? { provider: pr, ref: refs[0] } : undefined;
  }
  if (opts?.rerank) {
    refs = [...refs].sort((a, b) => {
      const d = perf.score(b.id, model.id) - perf.score(a.id, model.id);
      return d !== 0 ? d : a.priority - b.priority;
    });
  }
  const tw = refs.reduce((s, r) => s + (r.weight ?? 0), 0);
  if (tw > 0) {
    const ok: ProviderRef[] = [];
    let okWeight = 0;
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i];
      if (!perf.isOpen(r.id, model.id)) { ok.push(r); okWeight += r.weight ?? 0; }
    }
    const pool = ok.length ? ok : refs;
    const w = ok.length ? okWeight : tw;
    let p = Math.random() * w;
    for (let i = 0; i < pool.length; i++) {
      const r = pool[i];
      p -= r.weight ?? 0;
      if (p <= 0) { const pr = registry.resolveProvider(r); if (pr) return { provider: pr, ref: r }; }
    }
  }
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    if (perf.isOpen(r.id, model.id)) continue;
    const pr = registry.resolveProvider(r);
    if (pr) return { provider: pr, ref: r };
  }
  const pr = registry.resolveProvider(refs[0]);
  return pr ? { provider: pr, ref: refs[0] } : undefined;
}
export function recordFailure(modelId: string, providerId: string): void {
  perf.recordFailure(providerId, modelId);
}
export function recordSuccess(modelId: string, providerId: string): void {
  perf.recordSuccess(providerId, modelId);
}
export function recordStall(modelId: string, providerId: string): void {
  perf.recordStall(providerId, modelId);
}
export function resetFailures(): void { perf.clearCircuitBreakers(); }
function* orderedRefs(registry: ModelRegistry, model: ModelDescriptor, rerank?: boolean): Generator<ProviderRef> {
  const refs = registry.providersFor(model.id);
  if (!refs.length) return;
  const sorted = rerank
    ? [...refs].sort((a, b) => {
        const d = perf.score(b.id, model.id) - perf.score(a.id, model.id);
        return d !== 0 ? d : a.priority - b.priority;
      })
    : refs;
  for (let i = 0; i < sorted.length; i++) yield sorted[i];
}
async function tryEach<T>(
  registry: ModelRegistry,
  model: ModelDescriptor,
  fn: (ref: ProviderRef, prov: ProviderConfig, attempt: number) => Promise<T>,
  opts?: { rerank?: boolean },
): Promise<T> {
  const MAX_RETRIES = 4;
  for (let cycle = 0; cycle <= MAX_RETRIES; cycle++) {
    let lastErr: unknown;
    let attempt = 0;
    let anyRateLimited = false;
    for (const ref of orderedRefs(registry, model, opts?.rerank)) {
      const prov = registry.resolveProvider(ref);
      if (!prov) continue;
      const keys = prov.apiKeys?.length ? prov.apiKeys : prov.apiKey ? [prov.apiKey] : [];
      const effProv = keys.length > 1 ? { ...prov, apiKey: keys[attempt % keys.length] } : prov;
      const t0 = Date.now();
      try {
        const out = await fn(ref, effProv, attempt++);
        perf.recordSuccess(ref.id, model.id, Date.now() - t0);
        return out;
      } catch (e) {
        lastErr = e;
        if ((e as Error)?.name === "AbortError") throw e;
        const msg = (e as Error)?.message ?? String(e);
        if (isRateLimitError(msg)) anyRateLimited = true;
        perf.recordFailure(ref.id, model.id);
        if (e instanceof StallError) perf.recordStall(ref.id, model.id);
      }
    }
    if (!anyRateLimited || cycle >= MAX_RETRIES) {
      throw new Error(`All providers for ${model.id} failed: ${(lastErr as Error)?.message ?? lastErr}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** cycle, 60_000)));
  }
  throw new Error(`All providers for ${model.id} failed after retries`);
}
export async function routeWithFailover<T>(
  registry: ModelRegistry,
  model: ModelDescriptor,
  invoke: (d: RoutingDecision) => Promise<T>,
): Promise<T> {
  return tryEach(registry, model, (r, p, n) => invoke({ model, provider: p, ref: r, attempt: n }));
}
export interface ResilientOptions {
  stallMs?: number;
  firstByteMs?: number;
  rerank?: boolean;
}
const MIN_STALL_MS = 20_000;
const MAX_STALL_MS = 60_000;
const MIN_FB_MS = 30_000;
const MAX_FB_MS = 90_000;
const DEFAULT_STALL_MS = 45_000;
const DEFAULT_FB_MS = 60_000;
function timeoutFor(pid: string, mid: string, userMs: number | undefined, minMs: number, maxMs: number, defaultMs: number): number {
  if (userMs !== undefined) return userMs;
  const lat = perf.latency(pid, mid);
  if (!lat) return defaultMs;
  const adaptive = Math.round(lat * 3);
  return Math.max(minMs, Math.min(maxMs, adaptive));
}
function wrapStall(handle: StreamHandle, pid: string, stallMs: number, firstByteMs: number): StreamHandle {
  const q = new AsyncEventQueue<StreamEvent>();
  let dead = false;
  let sTimer: ReturnType<typeof setTimeout> | undefined;
  let fbTimer: ReturnType<typeof setTimeout> | undefined;
  let got = false;
  const kill = () => { if (sTimer) { clearTimeout(sTimer); sTimer = undefined; } if (fbTimer) { clearTimeout(fbTimer); fbTimer = undefined; } };
  const onStall = () => {
    kill();
    if (dead) return;
    dead = true;
    q.push({ type: "error", message: `Provider ${pid} stalled (${stallMs}ms)` });
    handle.abort();
    q.close();
  };
  const onFirstByteTimeout = () => {
    if (!got && !dead) {
      q.push({ type: "error", message: `Provider ${pid} timed out (${firstByteMs}ms)` });
      handle.abort(); q.close();
    }
  };
  void (async () => {
    try {
      fbTimer = setTimeout(onFirstByteTimeout, firstByteMs);
      for await (const ev of handle.events) {
        if (dead) break;
        if (ev.type === "ping") {
          if (!got) {
            if (fbTimer) { clearTimeout(fbTimer); fbTimer = setTimeout(onFirstByteTimeout, firstByteMs); }
          } else if (sTimer) {
            clearTimeout(sTimer);
            sTimer = setTimeout(onStall, stallMs);
          }
          continue;
        }
        if (!got) { got = true; if (fbTimer) { clearTimeout(fbTimer); fbTimer = undefined; } }
        q.push(ev);
        if (ev.type === "done" || ev.type === "error") { kill(); q.close(); return; }
        if (sTimer) clearTimeout(sTimer);
        sTimer = setTimeout(onStall, stallMs);
      }
    } catch (e) {
      if (!dead) q.push({ type: "error", message: (e as Error).message });
    } finally { kill(); q.close(); }
  })();
  return { events: q, abort: () => { dead = true; kill(); handle.abort(); q.close(); } };
}
export async function routeStream(
  registry: ModelRegistry,
  model: ModelDescriptor,
  create: (d: RoutingDecision) => Promise<StreamHandle>,
  opts?: ResilientOptions,
): Promise<StreamHandle> {
  return tryEach(registry, model, async (ref, prov, n) => {
    const stallMs = timeoutFor(ref.id, model.id, opts?.stallMs, MIN_STALL_MS, MAX_STALL_MS, DEFAULT_STALL_MS);
    const fbMs = timeoutFor(ref.id, model.id, opts?.firstByteMs, MIN_FB_MS, MAX_FB_MS, DEFAULT_FB_MS);
    const raw = await create({ model, provider: prov, ref, attempt: n });
    return wrapStall(raw, ref.id, stallMs, fbMs);
  }, { rerank: opts?.rerank });
}
export function estimateCost(model: ModelDescriptor, usage: { prompt: number; completion: number; thinking?: number }, ref?: Pick<ProviderRef, "costPer1mIn" | "costPer1mOut">): number {
  const t = usage.thinking ?? 0;
  const per1mIn = ref?.costPer1mIn ?? model.costPer1mIn;
  const per1mOut = ref?.costPer1mOut ?? model.costPer1mOut;
  return (usage.prompt / 1_000_000) * per1mIn + (usage.completion / 1_000_000) * per1mOut + (t / 1_000_000) * per1mOut;
}
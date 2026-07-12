import { describe, it, expect, beforeEach } from "vitest";
import { ModelRegistry } from "../src/routing/registry";
import { pickProvider, routeWithFailover, routeStream, recordFailure, recordSuccess, resetFailures, StallError } from "../src/routing/router";
import { perf } from "../src/routing/performance";
import { AsyncEventQueue } from "../src/util/stream";
import type { ModelDescriptor, ProviderConfig } from "../src/protocol/protocol";
import type { StreamEvent, StreamHandle } from "../src/providers/transport";
function makeModel(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: "m1", label: "Test", tier: "default", contextWindow: 8000, costPer1mIn: 0, costPer1mOut: 0,
    providers: [
      { id: "p1", kind: "openai-compatible", priority: 0 },
      { id: "p2", kind: "openai-compatible", priority: 1 },
      { id: "p3", kind: "openai-compatible", priority: 2 },
    ],
    ...overrides,
  };
}
function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { id: "p1", kind: "openai-compatible", label: "p1", enabled: true, ...overrides };
}
function makeStream(events: StreamEvent[]): StreamHandle {
  const q = new AsyncEventQueue<StreamEvent>();
  void (async () => {
    for (const ev of events) { q.push(ev); await new Promise((r) => setTimeout(r, 1)); }
    q.close();
  })();
  return { events: q, abort: () => q.close() };
}
beforeEach(() => { perf.resetAll(); });
describe("ModelRegistry", () => {
  it("returns current model and falls back to a tier default", () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel({ id: "a", tier: "light" })], providers: [makeProvider()] });
    expect(r.getCurrent()?.id).toBe("a");
    r.load({
      models: [makeModel({ id: "a", tier: "light" }), makeModel({ id: "b", tier: "default" })],
      providers: [makeProvider()],
    });
    expect(r.getCurrent()?.id).toBe("b");
  });
  it("removes provider refs from models when provider is removed", () => {
    const r = new ModelRegistry();
    const refs = [{ id: "p1", kind: "openai-compatible" as const, priority: 0 }, { id: "p2", kind: "openai-compatible" as const, priority: 1 }];
    r.load({ models: [makeModel({ providers: refs })], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    r.removeProvider("p1");
    expect(r.get("m1")!.providers).toHaveLength(1);
  });
});
describe("pickProvider", () => {
  it("returns highest-priority enabled provider", () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    expect(pickProvider(r, r.get("m1")!)?.provider.id).toBe("p1");
  });
  it("skips disabled providers", () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1", enabled: false }), makeProvider({ id: "p2" })] });
    expect(pickProvider(r, r.get("m1")!)?.provider.id).toBe("p2");
  });
  it("reranks by performance when option set", () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" }), makeProvider({ id: "p3" })] });
    perf.recordFailure("p1", "m1"); perf.recordFailure("p1", "m1"); perf.recordFailure("p1", "m1"); perf.recordStall("p1", "m1");
    perf.recordSuccess("p2", "m1", 100); perf.recordSuccess("p2", "m1", 120);
    expect(pickProvider(r, r.get("m1")!, { rerank: true })?.provider.id).toBe("p2");
  });
  it("fast-paths single provider", () => {
    const r = new ModelRegistry();
    const refs = [{ id: "p1", kind: "openai-compatible" as const, priority: 0 }];
    r.load({ models: [makeModel({ providers: refs })], providers: [makeProvider({ id: "p1" })] });
    expect(pickProvider(r, r.get("m1")!)?.provider.id).toBe("p1");
  });
});
describe("routeWithFailover", () => {
  it("fails over to next provider on error", async () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    let n = 0;
    expect(await routeWithFailover(r, r.get("m1")!, async (d) => { n++; if (d.provider.id === "p1") throw new Error("nope"); return "ok"; })).toBe("ok");
    expect(n).toBe(2);
  });
  it("throws if all fail", async () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    await expect(routeWithFailover(r, r.get("m1")!, async () => { throw new Error("always"); })).rejects.toThrow(/All providers/);
  });
  it("tracks stalls in performance", async () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    try { await routeWithFailover(r, r.get("m1")!, async () => { throw new StallError("stalled", "p1", 5000); }); } catch {}
    expect(perf.score("p1", "m1")).toBeLessThan(90);
  });
});
describe("routeStream", () => {
  it("returns stream on success", async () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" })] });
    const h = await routeStream(r, r.get("m1")!, async () => makeStream([{ type: "text", delta: "hello" }, { type: "done" }]));
    const evs: StreamEvent[] = [];
    for await (const e of h.events) evs.push(e);
    expect(evs.some((e) => e.type === "text")).toBe(true);
  });
  it("fails over on createStream error", async () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    let n = 0;
    const h = await routeStream(r, r.get("m1")!, async (d) => { n++; if (d.provider.id === "p1") throw new Error("nope"); return makeStream([{ type: "text", delta: "ok" }, { type: "done" }]); });
    expect(n).toBe(2);
    const evs: StreamEvent[] = [];
    for await (const e of h.events) evs.push(e);
    expect(evs.some((e) => e.type === "text")).toBe(true);
  });
  it("throws if all providers fail", async () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    await expect(routeStream(r, r.get("m1")!, async () => { throw new Error("always"); })).rejects.toThrow(/All providers/);
  });
  it("abort propagates to underlying stream", async () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" })] });
    let aborted = false;
    const h = await routeStream(r, r.get("m1")!, async () => ({
      events: (async function* () { yield { type: "text", delta: "x" }; await new Promise(() => {}); })(),
      abort: () => { aborted = true; },
    }));
    h.abort();
    expect(aborted).toBe(true);
  });
  it("reranks on option", async () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    perf.recordFailure("p1", "m1"); perf.recordFailure("p1", "m1"); perf.recordFailure("p1", "m1");
    perf.recordSuccess("p2", "m1", 50);
    let used = "";
    await routeStream(r, r.get("m1")!, async (d) => { used = d.provider.id; return makeStream([{ type: "text", delta: "ok" }, { type: "done" }]); }, { rerank: true });
    expect(used).toBe("p2");
  });
  it("ping events keep a slow tool-call stream alive past the stall window", async () => {
    const r = new ModelRegistry();
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" })] });
    const q = new AsyncEventQueue<StreamEvent>();
    void (async () => {
      q.push({ type: "text", delta: "start" });
      for (let i = 0; i < 30; i++) {
        await new Promise((res) => setTimeout(res, 30));
        q.push({ type: "ping" });
      }
      q.push({ type: "tool_call", id: "c1", name: "file.write", args: { path: "a" } });
      q.push({ type: "done" });
      q.close();
    })();
    const h = await routeStream(r, r.get("m1")!, async () => ({ events: q, abort: () => q.close() }), { stallMs: 100, firstByteMs: 1000 });
    const evs: StreamEvent[] = [];
    for await (const e of h.events) evs.push(e);
    expect(evs.some((e) => e.type === "error")).toBe(false);
    expect(evs.some((e) => e.type === "tool_call")).toBe(true);
    expect(evs.some((e) => e.type === "ping")).toBe(false);
  });
});
describe("recordFailure / recordSuccess", () => {
  it("recordFailure opens circuit breaker", () => {
    const r = new ModelRegistry();
    const refs = [{ id: "p1", kind: "openai-compatible" as const, priority: 0 }, { id: "p2", kind: "openai-compatible" as const, priority: 1 }];
    r.load({ models: [makeModel({ providers: refs })], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    expect(pickProvider(r, r.get("m1")!)?.provider.id).toBe("p1");
    recordFailure("m1", "p1");
    expect(pickProvider(r, r.get("m1")!)?.provider.id).toBe("p2");
  });
  it("recordSuccess closes circuit breaker", () => {
    const r = new ModelRegistry();
    const refs = [{ id: "p1", kind: "openai-compatible" as const, priority: 0 }, { id: "p2", kind: "openai-compatible" as const, priority: 1 }];
    r.load({ models: [makeModel({ providers: refs })], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    recordFailure("m1", "p1");
    recordSuccess("m1", "p1");
    expect(pickProvider(r, r.get("m1")!)?.provider.id).toBe("p1");
  });
});
describe("PerformanceTracker", () => {
  it("default score for unknown", () => { expect(perf.score("x", "y")).toBe(90); });
  it("latency starts at 0 for unknown", () => { expect(perf.latency("x", "y")).toBe(0); });
  it("failure lowers score", () => {
    perf.recordFailure("p1", "m1");
    const afterOne = perf.score("p1", "m1");
    expect(afterOne).toBeLessThan(90);
    perf.recordFailure("p1", "m1");
    expect(perf.score("p1", "m1")).toBeLessThan(afterOne);
  });
  it("stall lowers score", () => {
    perf.recordStall("p1", "m1"); perf.recordStall("p1", "m1");
    expect(perf.score("p1", "m1")).toBeLessThan(80);
  });
  it("success decays failure rate and improves score", () => {
    perf.recordFailure("p1", "m1"); perf.recordFailure("p1", "m1");
    const afterFail = perf.score("p1", "m1");
    perf.recordSuccess("p1", "m1", 100);
    perf.recordSuccess("p1", "m1", 100);
    perf.recordSuccess("p1", "m1", 100);
    expect(perf.score("p1", "m1")).toBeGreaterThan(afterFail);
  });
  it("consecutive failure ttl grows, resets on success", () => {
    expect(perf.ttl("p1", "m1")).toBe(0);
    perf.recordFailure("p1", "m1");
    expect(perf.ttl("p1", "m1")).toBe(15_000);
    perf.recordFailure("p1", "m1");
    expect(perf.ttl("p1", "m1")).toBe(30_000);
    perf.recordSuccess("p1", "m1");
    expect(perf.ttl("p1", "m1")).toBe(0);
  });
  it("circuit breaker closes immediately on success", () => {
    perf.recordFailure("p1", "m1");
    expect(perf.isOpen("p1", "m1")).toBe(true);
    perf.recordSuccess("p1", "m1");
    expect(perf.isOpen("p1", "m1")).toBe(false);
  });
  it("latency EMA is tracked", () => {
    expect(perf.latency("p1", "m1")).toBe(0);
    perf.recordSuccess("p1", "m1", 200);
    const lat = perf.latency("p1", "m1");
    expect(lat).toBeGreaterThan(0);
    expect(lat).toBeLessThan(300);
  });
  it("scores recover after consecutive successes", () => {
    for (let i = 0; i < 5; i++) perf.recordFailure("p1", "m1");
    const badScore = perf.score("p1", "m1");
    for (let i = 0; i < 10; i++) perf.recordSuccess("p1", "m1", 100);
    expect(perf.score("p1", "m1")).toBeGreaterThan(badScore + 30);
  });
  it("reset clears", () => { perf.recordFailure("p1", "m1"); perf.resetAll(); expect(perf.score("p1", "m1")).toBe(90); });
});
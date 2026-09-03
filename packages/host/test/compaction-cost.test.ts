import { describe, it, expect } from "vitest";
import { compactionCostTarget, decideCompaction, CompactionTracker } from "../src/compaction/compaction";
import { costBreakdown, estimateCost } from "../src/routing/router";
import type { ChatMessage, ModelDescriptor } from "../src/protocol/protocol";
const m = (id: string, role: ChatMessage["role"], content: string, ts: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, content, ts, ...extra });
const paid: ModelDescriptor = { id: "p1", label: "Paid", tier: "default", contextWindow: 200_000, costPer1mIn: 3, costPer1mOut: 15, costPer1mCacheRead: 0.3, providers: [] };
const free: ModelDescriptor = { id: "p2", label: "Free", tier: "default", contextWindow: 200_000, costPer1mIn: 0, costPer1mOut: 0, providers: [] };
const cfg = { safetyMargin: 0.15, enforce: true, keepTail: 6, frictionCost: 0, lostContextPenalty: 0 };
function warmTracker(modelId: string, hitRate: number, avgUser: number, avgOutput: number): CompactionTracker {
  const t = new CompactionTracker();
  for (let i = 0; i < 60; i++) t.observe(modelId, { prompt: 100_000, completion: avgOutput * 0.8, thinking: avgOutput * 0.2, cacheRead: 100_000 * hitRate }, avgUser);
  return t;
}
describe("compactionCostTarget", () => {
  it("returns undefined for free models or cold trackers", () => {
    expect(compactionCostTarget([], free, warmTracker("x", 0.9, 500, 2500).for("x"), cfg, 150_000)).toBeUndefined();
    expect(compactionCostTarget([], paid, undefined, cfg, 150_000)).toBeUndefined();
    const cold = new CompactionTracker();
    expect(compactionCostTarget([], paid, cold.for("x"), cfg, 150_000)).toBeUndefined();
  });
  it("computes the EOQ formula with cache-weighted carrying price", () => {
    const stats = warmTracker("x", 0.9, 500, 2500).for("x")!;
    const target = compactionCostTarget([], paid, stats, cfg, 156_073)!;
    const p = stats.avgHitRate * 0.3e-6 + (1 - stats.avgHitRate) * 3e-6;
    const mTurn = stats.avgUser + stats.avgOutput;
    expect(target.s0).toBe(1024);
    expect(target.p).toBe(p);
    expect(target.m).toBe(mTurn);
    const expectedTStar = Math.sqrt((2 * (p * 1024 + 15e-6 * 1024)) / (p * mTurn));
    expect(target.tStar).toBeCloseTo(expectedTStar, 9);
    const expectedTMax = Math.floor(Math.max(0, 156_073 - 1024) / mTurn);
    expect(target.tMax).toBe(expectedTMax);
    expect(target.tOpt).toBe(Math.min(Math.max(expectedTStar, 1), Math.max(1, expectedTMax)));
    expect(target.nCompact).toBe(Math.ceil(1024 + target.tOpt * mTurn));
  });
  it("friction F pushes compaction later; lost-context penalty beta pushes it sooner", () => {
    const stats = warmTracker("x", 0.9, 500, 2500).for("x")!;
    const base = compactionCostTarget([], paid, stats, cfg, 156_073)!;
    const withFriction = compactionCostTarget([], paid, stats, { ...cfg, frictionCost: 0.02 }, 156_073)!;
    expect(withFriction.tStar).toBeGreaterThan(base.tStar);
    const withBeta = compactionCostTarget([], paid, stats, { ...cfg, lostContextPenalty: 20e-6 }, 156_073)!;
    expect(withBeta.tStar).toBeLessThan(base.tStar);
  });
  it("clamps T_opt to the hard-limit turn budget", () => {
    const stats = warmTracker("x", 0.0, 100, 500).for("x")!;
    const target = compactionCostTarget([], paid, stats, cfg, 2_000)!;
    expect(target.tMax).toBeLessThan(target.tStar);
    expect(target.tOpt).toBe(target.tMax);
    expect(target.nCompact).toBeLessThanOrEqual(2_000);
  });
});
describe("decideCompaction cost-optimal layer", () => {
  it("compacts earlier than the hard limit when the cost model says so", () => {
    const tracker = warmTracker("p1", 0.9, 500, 2500);
    const d = decideCompaction([], paid, tracker, cfg, 100_000);
    expect(d.shouldCompact).toBe(true);
    expect(d.reason).toContain("cost-optimal");
    const dLow = decideCompaction([], paid, tracker, cfg, 5_000);
    expect(dLow.shouldCompact).toBe(false);
  });
  it("defers the cost optimum until usage passes half the usable window", () => {
    const tracker = warmTracker("p1", 0.9, 500, 2500);
    const d = decideCompaction([], paid, tracker, cfg, 20_000);
    expect(d.shouldCompact).toBe(false);
    expect(d.reason).toContain("deferred");
    const dFloor = decideCompaction([], paid, tracker, cfg, 80_000);
    expect(dFloor.shouldCompact).toBe(true);
    expect(dFloor.reason).toContain("cost-optimal");
  });
  it("never cost-compacts a 1M-window model after a handful of messages", () => {
    const big: ModelDescriptor = { ...paid, id: "big", contextWindow: 1_048_576 };
    const tracker = warmTracker("big", 0.9, 2000, 8000);
    for (const usage of [12_000, 40_000, 120_000, 300_000]) {
      expect(decideCompaction([], big, tracker, cfg, usage).shouldCompact).toBe(false);
    }
    expect(decideCompaction([], big, tracker, cfg, 500_000).shouldCompact).toBe(true);
  });
  it("hard limit still wins at the boundary and free models keep threshold-only behavior", () => {
    const tracker = warmTracker("p1", 0.9, 500, 2500);
    const dHard = decideCompaction([], paid, tracker, cfg, 160_000);
    expect(dHard.shouldCompact).toBe(true);
    expect(dHard.reason).toContain(">= limit");
    const dFree = decideCompaction([], free, tracker, cfg, 159_000);
    expect(dFree.shouldCompact).toBe(true);
    expect(dFree.reason).toContain(">= limit");
    const dFreeLow = decideCompaction([], free, tracker, cfg, 100_000);
    expect(dFreeLow.shouldCompact).toBe(false);
  });
});
describe("costBreakdown", () => {
  const pricing = { costPer1mIn: 3, costPer1mOut: 15, costPer1mCacheRead: 0.3, costPer1mCacheWrite: 3.75 };
  it("matches estimateCost when no cache split is reported", () => {
    const usage = { prompt: 1_000_000, completion: 100_000 };
    const bd = costBreakdown(pricing, usage);
    expect(bd.plainInput).toBeCloseTo(3, 9);
    expect(bd.output).toBeCloseTo(1.5, 9);
    expect(bd.total).toBeCloseTo(estimateCost({ ...pricing, id: "x", label: "x", tier: "default", contextWindow: 1, providers: [] }, usage), 9);
  });
  it("bills cache hits at the cache-read price and misses at the input price", () => {
    const bd = costBreakdown(pricing, { prompt: 1_000_000, completion: 100_000, cacheRead: 800_000 });
    expect(bd.cacheRead).toBeCloseTo(0.8 * 0.3, 9);
    expect(bd.plainInput).toBeCloseTo(0.2 * 3, 9);
    expect(bd.cacheWrite).toBe(0);
    expect(bd.total).toBeCloseTo(0.24 + 0.6 + 1.5, 9);
  });
  it("bills Anthropic-style cache writes at the write price, remaining uncached input at the input price", () => {
    const bd = costBreakdown(pricing, { prompt: 1_000_000, completion: 100_000, cacheRead: 800_000, cacheWrite: 100_000 });
    expect(bd.cacheRead).toBeCloseTo(0.8 * 0.3, 9);
    expect(bd.cacheWrite).toBeCloseTo(0.1 * 3.75, 9);
    expect(bd.plainInput).toBeCloseTo(0.1 * 3, 9);
    expect(bd.total).toBeCloseTo(0.24 + 0.375 + 0.3 + 1.5, 9);
  });
  it("falls back to the input price when cache prices are unknown and clamps overflows", () => {
    const noCachePrices = { costPer1mIn: 3, costPer1mOut: 15 };
    const bd = costBreakdown(noCachePrices, { prompt: 1_000_000, completion: 0, cacheRead: 500_000 });
    expect(bd.total).toBeCloseTo(3, 9);
    const clamped = costBreakdown(pricing, { prompt: 100_000, completion: 0, cacheRead: 900_000 });
    expect(clamped.cacheRead).toBeCloseTo(0.1 * 0.3, 9);
    expect(clamped.plainInput).toBe(0);
  });
  it("honors provider-ref price overrides", () => {
    const ref = { costPer1mIn: 10, costPer1mOut: 30, costPer1mCacheRead: 1, costPer1mCacheWrite: 12 };
    const bd = costBreakdown(pricing, { prompt: 1_000_000, completion: 0, cacheRead: 400_000, cacheWrite: 200_000 }, ref);
    expect(bd.cacheRead).toBeCloseTo(0.4, 9);
    expect(bd.cacheWrite).toBeCloseTo(0.2 * 12, 9);
    expect(bd.plainInput).toBeCloseTo(0.4 * 10, 9);
  });
});
describe("CompactionTracker cache/user EMAs", () => {
  it("tracks hit rate, user tokens, and summary sizes", () => {
    const t = new CompactionTracker();
    for (let i = 0; i < 4; i++) t.observe("k", { prompt: 1000, completion: 100, thinking: 0, cacheRead: 900 }, 200);
    const s = t.for("k")!;
    expect(s.avgHitRate).toBeCloseTo(0.9 * (1 - Math.pow(0.8, 4)), 12);
    expect(s.avgUser).toBeCloseTo(200 * (1 - Math.pow(0.8, 4)), 12);
    expect(s.avgSummary).toBe(0);
    t.noteSummary("k", 500);
    expect(t.for("k")!.avgSummary).toBe(500);
    t.noteSummary("k", 1000);
    expect(t.for("k")!.avgSummary).toBeGreaterThan(500);
  });
});
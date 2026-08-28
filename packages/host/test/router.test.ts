import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadDifficultyModel, estimateDifficulty } from "../src/router/tfidf.js";
import { routePrompt, tierFallbackScore, qualityForPreset, ROUTER_QUALITY_PRESETS } from "../src/router/route.js";
import { loadCalibrationModel, loadCapabilityModel, requiredScore } from "../src/router/calibration.js";
import { loadDomainModel, classifyDomain, domainScores } from "../src/router/domain.js";
import { lookupIntelligence, matchIntelligence, AA_INTELLIGENCE } from "../src/router/aa.js";
import type { DifficultyModel } from "../src/router/tfidf.js";
import type { CalibrationModel, CapabilityModel } from "../src/router/calibration.js";
import type { DomainModel, DomainModelJson } from "../src/router/domain.js";
const RES = path.resolve(__dirname, "..", "..", "arc", "resources", "router");
const MODEL_PATH = path.join(RES, "difficulty.json");
function loadModel(): DifficultyModel {
  return loadDifficultyModel(JSON.parse(fs.readFileSync(MODEL_PATH, "utf8")) as DifficultyModel);
}
function loadCalib(): CalibrationModel {
  return loadCalibrationModel(JSON.parse(fs.readFileSync(path.join(RES, "calibration.json"), "utf8")) as CalibrationModel);
}
function loadCaps(): CapabilityModel {
  return loadCapabilityModel(JSON.parse(fs.readFileSync(path.join(RES, "capability.json"), "utf8")) as CapabilityModel);
}
function loadDomains(): DomainModel {
  return loadDomainModel(JSON.parse(fs.readFileSync(path.join(RES, "domain.json"), "utf8")) as DomainModelJson);
}
const REFERENCES: Array<[string, number]> = [
  ["explain what a monad is in Haskell", 0.43506],
  ["add a try catch around this async call", 0.28396],
  ["what is 2+2", 0.86873],
  ["refactor this class to use dependency injection", 0.29538],
  ["write a quick hello world", 0.42288],
  ["fix the null pointer in the payment service and add tests", 0.25549],
  ["int x = 5;", 0.29774],
  ["why did the tests fail after i changed the mock", 0.44061],
  ["migrate the database schema and write a rollback script", 0.25825],
  ["translate this docstring to french", 0.32485],
  ["prove that the square root of 2 is irrational", 0.54061],
  ["rename the variable and update all usages", 0.16822],
  ["create a react component that fetches data", 0.39005],
  ["this prompt has nothing to do with code at all really", 0.25277],
  ["explain the difference between tcp and udp sockets", 0.22334],
];
describe("router tfidf", () => {
  it("reproduces sklearn difficulty probabilities", () => {
    const model = loadModel();
    for (const [text, ref] of REFERENCES) {
      const mine = estimateDifficulty(text, model);
      expect(Math.abs(mine - ref)).toBeLessThan(1e-4);
    }
  });
});
describe("router policy", () => {
  const fleet = [
    { modelId: "free", score: 20, cost: 0.1 },
    { modelId: "light", score: 30, cost: 1 },
    { modelId: "default", score: 45, cost: 10 },
    { modelId: "heavy", score: 60, cost: 100 },
  ];
  it("escalates quality bias for an easy prompt", () => {
    const model = loadModel();
    const easy = "what is 2+2"; 
    expect(routePrompt(easy, model, fleet, { qualityBias: "prefer-cheap" }).modelId).toBe("free");
    expect(routePrompt(easy, model, fleet, { qualityBias: "off" }).modelId).toBe("free");
    expect(routePrompt(easy, model, fleet, { qualityBias: "prefer-powerful" }).modelId).toBe("light");
  });
  it("picks the cheapest clearing model for a hard prompt", () => {
    const model = loadModel();
    const hard = "prove that the square root of 2 is irrational"; 
    expect(routePrompt(hard, model, fleet, { qualityBias: "off" }).modelId).toBe("default");
    const d = routePrompt(hard, model, fleet, { qualityBias: "off" });
    expect(d.scored).toBeGreaterThanOrEqual(d.requiredScore);
    expect(routePrompt(hard, model, fleet, { qualityBias: "prefer-cheap" }).modelId).toBe("light");
  });
  it("never exceeds the strongest fleet model", () => {
    const model = loadModel();
    const tiny = [{ modelId: "light", score: 25, cost: 1 }];
    expect(routePrompt("some prompt", model, tiny, { qualityBias: "prefer-powerful" }).modelId).toBe("light");
  });
  it("breaks cost ties toward the weakest sufficient model", () => {
    const model = loadModel();
    const ties = [
      { modelId: "a", score: 20, cost: 0 },
      { modelId: "b", score: 30, cost: 0 },
      { modelId: "c", score: 40, cost: 0 },
    ];
    expect(routePrompt("what is 2+2", model, ties, { qualityBias: "prefer-cheap" }).modelId).toBe("a");
    expect(routePrompt("prove that the square root of 2 is irrational", model, ties, { qualityBias: "off" }).modelId).toBe("c");
  });
  it("falls back to the strongest model when nothing clears the bar", () => {
    const model = loadModel();
    const weak = [
      { modelId: "x", score: 8, cost: 0 },
      { modelId: "y", score: 12, cost: 0 },
    ];
    expect(routePrompt("what is 2+2", model, weak, { qualityBias: "off" }).modelId).toBe("y");
  });
  it("falls back by tier for unknown models", () => {
    expect(tierFallbackScore("heavy")).toBeGreaterThan(tierFallbackScore("default"));
    expect(tierFallbackScore("default")).toBeGreaterThan(tierFallbackScore("light"));
    expect(tierFallbackScore("light")).toBeGreaterThan(tierFallbackScore("free"));
  });
});
describe("router quality preset", () => {
  it("merges bias + quality into one understandable preset", () => {
    expect(ROUTER_QUALITY_PRESETS.balanced.bias).toBe("off");
    expect(ROUTER_QUALITY_PRESETS.balanced.qualityDelta).toBe(0);
    expect(ROUTER_QUALITY_PRESETS.economy.bias).toBe("prefer-cheap");
    expect(ROUTER_QUALITY_PRESETS.power.bias).toBe("prefer-powerful");
  });
  it("qualityForPreset is monotone in power and clamped to [0.6, 0.95]", () => {
    const qEco = qualityForPreset("economy", "high");
    const qBal = qualityForPreset("balanced", "high");
    const qPow = qualityForPreset("power", "high");
    expect(qEco).toBeLessThan(qBal);
    expect(qBal).toBeLessThan(qPow);
    for (const p of ["balanced", "economy", "power"] as const) {
      expect(qualityForPreset(p, "max")).toBeLessThanOrEqual(0.95);
      expect(qualityForPreset(p, "none")).toBeGreaterThanOrEqual(0.6);
    }
  });
});
describe("router v2 calibration", () => {
  it("produces a graded, domain-aware required score", () => {
    const calib = loadCalib();
    const caps = loadCaps();
    const easy = requiredScore(0.85, "code", calib, caps, 0.8);
    const hard = requiredScore(0.1, "code", calib, caps, 0.8);
    expect(hard).toBeGreaterThan(easy);
    const agenticMod = requiredScore(0.5, "agentic", calib, caps, 0.8);
    const codeMod = requiredScore(0.5, "code", calib, caps, 0.8);
    expect(agenticMod).toBeGreaterThanOrEqual(codeMod);
    expect(requiredScore(0.5, "reasoning", calib, caps, 0.9)).toBeGreaterThanOrEqual(
      requiredScore(0.5, "reasoning", calib, caps, 0.7),
    );
    const g = requiredScore(0.5, "general", calib, caps, 0.8);
    expect(g).toBeGreaterThanOrEqual(14);
    expect(g).toBeLessThanOrEqual(63);
  });
  it("classifies prompts into domains", () => {
    const dom = loadDomains();
    const code = classifyDomain("fix the null pointer in the payment service and add tests", dom);
    expect(dom.classes).toContain(code);
    const agentic = classifyDomain("book a flight from new york to london for next friday and confirm the total", dom);
    expect(agentic).toBe("agentic");
    expect(domainScores("what is 2+2", dom)).toBeTruthy();
  });
  it("is latency/health aware when scores are tied", () => {
    const model = loadModel();
    const calib = loadCalib();
    const caps = loadCaps();
    const ctx = { calibration: calib, capability: caps };
    const fleet = [
      { modelId: "slow-weak", score: 45, cost: 0, latencyMs: 11000, health: 100 },
      { modelId: "fast-strong", score: 48, cost: 0, latencyMs: 2000, health: 100 },
      { modelId: "fast-weak", score: 40, cost: 0, latencyMs: 1500, health: 100 },
    ];
    const easy = routePrompt("what is 2+2", model, fleet, ctx, { quality: 0.8 });
    expect(easy.modelId).toBe("fast-weak");
    const hard = routePrompt("implement a garbage collector with precise stack scanning and handle all edge cases", model, fleet, ctx, { quality: 0.8 });
    expect(hard.requiredScore).toBeGreaterThan(45);
    expect(hard.modelId).toBe("fast-strong");
  });
  it("down-ranks unhealthy (flaky) models", () => {
    const model = loadModel();
    const ctx = { calibration: loadCalib(), capability: loadCaps() };
    const fleet = [
      { modelId: "healthy", score: 52, cost: 0, latencyMs: 2000, health: 100 },
      { modelId: "flaky", score: 60, cost: 0, latencyMs: 2000, health: 8 },
    ];
    const hard = routePrompt("implement a garbage collector with precise stack scanning and handle all edge cases", model, fleet, ctx, { quality: 0.8 });
    expect(hard.requiredScore).toBeGreaterThan(45);
    expect(hard.modelId).toBe("healthy");
  });
  it("excludes unscored models (score 0) from selection", () => {
    const model = loadModel();
    const ctx = { calibration: loadCalib(), capability: loadCaps() };
    const fleet = [
      { modelId: "unknown", score: 0, cost: 0 },
      { modelId: "real", score: 45, cost: 0 },
    ];
    const r = routePrompt("what is 2+2", model, fleet, ctx, { quality: 0.8 });
    expect(r.modelId).toBe("real");
  });
  it("per-user tau raises the bar", () => {
    const model = loadModel();
    const ctx = { calibration: loadCalib(), capability: loadCaps() };
    const fleet = [
      { modelId: "light", score: 34, cost: 0, latencyMs: 1500, health: 100 },
      { modelId: "strong", score: 52, cost: 0, latencyMs: 2500, health: 100 },
    ];
    const hard = "prove that the square root of 2 is irrational";
    const noTau = routePrompt(hard, model, fleet, ctx, { quality: 0.8 });
    const withTau = routePrompt(hard, model, fleet, ctx, { quality: 0.8, tau: 6 });
    expect(withTau.requiredScore).toBeGreaterThan(noTau.requiredScore);
  });
});
describe("router aa list", () => {
  it("matches configured model ids and labels", () => {
    expect(lookupIntelligence("glm-5-2")?.score).toBe(53);
    expect(lookupIntelligence("deepseek-v4-flash")?.score).toBe(52);
    expect(lookupIntelligence("whatever", "Claude Opus 5")?.score).toBe(63);
    expect(lookupIntelligence("unknown-model")).toBeUndefined();
  });
  it("consolidates versioned releases into the base slug", () => {
    expect(lookupIntelligence("deepseek-v4-flash-0731")?.slug).toBe("deepseek-v4-flash");
    expect(lookupIntelligence("deepseek-v4-flash-0731")?.score).toBe(52);
    expect(AA_INTELLIGENCE.some((e) => e.slug === "deepseek-v4-flash-0731")).toBe(false);
  });
  it("fuzzy-matches suffixed ids and approximate labels", () => {
    expect(matchIntelligence("gemma-4-31b-mr204qvj", "Gemma 4 31B")?.confidence).toBe(1);
    const nemotron = matchIntelligence("nemotron-3-nano-mqwcj2ru", "Nemotron 3 Nano");
    expect(nemotron?.entry.name).toBe("Nemotron 3 Nano");
    expect(nemotron!.confidence).toBeGreaterThan(0.5);
    const sonnet = matchIntelligence("claude-sonnet-4-5", "Claude Sonnet 4.5");
    expect(sonnet?.confidence).toBeGreaterThan(0.5);
  });
  it("covers the full AA leaderboard scale", () => {
    expect(AA_INTELLIGENCE.length).toBeGreaterThan(150);
    const scored = AA_INTELLIGENCE.filter((e) => e.score !== undefined);
    expect(scored.length).toBeGreaterThan(150);
    expect(Math.max(...(scored.map((e) => e.score) as number[]))).toBe(63);
  });
});
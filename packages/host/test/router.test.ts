import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadDifficultyModel, estimateDifficulty } from "../src/router/tfidf.js";
import { routePrompt, tierFallbackScore } from "../src/router/route.js";
import { lookupIntelligence, matchIntelligence, AA_INTELLIGENCE } from "../src/router/aa.js";
import type { DifficultyModel } from "../src/router/tfidf.js";
const MODEL_PATH = path.resolve(__dirname, "..", "..", "arc", "resources", "router", "difficulty.json");
function loadModel(): DifficultyModel {
  return loadDifficultyModel(JSON.parse(fs.readFileSync(MODEL_PATH, "utf8")) as DifficultyModel);
}
const REFERENCES: Array<[string, number]> = [
  ["explain what a monad is in Haskell", 0.39146],
  ["add a try catch around this async call", 0.34001],
  ["what is 2+2", 0.82242],
  ["refactor this class to use dependency injection", 0.32053],
  ["write a quick hello world", 0.40704],
  ["fix the null pointer in the payment service and add tests", 0.25204],
  ["int x = 5;", 0.27301],
  ["why did the tests fail after i changed the mock", 0.45080],
  ["migrate the database schema and write a rollback script", 0.27166],
  ["translate this docstring to french", 0.35702],
  ["prove that the square root of 2 is irrational", 0.49481],
  ["rename the variable and update all usages", 0.19303],
  ["create a react component that fetches data", 0.38684],
  ["this prompt has nothing to do with code at all really", 0.27043],
  ["explain the difference between tcp and udp sockets", 0.22889],
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
    expect(routePrompt(easy, model, fleet, { qualityBias: "off" }).modelId).toBe("light");
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
describe("router aa list", () => {
  it("matches configured model ids and labels", () => {
    expect(lookupIntelligence("glm-5-2")?.score).toBe(51);
    expect(lookupIntelligence("deepseek-v4-flash-0731")?.score).toBe(50);
    expect(lookupIntelligence("whatever", "Claude Opus 5")?.score).toBe(61);
    expect(lookupIntelligence("unknown-model")).toBeUndefined();
  });
  it("fuzzy-matches suffixed ids and approximate labels", () => {
    expect(matchIntelligence("gemma-4-31b-mr204qvj", "Gemma 4 31B")?.confidence).toBe(1);
    const nemotron = matchIntelligence("nemotron-3-nano-mqwcj2ru", "Nemotron 3 Nano");
    expect(nemotron?.entry.name).toBe("NVIDIA Nemotron 3 Nano");
    expect(nemotron!.confidence).toBeGreaterThan(0.5);
    const sonnet = matchIntelligence("claude-sonnet-4-5", "Claude Sonnet 4.5");
    expect(sonnet?.confidence).toBeGreaterThan(0.5);
  });
  it("covers the full AA leaderboard scale", () => {
    expect(AA_INTELLIGENCE.length).toBeGreaterThan(150);
    const scored = AA_INTELLIGENCE.filter((e) => e.score !== undefined);
    expect(scored.length).toBeGreaterThan(150);
    expect(Math.max(...(scored.map((e) => e.score) as number[]))).toBe(61);
  });
});
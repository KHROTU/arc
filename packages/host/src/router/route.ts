//
//
import type { DifficultyModel } from "./tfidf.js";
import { estimateDifficulty } from "./tfidf.js";
export type QualityBias = "off" | "prefer-cheap" | "prefer-powerful";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
const LING_SCORE = 14; 
const STRONG_SCORE = 51; 
const BIAS_OFFSET: Record<QualityBias, number> = {
  "prefer-cheap": -4,
  off: 0,
  "prefer-powerful": 4,
};
const EFFORT_TO_TEMP: Record<ReasoningEffort, number> = {
  none: 1.0, minimal: 0.9, low: 0.8, medium: 0.7, high: 0.5, xhigh: 0.3, max: 0.2,
};
const TEMP_SENSITIVITY = 8.0; 
export function temperatureForEffort(effort: ReasoningEffort): number {
  return EFFORT_TO_TEMP[effort] ?? 0.7;
}
function temperatureOffset(temperature: number): number {
  return (temperature - 0.7) * TEMP_SENSITIVITY;
}
function requiredScore(d: number): number {
  return LING_SCORE + (STRONG_SCORE - LING_SCORE) * (1 - d);
}
export interface FleetModel {
  modelId: string;
  score: number;
  cost: number;
}
export interface RouteDecision {
  modelId: string;
  requiredScore: number;
  difficulty: number;
  confidence: number;
  scored: number;
}
export function routePrompt(
  text: string,
  model: DifficultyModel,
  fleet: FleetModel[],
  opts: { qualityBias?: QualityBias; temperature?: number },
): RouteDecision {
  const d = estimateDifficulty(text, model);
  const bar = requiredScore(d) + BIAS_OFFSET[opts.qualityBias ?? "off"] + temperatureOffset(opts.temperature ?? 0.7);
  const byCostThenScore = [...fleet].sort((a, b) => a.cost - b.cost || a.score - b.score);
  let chosen: FleetModel | undefined;
  for (const m of byCostThenScore) {
    if (m.score >= bar) { chosen = m; break; }
  }
  if (!chosen) {
    chosen = [...fleet].sort((a, b) => b.score - a.score)[0];
  }
  return { modelId: chosen.modelId, requiredScore: bar, difficulty: d, confidence: Math.abs(d - 0.5) * 2, scored: chosen.score };
}
export function tierFallbackScore(tier: "free" | "light" | "default" | "heavy"): number {
  switch (tier) {
    case "heavy": return 60;
    case "default": return 45;
    case "light": return 30;
    default: return 20;
  }
}
export interface CalibrationModel {
  v: number;
  type: string;
  edges: number[];
  bars_by_q: Record<string, number[]>;
  default_q: number;
  ling_score: number;
  weak_score: number;
  strong_score: number;
}
export interface DomainBars {
  edges: number[];
  bars_by_q: Record<string, number[]>;
}
export interface CapabilityModel {
  v: number;
  domains: string[];
  default_q: number;
  anchor_scores: number[];
  bars: Record<string, DomainBars>;
}
export function loadCalibrationModel(json: CalibrationModel): CalibrationModel {
  return json;
}
export function loadCapabilityModel(json: CapabilityModel): CapabilityModel {
  return json;
}
function interp(x: number, xs: number[], ys: number[]): number {
  if (xs.length === 0 || ys.length === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * t;
}
function barsFor(calibOrBars: CalibrationModel | DomainBars, q?: number): number[] {
  const defaultQ = (calibOrBars as CalibrationModel).default_q ?? 0.8;
  const byQ = (calibOrBars as CalibrationModel).bars_by_q ?? (calibOrBars as DomainBars).bars_by_q;
  const key = String(q ?? defaultQ);
  return byQ[key] ?? byQ[String(defaultQ)] ?? byQ["0.8"] ?? byQ["0.9"] ?? [];
}
export function requiredScore(
  d: number,
  domain: string | undefined,
  calibration: CalibrationModel | undefined,
  capability: CapabilityModel | undefined,
  q?: number,
): number {
  if (capability && domain && capability.domains.includes(domain)) {
    const dom = capability.bars[domain];
    const bars = barsFor(dom, q);
    if (bars.length) return interp(d, dom.edges, bars);
  }
  if (calibration) {
    const bars = barsFor(calibration, q);
    if (bars.length) return interp(d, calibration.edges, bars);
  }
  const lo = calibration?.ling_score ?? 14;
  const hi = calibration?.strong_score ?? 51;
  return lo + (hi - lo) * (1 - d);
}
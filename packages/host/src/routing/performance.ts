const DAMP = 0.25;
const ALPHA = 0.20;
const BASE_SCORE = 90;
const N_TRIALS_WEIGHT = 3;
const MAX_LATENCY_PENALTY = 30;
const LATENCY_DIVISOR = 500;
interface Entry {
  t: number;
  fRate: number;
  sRate: number;
  l: number;
  score: number;
  consecutiveFailures: number;
  cbOpenUntil: number;
}
const M = new Map<string, Entry>();
function key(pid: string, mid: string): string {
  return pid + "\0" + mid;
}
function get(pid: string, mid: string): Entry {
  const k = key(pid, mid);
  let e = M.get(k);
  if (!e) {
    e = { t: 0, fRate: 0, sRate: 0, l: 0, score: BASE_SCORE, consecutiveFailures: 0, cbOpenUntil: 0 };
    M.set(k, e);
  }
  return e;
}
function recalc(e: Entry): void {
  if (e.t === 0) { e.score = BASE_SCORE; return; }
  const nPen = Math.max(0, (N_TRIALS_WEIGHT - e.t) * 4);
  const lPen = Math.min(MAX_LATENCY_PENALTY, e.l / LATENCY_DIVISOR);
  const fPen = e.fRate * 80;
  const sPen = e.sRate * 50;
  e.score = Math.max(0, Math.round(100 - nPen - lPen - fPen - sPen));
}
export class ProviderPerformanceTracker {
  recordSuccess(pid: string, mid: string, latencyMs?: number): void {
    const e = get(pid, mid);
    e.t = Math.min(10, e.t + 1);
    e.consecutiveFailures = 0;
    e.cbOpenUntil = 0;
    e.fRate = e.fRate * (1 - ALPHA);
    e.sRate = e.sRate * (1 - ALPHA);
    if (latencyMs !== undefined) {
      e.l = e.l ? e.l * (1 - DAMP) + latencyMs * DAMP : latencyMs;
    }
    recalc(e);
  }
  recordFailure(pid: string, mid: string): void {
    const e = get(pid, mid);
    e.t = Math.min(10, e.t + 1);
    e.consecutiveFailures++;
    const ttl = Math.min(120_000, 15_000 * Math.pow(2, e.consecutiveFailures - 1));
    e.cbOpenUntil = Date.now() + ttl;
    e.fRate = e.fRate * (1 - ALPHA) + ALPHA;
    recalc(e);
  }
  recordStall(pid: string, mid: string): void {
    const e = get(pid, mid);
    e.t = Math.min(10, e.t + 1);
    e.sRate = e.sRate * (1 - ALPHA) + ALPHA;
    recalc(e);
  }
  isOpen(pid: string, mid: string): boolean {
    const e = M.get(key(pid, mid));
    if (!e || e.cbOpenUntil === 0) return false;
    if (Date.now() < e.cbOpenUntil) return true;
    e.cbOpenUntil = 0;
    return false;
  }
  ttl(pid: string, mid: string): number {
    const e = M.get(key(pid, mid));
    if (!e || e.consecutiveFailures === 0) return 0;
    return Math.min(120_000, 15_000 * Math.pow(2, e.consecutiveFailures - 1));
  }
  score(pid: string, mid: string): number {
    return M.get(key(pid, mid))?.score ?? BASE_SCORE;
  }
  latency(pid: string, mid: string): number {
    return M.get(key(pid, mid))?.l ?? 0;
  }
  clearCircuitBreakers(): void {
    for (const e of M.values()) {
      e.cbOpenUntil = 0;
      e.consecutiveFailures = 0;
    }
  }
  reset(pid: string, mid: string): void { M.delete(key(pid, mid)); }
  resetAll(): void { M.clear(); }
}
export const perf = new ProviderPerformanceTracker();
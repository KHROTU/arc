import type { ProviderKind } from "../protocol/protocol.js";
export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}
export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30_000 };
export const PROVIDER_RETRY_POLICIES: Partial<Record<ProviderKind, RetryPolicy>> = {
  anthropic: { maxRetries: 4, baseDelayMs: 1000, maxDelayMs: 40_000 },
  openai: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30_000 },
  ollama: { maxRetries: 1, baseDelayMs: 500, maxDelayMs: 2_000 },
};
export function policyFor(kind: ProviderKind | string): RetryPolicy {
  return PROVIDER_RETRY_POLICIES[kind as ProviderKind] ?? DEFAULT_RETRY_POLICY;
}
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}
export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}
export function computeBackoffDelay(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) return Math.min(retryAfterMs, 300_000);
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.random() * cap;
}
export class RetryBudget {
  private used = 0;
  constructor(private limit: number) {}
  remaining(): number {
    return Math.max(0, this.limit - this.used);
  }
  tryConsume(count = 1): boolean {
    if (this.used + count > this.limit) return false;
    this.used += count;
    return true;
  }
  reset(): void {
    this.used = 0;
  }
}
export interface RetryContext {
  attempt: number;
  status: number;
  retryAfterMs?: number;
  delayMs: number;
}
export async function withRetry(
  attemptFn: (attempt: number) => Promise<Response>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  opts?: { budget?: RetryBudget; onRetry?: (ctx: RetryContext) => void; sleep?: (ms: number) => Promise<void> },
): Promise<Response> {
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let res: Response | undefined;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    res = await attemptFn(attempt);
    if (res.ok) return res;
    const retryable = isRetryableStatus(res.status);
    const hasBudget = !opts?.budget || opts.budget.tryConsume();
    if (!retryable || attempt >= policy.maxRetries || !hasBudget) return res;
    const retryAfterMs = parseRetryAfterMs(res.headers?.get?.("retry-after"));
    const delayMs = computeBackoffDelay(attempt, policy, retryAfterMs);
    opts?.onRetry?.({ attempt, status: res.status, retryAfterMs, delayMs });
    await sleep(delayMs);
  }
  return res!;
}
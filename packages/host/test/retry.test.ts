import { describe, it, expect, vi } from "vitest";
import {
  computeBackoffDelay,
  parseRetryAfterMs,
  isRetryableStatus,
  policyFor,
  withRetry,
  RetryBudget,
  DEFAULT_RETRY_POLICY,
} from "../src/providers/retry";
function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } as unknown as Headers,
    text: async () => "",
  } as unknown as Response;
}
describe("parseRetryAfterMs", () => {
  it("parses numeric seconds", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
  });
  it("parses HTTP-date", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfterMs(future);
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(6000);
  });
  it("returns undefined for missing/invalid values", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs("not-a-date")).toBeUndefined();
  });
});
describe("isRetryableStatus", () => {
  it("flags 429, 408, and 5xx as retryable", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });
  it("does not flag 4xx (other than 429/408) or 2xx", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});
describe("computeBackoffDelay", () => {
  it("grows exponentially and stays capped at maxDelayMs", () => {
    const policy = { maxRetries: 10, baseDelayMs: 100, maxDelayMs: 1000 };
    for (let attempt = 0; attempt < 10; attempt++) {
      const delay = computeBackoffDelay(attempt, policy);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1000);
    }
  });
  it("honors retryAfterMs when provided", () => {
    const policy = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 };
    expect(computeBackoffDelay(0, policy, 250)).toBe(250);
  });
});
describe("policyFor", () => {
  it("returns a provider-specific policy for known providers", () => {
    expect(policyFor("anthropic").maxRetries).toBe(4);
  });
  it("falls back to the default policy for unknown providers", () => {
    expect(policyFor("some-unknown-provider" as any)).toEqual(DEFAULT_RETRY_POLICY);
  });
});
describe("RetryBudget", () => {
  it("limits the number of retries consumed", () => {
    const budget = new RetryBudget(2);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(true);
    expect(budget.tryConsume()).toBe(false);
    expect(budget.remaining()).toBe(0);
  });
  it("resets consumed count", () => {
    const budget = new RetryBudget(1);
    budget.tryConsume();
    budget.reset();
    expect(budget.remaining()).toBe(1);
  });
});
describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const attemptFn = vi.fn(async () => mockResponse(200));
    const res = await withRetry(attemptFn, DEFAULT_RETRY_POLICY, { sleep: async () => {} });
    expect(res.ok).toBe(true);
    expect(attemptFn).toHaveBeenCalledTimes(1);
  });
  it("retries on 429 and eventually succeeds", async () => {
    let calls = 0;
    const attemptFn = vi.fn(async () => {
      calls++;
      return calls < 3 ? mockResponse(429) : mockResponse(200);
    });
    const sleeps: number[] = [];
    const res = await withRetry(attemptFn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 }, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(res.ok).toBe(true);
    expect(attemptFn).toHaveBeenCalledTimes(3);
    expect(sleeps.length).toBe(2);
  });
  it("gives up after maxRetries and returns the last failing response", async () => {
    const attemptFn = vi.fn(async () => mockResponse(500));
    const res = await withRetry(attemptFn, { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20 }, { sleep: async () => {} });
    expect(res.ok).toBe(false);
    expect(attemptFn).toHaveBeenCalledTimes(3);
  });
  it("does not retry non-retryable statuses", async () => {
    const attemptFn = vi.fn(async () => mockResponse(401));
    const res = await withRetry(attemptFn, DEFAULT_RETRY_POLICY, { sleep: async () => {} });
    expect(res.status).toBe(401);
    expect(attemptFn).toHaveBeenCalledTimes(1);
  });
  it("honors Retry-After header for delay", async () => {
    let calls = 0;
    const attemptFn = vi.fn(async () => {
      calls++;
      return calls < 2 ? mockResponse(429, { "retry-after": "1" }) : mockResponse(200);
    });
    const sleeps: number[] = [];
    await withRetry(attemptFn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 }, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps[0]).toBe(1000);
  });
  it("stops retrying when the retry budget is exhausted", async () => {
    const attemptFn = vi.fn(async () => mockResponse(429));
    const budget = new RetryBudget(1);
    const res = await withRetry(attemptFn, { maxRetries: 5, baseDelayMs: 5, maxDelayMs: 20 }, { budget, sleep: async () => {} });
    expect(res.ok).toBe(false);
    expect(attemptFn).toHaveBeenCalledTimes(2);
  });
});
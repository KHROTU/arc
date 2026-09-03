import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { getOrBackEntries, type OrBackEntry } from "../src/providers/or-back";
function resp(entries: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ data: entries }), { status });
}
const entry = (id: string): OrBackEntry => ({ id, name: `X: ${id}` });
describe("getOrBackEntries force reload", () => {
  it("serves fresh disk cache without network, but force bypasses TTL and refetches", async () => {
    const cachePath = path.join(os.tmpdir(), `or-back-force-test-${Date.now()}.json`);
    const fetchCalls: string[] = [];
    const fetchImpl = (async () => {
      fetchCalls.push("hit");
      return resp([entry("old/model")]);
    }) as typeof fetch;
    const first = await getOrBackEntries({ cachePath, ttlMs: 60_000, fetchImpl });
    expect(first?.map((e) => e.id)).toEqual(["old/model"]);
    expect(fetchCalls.length).toBe(1);
    const second = await getOrBackEntries({ cachePath, ttlMs: 60_000, fetchImpl });
    expect(second?.map((e) => e.id)).toEqual(["old/model"]);
    expect(fetchCalls.length).toBe(1);
    let failing = false;
    const switching = (async () => {
      if (failing) throw new Error("offline");
      return resp([entry("old/model"), entry("new/model")]);
    }) as typeof fetch;
    const reloaded = await getOrBackEntries({ cachePath, ttlMs: 60_000, fetchImpl: switching, force: true });
    expect(reloaded?.map((e) => e.id)).toEqual(["old/model", "new/model"]);
    failing = true;
    const staleFallback = await getOrBackEntries({ cachePath, ttlMs: 60_000, fetchImpl: switching, force: true });
    expect(staleFallback?.map((e) => e.id)).toEqual(["old/model", "new/model"]);
  });
});
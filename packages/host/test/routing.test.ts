import { describe, it, expect } from "vitest";
import { ModelRegistry } from "../src/routing/registry";
import { pickProvider, routeWithFailover } from "../src/routing/router";
import type { ModelDescriptor, ProviderConfig } from "../src/protocol/protocol";
function makeModel(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: "m1",
    label: "Test",
    tier: "default",
    contextWindow: 8000,
    costPer1mIn: 0,
    costPer1mOut: 0,
    providers: [
      { id: "p1", kind: "openai-compatible", priority: 0 },
      { id: "p2", kind: "openai-compatible", priority: 1 },
    ],
    ...overrides,
  };
}
function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { id: "p1", kind: "openai-compatible", label: "p1", enabled: true, ...overrides };
}
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
    r.load({ models: [makeModel()], providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })] });
    r.removeProvider("p1");
    expect(r.get("m1")!.providers).toHaveLength(1);
  });
});
describe("pickProvider", () => {
  it("returns the highest-priority enabled provider", () => {
    const r = new ModelRegistry();
    r.load({
      models: [makeModel()],
      providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })],
    });
    const got = pickProvider(r, r.get("m1")!);
    expect(got?.provider.id).toBe("p1");
  });
  it("skips disabled providers", () => {
    const r = new ModelRegistry();
    r.load({
      models: [makeModel()],
      providers: [makeProvider({ id: "p1", enabled: false }), makeProvider({ id: "p2" })],
    });
    const got = pickProvider(r, r.get("m1")!);
    expect(got?.provider.id).toBe("p2");
  });
});
describe("routeWithFailover", () => {
  it("falls over to the next provider on failure", async () => {
    const r = new ModelRegistry();
    r.load({
      models: [makeModel()],
      providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })],
    });
    let attempts = 0;
    const out = await routeWithFailover(r, r.get("m1")!, async (d) => {
      attempts++;
      if (d.provider.id === "p1") throw new Error("nope");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(attempts).toBe(2);
  });
  it("throws if all providers fail", async () => {
    const r = new ModelRegistry();
    r.load({
      models: [makeModel()],
      providers: [makeProvider({ id: "p1" }), makeProvider({ id: "p2" })],
    });
    await expect(
      routeWithFailover(r, r.get("m1")!, async () => {
        throw new Error("always");
      }),
    ).rejects.toThrow(/All providers/);
  });
});
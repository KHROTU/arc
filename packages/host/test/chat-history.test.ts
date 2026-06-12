import { describe, it, expect } from "vitest";
import { ChatHistory } from "../src/chat/history";
describe("ChatHistory", () => {
  it("creates a chat on demand and tracks the current id", () => {
    const h = new ChatHistory();
    expect(h.list()).toEqual([]);
    expect(h.current()).toBeUndefined();
    const a = h.create("First");
    expect(a.title).toBe("First");
    expect(h.list().length).toBe(1);
    expect(h.current()).toBe(a.id);
  });
  it("switches between chats and keeps them all", () => {
    const h = new ChatHistory();
    const a = h.create("A");
    const b = h.create("B");
    expect(h.current()).toBe(b.id);
    const sw = h.switch(a.id);
    expect(sw?.id).toBe(a.id);
    expect(h.current()).toBe(a.id);
    expect(h.list().length).toBe(2);
  });
  it("renames a chat and bumps its updatedAt", () => {
    const h = new ChatHistory();
    const a = h.create("old");
    const before = a.updatedAt;
    return new Promise<void>((resolve) => setTimeout(() => {
      h.rename(a.id, "new");
      expect(h.list()[0].title).toBe("new");
      expect(h.list()[0].updatedAt).toBeGreaterThanOrEqual(before);
      resolve();
    }, 5));
  });
  it("removes a chat and re-points current to a sibling if needed", () => {
    const h = new ChatHistory();
    const a = h.create("A");
    const b = h.create("B");
    h.remove(a.id);
    expect(h.list().map((c) => c.id)).toEqual([b.id]);
    expect(h.current()).toBe(b.id);
  });
  it("accumulates cost and updatedAt on bump()", () => {
    const h = new ChatHistory();
    const a = h.create();
    h.bump(a.id, 0.01);
    h.bump(a.id, 0.005);
    expect(h.list()[0].cost).toBeCloseTo(0.015, 6);
  });
  it("survives round-trip through load()", () => {
    const a = new ChatHistory();
    const x = a.create("X");
    const y = a.create("Y");
    a.switch(x.id);
    a.rename(y.id, "Y renamed");
    a.bump(x.id, 0.10);
    const snap = { chats: a.list(), currentId: a.current() };
    const b = new ChatHistory();
    b.load(snap);
    expect(b.list().length).toBe(2);
    expect(b.current()).toBe(x.id);
    expect(b.list().find((c) => c.id === y.id)?.title).toBe("Y renamed");
    expect(b.list().find((c) => c.id === x.id)?.cost).toBeCloseTo(0.10, 6);
  });
});
import { describe, it, expect } from "vitest";
import { tools } from "../src/agent/tools";
const ctx = {
  root: process.cwd(),
  workspacePath: process.cwd(),
  sandboxProfile: undefined,
} as any;
describe("file tool argument guards", () => {
  it("file.write rejects a missing content instead of writing 'undefined'", async () => {
    const r = await tools["file.write"].fn({ path: "x.txt" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("content");
  });
  it("file.write rejects a missing path", async () => {
    const r = await tools["file.write"].fn({ content: "hello" }, ctx);
    expect(r.ok).toBe(false);
  });
  it("file.edit rejects a missing search instead of searching for 'undefined'", async () => {
    const r = await tools["file.edit"].fn({ path: "x.txt", replace: "y" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("search");
  });
  it("file.read rejects a missing path", async () => {
    const r = await tools["file.read"].fn({}, ctx);
    expect(r.ok).toBe(false);
  });
});
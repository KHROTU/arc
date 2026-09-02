import { describe, it, expect } from "vitest";
import { resolveGit, runGit, setGitPath } from "../src/util/process";
describe("git resolution", () => {
  it("resolves a git executable without throwing", async () => {
    const exe = await resolveGit();
    expect(exe).toBeDefined();
    expect(exe!.length).toBeGreaterThan(0);
  });
  it("runGit runs git --version or fails gracefully without throwing", async () => {
    const r = await runGit(["--version"], { cwd: process.cwd(), timeoutMs: 10_000, maxOutputBytes: 4096 });
    if (r.ok) {
      expect(r.stdout).toMatch(/git version/);
    } else {
      expect(r.ok).toBe(false);
    }
  });
  it("setGitPath overrides resolution", async () => {
    setGitPath("definitely-not-a-real-git");
    try {
      expect(await resolveGit()).toBe("definitely-not-a-real-git");
      const r = await runGit(["--version"], { cwd: process.cwd(), timeoutMs: 10_000, maxOutputBytes: 4096 });
      expect(r.ok).toBe(false);
    } finally {
      setGitPath(undefined);
    }
  });
  it("resolution is cached and returns to PATH probing after clearing the override", async () => {
    setGitPath(undefined);
    const exe = await resolveGit();
    expect(exe).toBe(await resolveGit());
  });
});
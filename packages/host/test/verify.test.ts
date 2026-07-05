import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { parseVerifyToml, matchesVerifyGlob, runVerification, loadVerifyConfig } from "../src/verify/verify";
import { getWorkspaceArcDir } from "../src/arc-dir";
describe("parseVerifyToml", () => {
  it("parses commands and maxRetries", () => {
    const toml = `maxRetries = 2\n[[commands]]\nname = "lint"\ncommand = "eslint ."\nglob = "**/*.ts"\n[[commands]]\nname = "typecheck"\ncommand = "tsc --noEmit"\n`;
    const cfg = parseVerifyToml(toml);
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.commands).toEqual([
      { name: "lint", command: "eslint .", glob: "**/*.ts" },
      { name: "typecheck", command: "tsc --noEmit" },
    ]);
  });
  it("defaults maxRetries to 3 when absent", () => {
    const cfg = parseVerifyToml(`[[commands]]\nname = "x"\ncommand = "echo ok"\n`);
    expect(cfg.maxRetries).toBe(3);
  });
  it("ignores incomplete command blocks", () => {
    const cfg = parseVerifyToml(`[[commands]]\nname = "incomplete"\n`);
    expect(cfg.commands).toEqual([]);
  });
});
describe("matchesVerifyGlob", () => {
  it("matches ** across directories", () => {
    expect(matchesVerifyGlob("src/a/b.ts", "**/*.ts")).toBe(true);
  });
  it("matches single * within a segment", () => {
    expect(matchesVerifyGlob("src/a.ts", "src/*.ts")).toBe(true);
    expect(matchesVerifyGlob("src/a/b.ts", "src/*.ts")).toBe(false);
  });
});
describe("runVerification", () => {
  it("runs matching commands and reports success", async () => {
    const config = { commands: [{ name: "echo", command: process.platform === "win32" ? "echo ok" : "echo ok" }], maxRetries: 3 };
    const result = await runVerification(process.cwd(), config, ["a.ts"]);
    expect(result.ok).toBe(true);
    expect(result.results[0].name).toBe("echo");
  });
  it("skips commands whose glob does not match changed files", async () => {
    const config = { commands: [{ name: "pyonly", command: "echo should-not-run", glob: "**/*.py" }], maxRetries: 3 };
    const result = await runVerification(process.cwd(), config, ["a.ts"]);
    expect(result.results.length).toBe(0);
    expect(result.ok).toBe(true);
  });
  it("reports failure for a failing command", async () => {
    const failCmd = process.platform === "win32" ? "node -e \"process.exit(1)\"" : "false";
    const config = { commands: [{ name: "fail", command: failCmd }], maxRetries: 3 };
    const result = await runVerification(process.cwd(), config, ["a.ts"]);
    expect(result.ok).toBe(false);
    expect(result.results[0].ok).toBe(false);
  });
});
describe("loadVerifyConfig", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-verify-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(getWorkspaceArcDir(root), { recursive: true, force: true });
  });
  it("returns undefined when no verify.toml exists", async () => {
    const cfg = await loadVerifyConfig(root);
    expect(cfg).toBeUndefined();
  });
  it("loads and parses verify.toml from the workspace arc dir", async () => {
    const dir = getWorkspaceArcDir(root);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "verify.toml"), `maxRetries = 1\n[[commands]]\nname = "test"\ncommand = "echo hi"\n`, "utf-8");
    const cfg = await loadVerifyConfig(root);
    expect(cfg?.maxRetries).toBe(1);
    expect(cfg?.commands[0].name).toBe("test");
  });
});

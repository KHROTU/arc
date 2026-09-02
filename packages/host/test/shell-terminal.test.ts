import { describe, it, expect, afterAll } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { detectTerminals, resolveTerminal } from "../src/util/terminals";
import { shellCommand, setPreferredShell } from "../src/util/process";
import { tools, killActiveProcesses } from "../src/agent/tools";
import type { ToolContext } from "../src/agent/tools";
afterAll(() => { killActiveProcesses(); });
describe("terminal detection", () => {
  it("finds terminals and returns unique ids", () => {
    const list = detectTerminals();
    expect(list.length).toBeGreaterThan(0);
    const ids = new Set(list.map((t) => t.id));
    expect(ids.size).toBe(list.length);
    for (const t of list) {
      expect(t.executable.length).toBeGreaterThan(0);
      expect(Array.isArray(t.args)).toBe(true);
    }
  });
  it("resolveTerminal returns undefined for default or unknown ids", () => {
    expect(resolveTerminal("default")).toBeUndefined();
    expect(resolveTerminal(undefined)).toBeUndefined();
    expect(resolveTerminal("definitely-not-a-terminal")).toBeUndefined();
  });
  it("resolveTerminal round-trips a detected id", () => {
    const list = detectTerminals();
    const first = list[0];
    expect(resolveTerminal(first.id)?.executable).toBe(first.executable);
  });
  it("setPreferredShell overrides shellCommand until cleared", async () => {
    setPreferredShell({ executable: "fake-shell", args: ["-x"], kind: "bash" });
    const inv = await shellCommand("echo hi");
    expect(inv.executable).toBe("fake-shell");
    expect(inv.args).toEqual(["-x", "echo hi"]);
    setPreferredShell(undefined);
    const fallback = await shellCommand("echo hi");
    expect(fallback.executable).not.toBe("fake-shell");
  });
});
describe("shell surface setting", () => {
  it("shell.backgroundRun starts a pollable process", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-term-"));
    const scriptPath = path.join(tmp, "sleeper.js");
    await fs.writeFile(scriptPath, "console.log('bg-marker'); setInterval(function(){}, 1000);\n");
    const ctx = { root: tmp, workspacePath: tmp } as unknown as ToolContext;
    const run = await tools["shell.backgroundRun"].fn({ command: `node "${scriptPath}"` }, ctx);
    expect(run.ok).toBe(true);
    const id = /id: (\d+)/.exec(run.output)?.[1];
    expect(id).toBeTruthy();
    let check = await tools["shell.check"].fn({ id }, ctx);
    const deadline = Date.now() + 15_000;
    while (!check.output.includes("bg-marker") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      check = await tools["shell.check"].fn({ id }, ctx);
    }
    expect(check.output).toContain("bg-marker");
  });
  it("shell.run with surface integrated delegates to the VS Code terminal runner", async () => {
    const seen: string[] = [];
    const ctx = {
      root: ".", workspacePath: ".",
      shellSurface: "integrated",
      runInVsCodeTerminal: async (cmd: string, cwd: string) => { seen.push(`${cmd}@${cwd}`); return { ok: true, output: `terminal-ran:${cmd}:${cwd}` }; },
    } as unknown as ToolContext;
    const r = await tools["shell.run"].fn({ command: "echo hi" }, ctx);
    expect(r.output).toBe("terminal-ran:echo hi:.");
    expect(seen).toEqual(["echo hi@."]);
  });
  it("shell.run with surface integrated fails cleanly without a runner", async () => {
    const ctx = { root: ".", workspacePath: ".", shellSurface: "integrated" } as unknown as ToolContext;
    const r = await tools["shell.run"].fn({ command: "echo hi" }, ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("integrated");
  });
});
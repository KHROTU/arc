import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { runProcess, terminateProcessTree } from "../src/util/process";
import { tools, killActiveProcesses, listBackgroundProcesses } from "../src/agent/tools";
import type { ToolContext } from "../src/agent/tools";
import type { ChildProcess } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
afterAll(() => { killActiveProcesses(); });
function shellAvailable(): boolean {
  if (process.platform !== "win32") return true;
  try {
    return spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "$true"], { timeout: 20_000 }).status === 0;
  } catch {
    return false;
  }
}
const hasShell = shellAvailable();
describe("runProcess timeout adoption", () => {
  it("kills the process on timeout when no adopt hook is given", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-sh-"));
    const result = await runProcess(process.execPath, ["-e", "console.log('partial-work-done'); setInterval(function(){}, 1000);"], { cwd: tmp, timeoutMs: 900 });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Process timed out after 900ms");
    expect(result.stdout).toContain("partial-work-done");
  });
  it("hands the still-running process to the adopt hook instead of killing it", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-sh-"));
    let adopted: ChildProcess | undefined;
    let adoptedStdout = "";
    const result = await runProcess(process.execPath, ["-e", "console.log('partial-work-done'); setInterval(function(){}, 1000);"], {
      cwd: tmp,
      timeoutMs: 900,
      timeoutAdopt: (proc, stdout) => { adopted = proc; adoptedStdout = stdout; return true; },
    });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Process timed out after 900ms");
    expect(result.stdout).toContain("partial-work-done");
    expect(adopted).toBeTruthy();
    expect(adoptedStdout).toContain("partial-work-done");
    await new Promise((r) => setTimeout(r, 300));
    expect(adopted!.exitCode).toBeNull();
    expect(adopted!.killed).toBe(false);
    terminateProcessTree(adopted!);
    await new Promise<void>((resolve) => {
      if (adopted!.exitCode !== null || adopted!.signalCode) return resolve();
      adopted!.once("exit", () => resolve());
      setTimeout(resolve, 5000);
    });
    expect(adopted!.exitCode ?? adopted!.signalCode).not.toBeNull();
  });
});
describe("shell.run timeout moves the process to the background", () => {
  it.skipIf(!hasShell)("returns a background id and the process stays pollable", { timeout: 30_000 }, async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-sh-"));
    const scriptPath = path.join(tmp, "sleeper.js");
    await fs.writeFile(scriptPath, "console.log('partial-work-done'); setInterval(function(){}, 1000);\n");
    const ctx = { root: tmp, workspacePath: tmp } as unknown as ToolContext;
    const run = await tools["shell.run"].fn({ command: `node "${scriptPath}"`, timeout: 1 }, ctx);
    expect(run.ok).toBe(false);
    expect(run.output).toContain("partial-work-done");
    expect(run.output).toMatch(/\[timed out after 1s\] Still running in the background \(id: \d+\)/);
    const id = run.output.match(/background \(id: (\d+)\)/)![1];
    const check = await tools["shell.check"].fn({ id }, ctx);
    expect(check.ok).toBe(true);
    expect(check.output).toContain("[running]");
    expect(check.output).toContain("partial-work-done");
    expect(listBackgroundProcesses().some((p) => p.id === id && !p.exited)).toBe(true);
  });
});
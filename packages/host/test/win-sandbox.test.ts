import { describe, it, expect } from "vitest";
import { runProcess } from "../src/util/process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
const isWin = process.platform === "win32";
describe.skipIf(!isWin)("Windows sandbox (restricted token + Job Object)", { timeout: 300_000 }, () => {
  it("runs a command that writes inside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-sbx-"));
    const r = await runProcess(process.execPath, ["-e", "require('fs').writeFileSync('inside.txt', 'ok'); console.log('WROTE-INSIDE');"], {
      cwd: root, workspaceRoot: root, sandboxProfile: "workspace", timeoutMs: 120_000, env: { ...process.env } as NodeJS.ProcessEnv,
    });
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("WROTE-INSIDE");
    expect(r.ok).toBe(true);
    const content = await fs.readFile(path.join(root, "inside.txt"), "utf-8");
    expect(content).toBe("ok");
  });
  it("blocks writes outside the workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-sbx-"));
    const outside = path.join(os.homedir(), "arc-sbx-outside-probe.txt");
    const script = `require('fs').writeFileSync(${JSON.stringify(outside)}, 'nope'); console.log('WROTE-OUTSIDE');`;
    const r = await runProcess(process.execPath, ["-e", script], {
      cwd: root, workspaceRoot: root, sandboxProfile: "workspace", timeoutMs: 120_000, env: { ...process.env } as NodeJS.ProcessEnv,
    });
    expect(r.ok).toBe(false);
    expect(r.stdout).not.toContain("WROTE-OUTSIDE");
    const exists = await fs.stat(outside).then(() => true, () => false);
    expect(exists).toBe(false);
  });
  it("blocks writes in a read-only sandbox", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-sbx-"));
    await fs.writeFile(path.join(root, "seed.txt"), "seed");
    const r = await runProcess(process.execPath, ["-e", "require('fs').writeFileSync('seed.txt', 'mutated'); console.log('WROTE-RO');"], {
      cwd: root, workspaceRoot: root, sandboxProfile: "read-only", timeoutMs: 120_000, env: { ...process.env } as NodeJS.ProcessEnv,
    });
    expect(r.ok).toBe(false);
    expect(r.stdout).not.toContain("WROTE-RO");
    expect(await fs.readFile(path.join(root, "seed.txt"), "utf-8")).toBe("seed");
  });
  it("system profile: writes outside the workspace but blocks system files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-sbx-"));
    const outside = path.join(os.homedir(), "arc-sbx-system-probe.txt");
    const script = `try { require('fs').writeFileSync(${JSON.stringify(outside)}, 'ok'); console.log('WROTE-OUTSIDE'); } catch (e) { console.log('DENIED-OUTSIDE'); }`;
    const r = await runProcess(process.execPath, ["-e", script], {
      cwd: root, workspaceRoot: root, sandboxProfile: "system", timeoutMs: 120_000, env: { ...process.env } as NodeJS.ProcessEnv,
    });
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain("WROTE-OUTSIDE");
    await fs.rm(outside, { force: true });
    const sysTarget = path.join(process.env.SystemRoot ?? "C:\\Windows", "arc-sbx-system-probe.txt");
    const script2 = `try { require('fs').writeFileSync(${JSON.stringify(sysTarget)}, 'nope'); console.log('WROTE-SYSTEM'); } catch (e) { console.log('DENIED-SYSTEM'); }`;
    const r2 = await runProcess(process.execPath, ["-e", script2], {
      cwd: root, workspaceRoot: root, sandboxProfile: "system", timeoutMs: 120_000, env: { ...process.env } as NodeJS.ProcessEnv,
    });
    expect(r2.stdout).toContain("DENIED-SYSTEM");
    const exists = await fs.stat(sysTarget).then(() => true, () => false);
    expect(exists).toBe(false);
  });
});
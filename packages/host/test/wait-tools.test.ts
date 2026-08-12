import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { tools } from "../src/agent/tools";
const ctx = {
  root: process.cwd(),
  workspacePath: process.cwd(),
  sandboxProfile: undefined,
  proxyShell: undefined,
  proxyUrl: undefined,
  requestApproval: async () => true,
} as any;
describe("wait tools", () => {
  it("wait.for sleeps for the requested duration", async () => {
    const start = Date.now();
    const r = await tools["wait.for"].fn({ seconds: 0.15 }, ctx);
    expect(r.ok).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
    expect(r.output).toContain("Waited");
  });
  it("wait.for rejects missing or invalid seconds", async () => {
    const r = await tools["wait.for"].fn({}, ctx);
    expect(r.ok).toBe(false);
    const r2 = await tools["wait.for"].fn({ seconds: -1 }, ctx);
    expect(r2.ok).toBe(false);
  });
  it("wait.until returns immediately for a past time", async () => {
    const r = await tools["wait.until"].fn({ time: "2020-01-01T00:00:00Z" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("already passed");
  });
  it("wait.until rejects malformed times", async () => {
    const r = await tools["wait.until"].fn({ time: "not-a-time" }, ctx);
    expect(r.ok).toBe(false);
  });
  it("wait.until accepts an ISO time slightly in the future", async () => {
    const future = new Date(Date.now() + 2000).toISOString();
    const r = await tools["wait.until"].fn({ time: future }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/Waited until/);
    expect(r.output).toMatch(/2\.\ds/);
  });
  it("wait.forProcess waits for a background process exit", async () => {
    const started = await tools["shell.backgroundRun"].fn({ command: "node -e \"setTimeout(()=>{}, 150)\"" }, ctx);
    expect(started.ok).toBe(true);
    const id = String(started.output.match(/\(id: (\d+)\)/)?.[1]);
    const r = await tools["wait.forProcess"].fn({ id, timeout: 10 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("exited");
  });
  it("wait.forProcess rejects an unknown id", async () => {
    const r = await tools["wait.forProcess"].fn({ id: "nope" }, ctx);
    expect(r.ok).toBe(false);
  });
  it("wait.forCommand succeeds when the command succeeds", async () => {
    const r = await tools["wait.forCommand"].fn({ command: "node -e \"process.exit(0)\"", interval: 0.25, timeout: 10 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("succeeded");
  });
  it("wait.forCommand times out when the command keeps failing", async () => {
    const r = await tools["wait.forCommand"].fn({ command: "node -e \"process.exit(1)\"", interval: 0.25, timeout: 1 }, ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("did not succeed");
  });
  it("wait.forCommand requires approval", async () => {
    let asked = false;
    const denied = {
      ...ctx,
      requestApproval: async () => { asked = true; return false; },
    };
    const r = await tools["wait.forCommand"].fn({ command: "echo hi" }, denied);
    expect(asked).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("denied");
  });
  it("wait tools abort on signal", async () => {
    const ac = new AbortController();
    const abortedCtx = { ...ctx, signal: ac.signal };
    const p = tools["wait.for"].fn({ seconds: 5 }, abortedCtx);
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.output).toContain("interrupted");
  });
  it("context.retrieve returns stored content and errors on unknown ids", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-retrieve-"));
    const { saveBlob } = await import("../src/compress/store");
    const content = JSON.stringify({ rows: Array.from({ length: 300 }, (_, i) => ({ i })) });
    const id = await saveBlob(tmp, "shell.run", content);
    const hit = await tools["context.retrieve"].fn({ id }, { ...ctx, root: tmp });
    expect(hit.ok).toBe(true);
    expect(hit.output).toBe(content);
    const miss = await tools["context.retrieve"].fn({ id: "ffffffff" }, { ...ctx, root: tmp });
    expect(miss.ok).toBe(false);
    const empty = await tools["context.retrieve"].fn({}, { ...ctx, root: tmp });
    expect(empty.ok).toBe(false);
  });
});
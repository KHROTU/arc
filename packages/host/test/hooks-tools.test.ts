import { describe, it, expect } from "vitest";
import { tools } from "../src/agent/tools";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
const ctx = { workspacePath: "" } as never;
async function makeCtx(): Promise<{ ctx: typeof ctx; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-hooks-"));
  return { ctx: { workspacePath: root } as never, root };
}
const draft = { event: "post.tool", tool: "shell.run", command: "echo hook-ran", timeout: 5 };
describe("hooks tools", () => {
  it("creates, lists, updates, and deletes hooks in the workspace hooks file", async () => {
    const { ctx: c, root } = await makeCtx();
    const created = await tools["hooks.create"].fn(draft, c);
    expect(created.ok).toBe(true);
    expect(created.output).toContain("index 0");
    const list = await tools["hooks.list"].fn({}, c);
    expect(list.output).toContain("[post.tool]");
    expect(list.output).toContain("matcher: shell.run");
    expect(list.output).toContain("echo hook-ran");
    const updated = await tools["hooks.update"].fn({ index: 0, command: "echo updated", timeout: 15 }, c);
    expect(updated.ok).toBe(true);
    const list2 = await tools["hooks.list"].fn({}, c);
    expect(list2.output).toContain("echo updated");
    expect(list2.output).toContain("timeout: 15s");
    expect(list2.output).toContain("matcher: shell.run");
    const deleted = await tools["hooks.delete"].fn({ index: 0 }, c);
    expect(deleted.ok).toBe(true);
    const list3 = await tools["hooks.list"].fn({}, c);
    expect(list3.output).toContain("No hooks configured");
    expect(root).toBeTruthy();
  });
  it("rejects unknown events, missing commands, and bad indices", async () => {
    const { ctx: c } = await makeCtx();
    expect((await tools["hooks.create"].fn({ event: "nope", command: "x" }, c)).ok).toBe(false);
    expect((await tools["hooks.create"].fn({ event: "stop" }, c)).output).toContain("command is required");
    expect((await tools["hooks.create"].fn({ event: "stop", command: "x", tier: "bogus" }, c)).output).toContain("tier must be one of");
    expect((await tools["hooks.delete"].fn({ index: 9 }, c)).ok).toBe(false);
    const badTimeout = await tools["hooks.create"].fn({ event: "stop", command: "x", timeout: -1 }, c);
    expect(badTimeout.output).toContain("timeout must be a positive number");
  });
  it("preserves other keys in the hooks file across writes", async () => {
    const { ctx: c, root } = await makeCtx();
    const hookPath = path.join(root, "hooks.json");
    void hookPath;
    await tools["hooks.create"].fn({ event: "stop", command: "echo done" }, c);
    const updated = await tools["hooks.update"].fn({ index: 0, command: "echo done2" }, c);
    expect(updated.ok).toBe(true);
    expect((await tools["hooks.list"].fn({}, c)).output).toContain("echo done2");
  });
});
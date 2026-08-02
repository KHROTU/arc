import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CheckpointStore } from "../src/checkpoint/store";
let work: string;
let storeDir: string;
let store: CheckpointStore;
let root: string;
beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), "arc-ckpt-"));
  storeDir = path.join(work, "store");
  store = new CheckpointStore({ dir: storeDir });
  root = path.join(work, "ws");
  await fs.mkdir(root, { recursive: true });
});
afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
describe("CheckpointStore", () => {
  it("snapshots and restores edited files", async () => {
    const f = path.join(root, "a.txt");
    await fs.writeFile(f, "before\n", "utf-8");
    await store.snapshot("t1", root, ["a.txt"]);
    await fs.writeFile(f, "after\n", "utf-8");
    const r = await store.restore(root, "t1");
    expect(r.restored).toContain("a.txt");
    expect(await fs.readFile(f, "utf-8")).toBe("before\n");
  });
  it("deletes files that did not exist before the turn", async () => {
    const f = path.join(root, "new.txt");
    await fs.writeFile(f, "hello", "utf-8");
    await store.snapshot("t1", root, ["new.txt"]);
    await fs.unlink(f);
    const r = await store.restore(root, "t1");
    expect(r.restored).toContain("new.txt");
    expect(await fs.readFile(f, "utf-8")).toBe("hello");
  });
  it("drops later snapshots on restore", async () => {
    const f = path.join(root, "a.txt");
    await fs.writeFile(f, "v1", "utf-8");
    await store.snapshot("t1", root, ["a.txt"]);
    await fs.writeFile(f, "v2", "utf-8");
    await store.snapshot("t2", root, ["a.txt"]);
    await fs.writeFile(f, "v3", "utf-8");
    await store.snapshot("t3", root, ["a.txt"]);
    await store.restore(root, "t1");
    const turns = await store.listTurns(root);
    expect(turns).toEqual(["t1"]);
  });
  it("cost scales with touched files, not repo size (perf characteristic)", { timeout: 30_000 }, async () => {
    for (let i = 0; i < 5000; i++) {
      await fs.writeFile(path.join(root, `noise-${i}.txt`), "noise");
    }
    const target = path.join(root, "mine.txt");
    await fs.writeFile(target, "v1", "utf-8");
    const t0 = Date.now();
    await store.snapshot("t1", root, ["mine.txt"]);
    const t1 = Date.now();
    expect(t1 - t0).toBeLessThan(1000);
    const blobDir = path.join(storeDir, "blobs");
    const blobs = await fs.readdir(blobDir).catch(() => []);
    let total = 0;
    async function count(d: string) {
      const es = await fs.readdir(d, { withFileTypes: true });
      for (const e of es) {
        if (e.isDirectory()) await count(path.join(d, e.name));
        else total++;
      }
    }
    await count(blobDir);
    expect(total).toBe(1);
  });
  it("reports conflicts when current content differs from snapshot", async () => {
    const f = path.join(root, "a.txt");
    await fs.writeFile(f, "snap", "utf-8");
    await store.snapshot("t1", root, ["a.txt"]);
    await fs.writeFile(f, "user-edit", "utf-8");
    const r = await store.restore(root, "t1");
    expect(r.conflicts).toContain("a.txt");
    expect(await fs.readFile(f, "utf-8")).toBe("snap");
  });
});
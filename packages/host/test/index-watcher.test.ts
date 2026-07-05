import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Indexer } from "../src/search/indexer";
import { HashEmbeddingBackend } from "../src/search/hash-backend";
import { IndexWatcher } from "../src/search/watcher";
function waitFor(condition: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
describe("IndexWatcher poll fallback", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-watch-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  it("detects new, changed, and removed files on each poll tick", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;\n", "utf-8");
    const indexer = new Indexer({ backend: new HashEmbeddingBackend(64) });
    const onUpdate = vi.fn();
    const watcher = new IndexWatcher({ root, indexer, poll: true, pollIntervalMs: 30, onUpdate });
    watcher.start();
    await waitFor(() => onUpdate.mock.calls.length > 0);
    expect(onUpdate).toHaveBeenCalledWith({ updated: ["a.ts"], removed: [] });
    expect(indexer.getIndex().size()).toBeGreaterThan(0);
    onUpdate.mockClear();
    await fs.writeFile(path.join(root, "b.ts"), "export const b = 2;\n", "utf-8");
    await waitFor(() => onUpdate.mock.calls.length > 0);
    expect(onUpdate).toHaveBeenCalledWith({ updated: ["b.ts"], removed: [] });
    onUpdate.mockClear();
    await fs.rm(path.join(root, "a.ts"));
    await waitFor(() => onUpdate.mock.calls.length > 0);
    expect(onUpdate).toHaveBeenCalledWith({ updated: [], removed: ["a.ts"] });
    watcher.stop();
  });
  it("does not report unchanged files as updates", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;\n", "utf-8");
    const indexer = new Indexer({ backend: new HashEmbeddingBackend(64) });
    const onUpdate = vi.fn();
    const watcher = new IndexWatcher({ root, indexer, poll: true, pollIntervalMs: 30, onUpdate });
    watcher.start();
    await waitFor(() => onUpdate.mock.calls.length > 0);
    onUpdate.mockClear();
    await new Promise((r) => setTimeout(r, 80));
    expect(onUpdate).not.toHaveBeenCalled();
    watcher.stop();
  });
});
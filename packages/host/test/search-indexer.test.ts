import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Indexer } from "../src/search/indexer";
import { HashEmbeddingBackend } from "../src/search/hash-backend";
describe("Indexer integration", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-search-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  it("indexes a workspace and searches semantically", async () => {
    await fs.writeFile(path.join(root, "auth.ts"), "export function login(user) { return signToken(user); }\nexport function logout() {}\n", "utf-8");
    await fs.writeFile(path.join(root, "math.ts"), "export function add(a, b) { return a + b; }\nexport function multiply(a, b) { return a * b; }\n", "utf-8");
    await fs.writeFile(path.join(root, "README.md"), "# Auth System\nThis module handles authentication.\n", "utf-8");
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "skipme.ts"), "skip me", "utf-8");
    const indexer = new Indexer({ backend: new HashEmbeddingBackend(256) });
    const progress = await indexer.indexWorkspace(root);
    expect(progress.filesIndexed).toBe(3);
    expect(progress.errors).toBe(0);
    expect(indexer.getIndex().size()).toBeGreaterThan(0);
    const hits = await indexer.search("authentication login token");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].file.endsWith("auth.ts") || hits[0].file.endsWith("README.md")).toBe(true);
  });
  it("reindexes a file after it changes", async () => {
    const file = path.join(root, "data.ts");
    await fs.writeFile(file, "export const v = 1;\n", "utf-8");
    const indexer = new Indexer({ backend: new HashEmbeddingBackend(128) });
    await indexer.indexWorkspace(root);
    const before = indexer.getIndex().size();
    expect(before).toBeGreaterThan(0);
    await fs.writeFile(file, "export const v = 999;\nexport const w = 'changed';\n", "utf-8");
    await indexer.reindexFile(root, "data.ts");
    const after = indexer.getIndex().size();
    expect(after).toBeGreaterThan(0);
  });
  it("removes all chunks for a file", async () => {
    const file = path.join(root, "x.ts");
    await fs.writeFile(file, "line\n".repeat(100), "utf-8");
    const indexer = new Indexer({ backend: new HashEmbeddingBackend(128) });
    await indexer.indexWorkspace(root);
    const before = indexer.getIndex().size();
    expect(before).toBeGreaterThan(0);
    indexer.removeFile("x.ts");
    expect(indexer.getIndex().size()).toBe(0);
  });
  it("saves and loads the index from disk", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "export const x = 1;\n", "utf-8");
    const indexer = new Indexer({ backend: new HashEmbeddingBackend(128) });
    await indexer.indexWorkspace(root);
    const before = indexer.getIndex().size();
    const savePath = path.join(root, "index.arcx");
    await indexer.save(savePath);
    const loaded = await Indexer.load(savePath, new HashEmbeddingBackend(128));
    expect(loaded.getIndex().size()).toBe(before);
    const hits = await loaded.search("x = 1");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].file).toBe("a.ts");
  });
});
import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { tools } from "../src/agent/tools";
async function makeNotebook(): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arc-notebook-tools-"));
  const file = "sample.ipynb";
  const doc = {
    cells: [
      { cell_type: "markdown", source: ["# Title"], metadata: {} },
      { cell_type: "code", source: ["print('hi')"], metadata: {}, execution_count: 1, outputs: [{ output_type: "stream", name: "stdout", text: ["hi\n"] }] },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  };
  await fs.writeFile(path.join(dir, file), JSON.stringify(doc, null, 1), "utf-8");
  return { dir, file };
}
describe("notebook.* tools", () => {
  it("notebook.read lists cells when no cellIndex is given", async () => {
    const { dir, file } = await makeNotebook();
    const ctx = { root: dir } as any;
    const r = await tools["notebook.read"].fn({ path: file }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("[0] (markdown)");
    expect(r.output).toContain("[1] (code, has output)");
  });
  it("notebook.read returns full source + output for a specific cell", async () => {
    const { dir, file } = await makeNotebook();
    const ctx = { root: dir } as any;
    const r = await tools["notebook.read"].fn({ path: file, cellIndex: 1 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("print('hi')");
    expect(r.output).toContain("hi");
  });
  it("notebook.editCell replaces a cell's source and persists to disk", async () => {
    const { dir, file } = await makeNotebook();
    const ctx = { root: dir } as any;
    const r = await tools["notebook.editCell"].fn({ path: file, cellIndex: 1, source: "print('bye')" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.touchedFiles).toEqual([file]);
    const raw = await fs.readFile(path.join(dir, file), "utf-8");
    expect(JSON.parse(raw).cells[1].source.join("")).toBe("print('bye')");
  });
  it("notebook.addCell inserts a new cell and shifts existing ones", async () => {
    const { dir, file } = await makeNotebook();
    const ctx = { root: dir } as any;
    const r = await tools["notebook.addCell"].fn({ path: file, index: 1, cellType: "code", source: "x = 1" }, ctx);
    expect(r.ok).toBe(true);
    const raw = await fs.readFile(path.join(dir, file), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.cells).toHaveLength(3);
    expect(parsed.cells[1].source.join("")).toBe("x = 1");
  });
  it("notebook.deleteCell removes a cell by index", async () => {
    const { dir, file } = await makeNotebook();
    const ctx = { root: dir } as any;
    const r = await tools["notebook.deleteCell"].fn({ path: file, cellIndex: 0 }, ctx);
    expect(r.ok).toBe(true);
    const raw = await fs.readFile(path.join(dir, file), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.cells).toHaveLength(1);
    expect(parsed.cells[0].cell_type).toBe("code");
  });
  it("notebook.execute reports unavailable without an executeNotebookCell callback", async () => {
    const { dir, file } = await makeNotebook();
    const ctx = { root: dir } as any;
    const r = await tools["notebook.execute"].fn({ path: file, cellIndex: 1 }, ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("not available");
  });
  it("notebook.execute delegates to the executeNotebookCell callback", async () => {
    const { dir, file } = await makeNotebook();
    const ctx = { root: dir, executeNotebookCell: async (p: string, i: number) => ({ ok: true, output: `ran ${p}:${i}` }) } as any;
    const r = await tools["notebook.execute"].fn({ path: file, cellIndex: 1 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toBe(`ran ${file}:1`);
  });
  it("notebook.read surfaces an error for a malformed notebook file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arc-notebook-tools-"));
    const file = "broken.ipynb";
    await fs.writeFile(path.join(dir, file), "{ not json", "utf-8");
    const ctx = { root: dir } as any;
    const r = await tools["notebook.read"].fn({ path: file }, ctx);
    expect(r.ok).toBe(false);
  });
});
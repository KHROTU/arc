import { describe, it, expect } from "vitest";
import {
  parseNotebook, serializeNotebook, listCells, readCell, editCellSource, addCell, deleteCell, summarizeOutputs, joinSource, splitSource,
  type NotebookDocument,
} from "../src/notebook/notebook";
function sampleNotebook(): NotebookDocument {
  return {
    cells: [
      { cell_type: "markdown", source: ["# Title\n", "Some text"], metadata: {} },
      { cell_type: "code", source: ["print('hi')"], metadata: {}, execution_count: 1, outputs: [{ output_type: "stream", name: "stdout", text: ["hi\n"] }] },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  };
}
describe("notebook source join/split round-trip", () => {
  it("joins array-of-lines source into a single string", () => {
    expect(joinSource(["a\n", "b\n", "c"])).toBe("a\nb\nc");
  });
  it("splits a string back into nbformat-style lines", () => {
    expect(splitSource("a\nb\nc")).toEqual(["a\n", "b\n", "c"]);
  });
  it("round-trips through join then split", () => {
    const original = ["line one\n", "line two\n", "line three"];
    expect(splitSource(joinSource(original))).toEqual(original);
  });
  it("handles empty source", () => {
    expect(joinSource(undefined)).toBe("");
    expect(splitSource("")).toEqual([]);
  });
});
describe("parseNotebook / serializeNotebook", () => {
  it("parses valid notebook JSON", () => {
    const doc = parseNotebook(JSON.stringify(sampleNotebook()));
    expect(doc.cells).toHaveLength(2);
  });
  it("throws on invalid notebook JSON", () => {
    expect(() => parseNotebook(JSON.stringify({ foo: "bar" }))).toThrow(/missing 'cells'/);
  });
  it("serializes back to valid JSON parseable by parseNotebook", () => {
    const doc = sampleNotebook();
    const raw = serializeNotebook(doc);
    const reparsed = parseNotebook(raw);
    expect(reparsed.cells).toHaveLength(2);
  });
});
describe("listCells", () => {
  it("lists cell type, preview, and whether it has output", () => {
    const doc = sampleNotebook();
    const cells = listCells(doc);
    expect(cells).toEqual([
      { index: 0, cellType: "markdown", preview: "# Title\nSome text", hasOutput: false },
      { index: 1, cellType: "code", preview: "print('hi')", hasOutput: true },
    ]);
  });
  it("truncates long previews", () => {
    const doc: NotebookDocument = { cells: [{ cell_type: "code", source: "x".repeat(200) }] };
    const cells = listCells(doc);
    expect(cells[0].preview.length).toBe(120);
    expect(cells[0].preview.endsWith("…")).toBe(true);
  });
});
describe("readCell", () => {
  it("returns full source and output summary for a code cell", () => {
    const doc = sampleNotebook();
    const cell = readCell(doc, 1);
    expect(cell.source).toBe("print('hi')");
    expect(cell.output?.text).toBe("hi");
    expect(cell.output?.images).toEqual([]);
  });
  it("returns no output field for markdown cells", () => {
    const doc = sampleNotebook();
    const cell = readCell(doc, 0);
    expect(cell.output).toBeUndefined();
  });
  it("throws for an out-of-range index", () => {
    const doc = sampleNotebook();
    expect(() => readCell(doc, 99)).toThrow(/out of range/);
  });
});
describe("summarizeOutputs", () => {
  it("extracts stream text", () => {
    const s = summarizeOutputs([{ output_type: "stream", text: ["a\n", "b"] }]);
    expect(s.text).toBe("a\nb");
    expect(s.images).toEqual([]);
  });
  it("extracts image + text/plain from display_data", () => {
    const s = summarizeOutputs([{ output_type: "display_data", data: { "image/png": "AAAA", "text/plain": ["<Figure>"] } }]);
    expect(s.images).toEqual(["data:image/png;base64,AAAA"]);
    expect(s.text).toBe("<Figure>");
  });
  it("formats error outputs with traceback", () => {
    const s = summarizeOutputs([{ output_type: "error", ename: "ValueError", evalue: "bad", traceback: ["line1", "line2"] }]);
    expect(s.text).toContain("ValueError: bad");
    expect(s.text).toContain("line1");
  });
  it("returns empty summary for undefined outputs", () => {
    const s = summarizeOutputs(undefined);
    expect(s).toEqual({ text: "", images: [] });
  });
});
describe("editCellSource / addCell / deleteCell (pure, immutable)", () => {
  it("editCellSource replaces a cell's source without mutating the original doc", () => {
    const doc = sampleNotebook();
    const updated = editCellSource(doc, 1, "print('bye')");
    expect(readCell(updated, 1).source).toBe("print('bye')");
    expect(readCell(doc, 1).source).toBe("print('hi')");
  });
  it("addCell inserts a new cell at the given index", () => {
    const doc = sampleNotebook();
    const updated = addCell(doc, 1, "code", "x = 1");
    expect(updated.cells).toHaveLength(3);
    expect(readCell(updated, 1).source).toBe("x = 1");
    expect(readCell(updated, 2).source).toBe("print('hi')");
    expect(doc.cells).toHaveLength(2);
  });
  it("deleteCell removes a cell by index", () => {
    const doc = sampleNotebook();
    const updated = deleteCell(doc, 0);
    expect(updated.cells).toHaveLength(1);
    expect(readCell(updated, 0).source).toBe("print('hi')");
    expect(doc.cells).toHaveLength(2);
  });
  it("throws when editing or deleting an out-of-range index", () => {
    const doc = sampleNotebook();
    expect(() => editCellSource(doc, 5, "x")).toThrow(/out of range/);
    expect(() => deleteCell(doc, 5)).toThrow(/out of range/);
  });
});
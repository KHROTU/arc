import { describe, it, expect } from "vitest";
import { applyEdit } from "../src/edit/apply";
describe("applyEdit", () => {
  it("applies an exact match", () => {
    const r = applyEdit({ before: "hello world", search: "world", replace: "there" });
    expect(r.ok).toBe(true);
    expect(r.after).toBe("hello there");
    expect(r.strategy).toBe("exact");
  });
  it("tolerates trailing-whitespace drift", () => {
    const r = applyEdit({ before: "a\n  b   \nc", search: "a\n  b\nc", replace: "a\nb\nc" });
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe("trim");
  });
  it("tolerates blank-line collapse", () => {
    const r = applyEdit({ before: "a\n\n\n\nb", search: "a\n\nb", replace: "a\nb" });
    expect(r.ok).toBe(true);
  });
  it("rejects ambiguous match without replaceAll", () => {
    const r = applyEdit({ before: "x\nfoo\ny\nfoo\nz", search: "foo", replace: "bar" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/multiple locations/);
  });
  it("replaces all with replaceAll", () => {
    const r = applyEdit({ before: "x\nfoo\ny\nfoo\nz", search: "foo", replace: "bar", replaceAll: true });
    expect(r.ok).toBe(true);
    expect(r.matches).toBe(2);
    expect(r.after).toBe("x\nbar\ny\nbar\nz");
  });
  it("uses windowed fuzzy match when whitespace differs", () => {
    const r = applyEdit({
      before: "function f() {\n    return 1;\n}",
      search: "function f() {\n  return 1;\n}",
      replace: "function f() {\n  return 2;\n}",
    });
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe("fuzzy");
  });
  it("returns ok=false with a clear error when no match", () => {
    const r = applyEdit({ before: "hello", search: "missing", replace: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });
  it("appends when search is empty", () => {
    const r = applyEdit({ before: "abc", search: "", replace: "def" });
    expect(r.ok).toBe(true);
    expect(r.after).toBe("abcdef");
  });
  it("applies a SEARCH/REPLACE block passed as the search argument", () => {
    const block = `src/foo.ts
<<<<<<< SEARCH
function add(a, b) {
  return a + b
}
=======
function add(a, b) {
  return a + b + 0
}
>>>>>>> REPLACE`;
    const r = applyEdit({
      before: "function add(a, b) {\n  return a + b\n}\n",
      search: block,
      replace: "",
    });
    expect(r.ok).toBe(true);
    expect(r.after).toBe("function add(a, b) {\n  return a + b + 0\n}\n");
    expect(r.strategy).toBe("exact");
  });
  it("applies a SEARCH/REPLACE block without a filename header", () => {
    const block = `<<<<<<< SEARCH
const x = 1
=======
const x = 2
>>>>>>> REPLACE`;
    const r = applyEdit({
      before: "const x = 1\n",
      search: block,
      replace: "",
    });
    expect(r.ok).toBe(true);
    expect(r.after).toBe("const x = 2\n");
  });
  it("extracts diff block content and falls back to fuzzy match when whitespace drifts", () => {
    const block = `<<<<<<< SEARCH
function f() {
  return 1;
}
=======
function f() {
  return 2;
}
>>>>>>> REPLACE`;
    const r = applyEdit({
      before: "function f() {\n    return 1;\n}\n",
      search: block,
      replace: "",
    });
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe("fuzzy");
    expect(r.after).toBe("function f() {\n  return 2;\n}\n");
  });
  it("returns a clear error when a diff block is missing the divider", () => {
    const r = applyEdit({
      before: "hello world",
      search: "<<<<<<< SEARCH\nworld\n>>>>>>> REPLACE",
      replace: "ignored",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });
});
import { describe, it, expect } from "vitest";
import { parseDiff, applyDiff } from "../src/edit/diff-format";
describe("parseDiff", () => {
  it("parses a single SEARCH/REPLACE block", () => {
    const diff = `file.py
<<<<<<< SEARCH
def calculate_total(price, tax):
    return price + tax
=======
def calculate_total(price, tax, discount=0):
    return (price - discount) + tax
>>>>>>> REPLACE`;
    const r = parseDiff(diff);
    expect(r.ok).toBe(true);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].file).toBe("file.py");
    expect(r.blocks[0].search).toBe("def calculate_total(price, tax):\n    return price + tax");
    expect(r.blocks[0].replace).toBe("def calculate_total(price, tax, discount=0):\n    return (price - discount) + tax");
  });
  it("parses multiple blocks", () => {
    const diff = `a.ts
<<<<<<< SEARCH
foo
=======
bar
>>>>>>> REPLACE
b.ts
<<<<<<< SEARCH
baz
=======
qux
>>>>>>> REPLACE`;
    const r = parseDiff(diff);
    expect(r.ok).toBe(true);
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0].file).toBe("a.ts");
    expect(r.blocks[1].file).toBe("b.ts");
  });
  it("ignores markdown fences when present", () => {
    const diff = "```diff\nfile.py\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n```";
    const r = parseDiff(diff);
    expect(r.ok).toBe(true);
    expect(r.blocks[0].file).toBe("file.py");
    expect(r.blocks[0].replace).toBe("b");
  });
  it("rejects missing SEARCH header", () => {
    const diff = `file.py\nfoo\n=======\nbar\n>>>>>>> REPLACE`;
    const r = parseDiff(diff);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/SEARCH/);
  });
});
describe("applyDiff", () => {
  it("applies the parsed diff to a file map", () => {
    const files: Record<string, string> = {
      "file.py": "def calculate_total(price, tax):\n    return price + tax\n",
    };
    const diff = `file.py
<<<<<<< SEARCH
def calculate_total(price, tax):
    return price + tax
=======
def calculate_total(price, tax, discount=0):
    return (price - discount) + tax
>>>>>>> REPLACE`;
    const r = applyDiff({ files, diff });
    expect(r.ok).toBe(true);
    expect(r.results[0].ok).toBe(true);
    expect(r.files["file.py"]).toContain("discount=0");
    expect(r.files["file.py"]).toContain("(price - discount) + tax");
  });
  it("creates a new file when the file did not exist", () => {
    const files: Record<string, string> = {};
    const diff = `new.ts
<<<<<<< SEARCH

=======
export const x = 1;
>>>>>>> REPLACE`;
    const r = applyDiff({ files, diff });
    expect(r.ok).toBe(true);
    expect(r.files["new.ts"]).toContain("export const x = 1;");
  });
  it("reports an error for non-matching search text", () => {
    const files: Record<string, string> = { "x.ts": "hello\n" };
    const diff = `x.ts
<<<<<<< SEARCH
not present
=======
anything
>>>>>>> REPLACE`;
    const r = applyDiff({ files, diff });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/not found|search text not found/);
  });
});
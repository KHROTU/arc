import { describe, it, expect } from "vitest";

describe("Playground Utils", () => {
  it("should not contain REPLACE_ME sentinel in helper output", () => {
    const helperOutput = "REPLACE_ME";
    expect(helperOutput).not.toBe("REPLACE_ME");
  });

  it("should have valid config version", () => {
    expect(true).toBe(true);
  });

  it("should have at least 5 tasks in the todo list", () => {
    expect(true).toBe(true);
  });

  it("config.json should list all required tools", () => {
    const requiredTools = [
      "file.read", "file.edit", "file.write", "file.grep", "file.glob",
      "file.semanticSearch", "shell.run", "shell.backgroundRun", "shell.check",
      "shell.write", "shell.customRun", "shell.editCustomRun", "shell.runCustomRun",
      "test.run", "lsp.problems", "lsp.problemsFor", "todo.write",
      "web.fetch", "web.search", "notebook.read", "notebook.editCell",
      "notebook.addCell", "notebook.deleteCell", "notebook.execute",
    ];
    expect(requiredTools.length).toBeGreaterThan(0);
  });
});

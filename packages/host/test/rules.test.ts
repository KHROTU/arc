import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { RuleRegistry } from "../src/rules/registry";
import { getWorkspaceArcDir } from "../src/arc-dir";
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
describe("RuleRegistry", () => {
  let root: string;
  let rulesDir: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-rules-"));
    rulesDir = path.join(getWorkspaceArcDir(root), "rules");
    await fs.mkdir(rulesDir, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(getWorkspaceArcDir(root), { recursive: true, force: true });
  });
  it("loads rules from the workspace .arc/rules directory", async () => {
    await fs.writeFile(path.join(rulesDir, "style.md"), "---\nname: style\nglob: **/*.ts\ndescription: Style rules\n---\n\nUse 2-space indent.", "utf-8");
    const registry = new RuleRegistry(root);
    await registry.load();
    const rule = registry.get("style");
    expect(rule?.description).toBe("Style rules");
    expect(rule?.body).toBe("Use 2-space indent.");
  });
  it("loads flat project-local rules without frontmatter", async () => {
    const projectRulesDir = path.join(root, ".arc", "rules");
    await fs.mkdir(projectRulesDir, { recursive: true });
    await fs.writeFile(path.join(projectRulesDir, "playground.md"), "# Playground conventions\n\nAvoid destructive commands.", "utf-8");
    const registry = new RuleRegistry(root);
    await registry.load();
    const rule = registry.get("playground");
    expect(rule?.description).toBe("Playground conventions");
    expect(rule?.body).toContain("Avoid destructive commands.");
  });
  it("skips invalid rule files gracefully without affecting others", async () => {
    await fs.writeFile(path.join(rulesDir, "good.md"), "---\nname: good\ndescription: Good rule\n---\n\nBody", "utf-8");
    await fs.writeFile(path.join(rulesDir, "bad.md"), "not frontmatter, no name/description markers at all just prose", "utf-8");
    const registry = new RuleRegistry(root);
    await registry.load();
    expect(registry.get("good")).toBeDefined();
    expect(registry.list().length).toBe(1);
  });
  it("hot-reloads on file changes and reports a diff", async () => {
    await fs.writeFile(path.join(rulesDir, "a.md"), "---\nname: a\ndescription: A rule\n---\n\nOriginal body", "utf-8");
    const registry = new RuleRegistry(root);
    await registry.load();
    const onChange = vi.fn();
    const dispose = registry.watch(onChange, 30);
    try {
      await fs.writeFile(path.join(rulesDir, "b.md"), "---\nname: b\ndescription: B rule\n---\n\nNew rule", "utf-8");
      await waitFor(() => onChange.mock.calls.length > 0);
      expect(onChange).toHaveBeenCalledWith({ added: ["b"], removed: [], changed: [] });
      onChange.mockClear();
      await fs.writeFile(path.join(rulesDir, "a.md"), "---\nname: a\ndescription: A rule\n---\n\nUpdated body", "utf-8");
      await waitFor(() => onChange.mock.calls.length > 0);
      expect(onChange).toHaveBeenCalledWith({ added: [], removed: [], changed: ["a"] });
      onChange.mockClear();
      await fs.rm(path.join(rulesDir, "b.md"));
      await waitFor(() => onChange.mock.calls.length > 0);
      expect(onChange).toHaveBeenCalledWith({ added: [], removed: ["b"], changed: [] });
    } finally {
      dispose();
    }
  });
});
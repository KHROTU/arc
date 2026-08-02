import { describe, it, expect, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { SkillRegistry } from "../src/skills/registry";
import { getWorkspaceArcDir } from "../src/arc-dir";
describe("SkillRegistry", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).flatMap((root) => [
      fs.rm(root, { recursive: true, force: true }),
      fs.rm(getWorkspaceArcDir(root), { recursive: true, force: true }),
    ]));
  });
  it("loads flat project-local Markdown skills", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-skills-"));
    roots.push(root);
    const skillsDir = path.join(root, ".arc", "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(path.join(skillsDir, "playground.md"), "# Playground skill\n\nUse the build script after edits.", "utf-8");
    const registry = new SkillRegistry(root);
    await registry.load();
    expect(registry.get("playground")?.description).toBe("Playground skill");
    await expect(registry.readBody("playground")).resolves.toContain("Use the build script after edits.");
  });
});
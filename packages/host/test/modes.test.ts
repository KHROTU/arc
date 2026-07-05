import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { ModeRegistry } from "../src/modes/registry";
import { getWorkspaceArcDir } from "../src/arc-dir";
describe("ModeRegistry save/delete", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-modes-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(getWorkspaceArcDir(root), { recursive: true, force: true });
  });
  it("saves a new custom mode and persists it to disk", async () => {
    const registry = new ModeRegistry(root);
    await registry.load();
    await registry.save({ slug: "reviewer", roleDefinition: "You review code.", allowedTools: ["file.read", "file.grep"], description: "Code reviewer", whenToUse: "When reviewing PRs" });
    expect(registry.get("reviewer")?.roleDefinition).toBe("You review code.");
    const raw = await fs.readFile(path.join(getWorkspaceArcDir(root), "modes", "reviewer.toml"), "utf-8");
    expect(raw).toContain('slug = "reviewer"');
  });
  it("reloads a saved custom mode from disk", async () => {
    const registry = new ModeRegistry(root);
    await registry.load();
    await registry.save({ slug: "reviewer", roleDefinition: "You review code.", allowedTools: ["file.read"], description: "d", whenToUse: "w", model: "gpt-5" });
    const registry2 = new ModeRegistry(root);
    await registry2.load();
    const mode = registry2.get("reviewer");
    expect(mode?.allowedTools).toEqual(["file.read"]);
    expect(mode?.model).toBe("gpt-5");
  });
  it("rejects a mode with an invalid slug", async () => {
    const registry = new ModeRegistry(root);
    await registry.load();
    await expect(registry.save({ slug: "Has Spaces", roleDefinition: "x", allowedTools: ["file.read"], description: "", whenToUse: "" })).rejects.toThrow();
  });
  it("rejects a mode with no allowed tools", async () => {
    const registry = new ModeRegistry(root);
    await registry.load();
    await expect(registry.save({ slug: "empty", roleDefinition: "x", allowedTools: [], description: "", whenToUse: "" })).rejects.toThrow();
  });
  it("deletes a custom mode and falls back to the builtin definition if one exists", async () => {
    const registry = new ModeRegistry(root);
    await registry.load();
    const originalCode = registry.get("code");
    await registry.save({ slug: "code", roleDefinition: "custom override", allowedTools: ["file.read"], description: "", whenToUse: "" });
    expect(registry.get("code")?.roleDefinition).toBe("custom override");
    await registry.delete("code");
    expect(registry.get("code")?.roleDefinition).toBe(originalCode?.roleDefinition);
    expect(registry.sourceOf("code")).toBe("builtin");
  });
  it("deletes a fully custom mode entirely when no builtin exists", async () => {
    const registry = new ModeRegistry(root);
    await registry.load();
    await registry.save({ slug: "reviewer", roleDefinition: "x", allowedTools: ["file.read"], description: "", whenToUse: "" });
    await registry.delete("reviewer");
    expect(registry.get("reviewer")).toBeUndefined();
  });
});
import * as path from "node:path";
import * as fsp from "node:fs/promises";
import { getArcDir, getWorkspaceArcDir } from "../arc-dir.js";
import { parseSkillMd, readSkillBody } from "./parser.js";
import type { SkillMetadata } from "./types.js";
export { type SkillMetadata } from "./types.js";
export class SkillRegistry {
  private skills = new Map<string, SkillMetadata>();
  private workspaceRoot: string;
  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot ?? "";
  }
  async load(): Promise<void> {
    this.skills.clear();
    if (this.workspaceRoot) {
      const dir = path.join(getWorkspaceArcDir(this.workspaceRoot), "skills");
      await this.loadFromDir(dir, "workspace");
    }
    await this.loadFromDir(path.join(getArcDir(), "skills"), "global");
  }
  private async loadFromDir(baseDir: string, scope: "workspace" | "global"): Promise<void> {
    let entries: string[];
    try {
      entries = await readDirSafe(baseDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const skillDir = path.join(baseDir, entry);
      const skillMd = path.join(skillDir, "SKILL.md");
      try {
        const stat = await statSafe(skillDir);
        if (!stat?.isDirectory()) continue;
        const meta = await parseSkillMd(skillMd, scope);
        if (meta) this.skills.set(meta.name, meta);
      } catch {
      }
    }
  }
  get(name: string): SkillMetadata | undefined {
    return this.skills.get(name);
  }
  list(): SkillMetadata[] {
    return [...this.skills.values()];
  }
  async readBody(name: string): Promise<string | undefined> {
    const meta = this.skills.get(name);
    if (!meta) return undefined;
    return readSkillBody(meta.path);
  }
  titlesForSystemPrompt(): string {
    const skills = this.list();
    const lines = skills.map((s) => {
      const desc = s.shortDescription ?? s.description;
      return `- **${s.name}**: ${desc}`;
    });
    if (!lines.length) lines.push("(No custom skills loaded. Create a SKILL.md in .arc/skills/<name>/ to add skills.)");
    return `\n\n## Available Skills\n\n${lines.join("\n")}\n`;
  }
}
async function readDirSafe(dir: string): Promise<string[]> {
  return fsp.readdir(dir);
}
async function statSafe(p: string): Promise<{ isDirectory(): boolean } | null> {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}
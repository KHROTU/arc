import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getArcDir, getWorkspaceArcDir } from "../arc-dir.js";
import type { RuleEntry } from "./types.js";
export class RuleRegistry {
  private rules = new Map<string, RuleEntry>();
  private workspaceRoot: string;
  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot ?? "";
  }
  async load(): Promise<void> {
    this.rules.clear();
    if (this.workspaceRoot) await this.loadFromDir(getWorkspaceArcDir(this.workspaceRoot), "workspace");
    await this.loadFromDir(getArcDir(), "global");
  }
  private async loadFromDir(baseDir: string, scope: "workspace" | "global"): Promise<void> {
    const rulesDir = path.join(baseDir, "rules");
    let entries: string[];
    try { entries = await fs.readdir(rulesDir); } catch { return; }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      try {
        const raw = await fs.readFile(path.join(rulesDir, entry), "utf-8");
        const parsed = parseRule(entry.replace(/\.md$/, ""), raw, scope);
        if (parsed) this.rules.set(parsed.name, parsed);
      } catch {}
    }
  }
  get(name: string): RuleEntry | undefined { return this.rules.get(name); }
  list(): RuleEntry[] { return [...this.rules.values()]; }
  async create(name: string, glob: string, description: string, body: string, scope: "workspace" | "global" = "workspace"): Promise<void> {
    const dir = path.join(scope === "global" ? getArcDir() : getWorkspaceArcDir(this.workspaceRoot), "rules");
    await fs.mkdir(dir, { recursive: true });
    const content = `---\nname: ${name}\nglob: ${glob}\ndescription: ${description}\n---\n\n${body}`;
    await fs.writeFile(path.join(dir, `${name}.md`), content, "utf-8");
    this.rules.set(name, { name, glob, description, body, scope });
  }
}
function parseRule(name: string, raw: string, scope: "workspace" | "global"): RuleEntry | undefined {
  const fm = extractYaml(raw);
  const body = bodyAfterYaml(raw);
  if (!fm.name && !fm.description) return undefined;
  return {
    name: (fm.name as string) || name,
    glob: fm.glob as string | undefined,
    description: (fm.description as string) || "",
    body: body || raw,
    scope,
  };
}
function extractYaml(raw: string): Record<string, unknown> {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  let end = -1;
  for (let i = 1; i < lines.length; i++) { if (lines[i].trim() === "---") { end = i; break; } }
  if (end === -1) return {};
  const result: Record<string, unknown> = {};
  for (const line of lines.slice(1, end)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return result;
}
function bodyAfterYaml(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return raw;
  let end = -1;
  for (let i = 1; i < lines.length; i++) { if (lines[i].trim() === "---") { end = i; break; } }
  return end === -1 ? raw : lines.slice(end + 1).join("\n").trim();
}
export type { RuleEntry } from "./types.js";
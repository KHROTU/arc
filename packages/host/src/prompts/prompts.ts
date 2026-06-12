import * as fs from "node:fs/promises";
import * as path from "node:path";
export type PromptScope = "global" | "workspace" | "mode";
export interface PromptFile {
  scope: PromptScope;
  path?: string;
  body: string;
  meta?: Record<string, string>;
}
export interface PromptContext {
  workspace?: string;
  os?: string;
  date?: string;
  openFiles?: string[];
  diagnostics?: string;
  problems?: string;
}
const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;
export function render(template: string, ctx: PromptContext): string {
  return template.replace(VAR_RE, (_, name) => {
    const v = (ctx as Record<string, unknown>)[name];
    return v === undefined || v === null ? "" : String(v);
  });
}
export async function loadWorkspacePrompts(root: string): Promise<PromptFile[]> {
  const out: PromptFile[] = [];
  for (const rel of [".arc/prompt.md", "AGENTS.md", "CLAUDE.md", ".arc/instructions.md"]) {
    const p = path.join(root, rel);
    try {
      const body = await fs.readFile(p, "utf-8");
      out.push({ scope: "workspace", path: p, body });
} catch {  }
  }
  try {
    const dir = path.join(root, ".arc/prompts");
    const entries = await fs.readdir(dir);
    for (const e of entries) {
      if (!e.endsWith(".md")) continue;
      const p = path.join(dir, e);
      const body = await fs.readFile(p, "utf-8");
      out.push({ scope: "mode", path: p, body, meta: { mode: e.replace(/\.md$/, "") } });
    }
} catch {  }
  return out;
}
export function mergePrecedence(parts: PromptFile[]): string {
  return parts
    .slice()
    .reverse()
    .map((p) => p.body.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}
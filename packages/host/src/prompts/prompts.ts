import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getArcDir, getWorkspaceArcDir } from "../arc-dir.js";
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
export async function loadGlobalPrompts(): Promise<PromptFile[]> {
  const out: PromptFile[] = [];
  const arcDir = getArcDir();
  for (const rel of ["instructions.md"]) {
    const p = path.join(arcDir, rel);
    try {
      const body = await fs.readFile(p, "utf-8");
      out.push({ scope: "global", path: p, body });
} catch {  }
  }
  return out;
}
export async function loadWorkspacePrompts(root: string): Promise<PromptFile[]> {
  const out: PromptFile[] = [];
  const wsDir = getWorkspaceArcDir(root);
  for (const rel of ["AGENTS.md", "CLAUDE.md"]) {
    const p = path.join(root, rel);
    try {
      const body = await fs.readFile(p, "utf-8");
      out.push({ scope: "workspace", path: p, body });
} catch {  }
  }
  for (const rel of ["prompt.md", "instructions.md"]) {
    const p = path.join(wsDir, rel);
    try {
      const body = await fs.readFile(p, "utf-8");
      out.push({ scope: "workspace", path: p, body });
} catch {  }
  }
  try {
    const dir = path.join(wsDir, "prompts");
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
export function injectRelevantRules(prompts: PromptFile[], activeFilePath?: string, taskContext?: string): PromptFile[] {
  if (!activeFilePath && !taskContext) return prompts;
  const result = [...prompts];
  const rules = collectRules(prompts);
  if (!rules.length) return result;
  const matched: string[] = [];
  const ext = activeFilePath ? path.extname(activeFilePath).toLowerCase() : "";
  const fileRel = activeFilePath ? activeFilePath.toLowerCase().replace(/\\/g, "/") : "";
  for (const rule of rules) {
    let match = false;
    if (rule.glob) {
      const globRe = new RegExp("^" + rule.glob.replace(/\*/g, "[^/]*").replace(/\./g, "\\.").replace(/\*\*/g, ".*") + "$", "i");
      if (globRe.test(fileRel)) match = true;
    }
    if (!match && rule.extensions && rule.extensions.includes(ext)) match = true;
    if (!match && rule.keywords && taskContext) {
      const ctx = taskContext.toLowerCase();
      if (rule.keywords.some((kw: string) => ctx.includes(kw.toLowerCase()))) match = true;
    }
    if (match) matched.push(rule.body);
  }
  if (matched.length) {
    result.push({
      scope: "workspace",
      body: `## Relevant rules for current context\n\n${matched.join("\n\n")}`,
    });
  }
  return result;
}
interface InlineRule {
  body: string;
  glob?: string;
  extensions?: string[];
  keywords?: string[];
}
function collectRules(prompts: PromptFile[]): InlineRule[] {
  const rules: InlineRule[] = [];
  for (const p of prompts) {
    if (!p.body) continue;
    const sections = p.body.split(/\n(?=###?\s+)/);
    for (const section of sections) {
      const headerMatch = section.match(/^###?\s+(.+)/m);
      if (!headerMatch) continue;
      const body = section.trim();
      const globs = extractAnnotations(section, "glob");
      const exts = extractAnnotations(section, "ext");
      const kws = extractAnnotations(section, "keywords");
      if (globs.length || exts.length || kws.length) {
        rules.push({
          body,
          glob: globs.length ? globs.join("|") : undefined,
          extensions: exts.length ? exts : undefined,
          keywords: kws,
        });
      }
    }
  }
  return rules;
}
function extractAnnotations(text: string, name: string): string[] {
  const re = new RegExp(`@${name}\\s+(.+)`, "gi");
  const results: string[] = [];
  for (const m of text.matchAll(re)) {
    results.push(...(m[1]?.split(/[\s,]+/).filter(Boolean) ?? []));
  }
  return results;
}
export function mergePrecedence(parts: PromptFile[]): string {
  return parts
    .slice()
    .reverse()
    .map((p) => p.body.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}
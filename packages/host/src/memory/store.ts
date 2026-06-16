import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getArcDir, getWorkspaceArcDir } from "../arc-dir.js";
import type { MemoryEntry } from "./types.js";
export async function loadMemory(workspaceRoot: string, scope: "workspace" | "global" = "workspace"): Promise<MemoryEntry[]> {
  const p = memoryPath(workspaceRoot, scope);
  try {
    const raw = await fs.readFile(p, "utf-8");
    return parseMemoryMd(raw);
  } catch {
    return [];
  }
}
export async function addMemory(workspaceRoot: string, category: string, content: string, scope: "workspace" | "global" = "workspace"): Promise<MemoryEntry> {
  const entries = await loadMemory(workspaceRoot, scope);
  const entry: MemoryEntry = {
    category,
    content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  entries.push(entry);
  await saveMemory(workspaceRoot, entries, scope);
  return entry;
}
export async function editMemory(workspaceRoot: string, index: number, content: string, scope: "workspace" | "global" = "workspace"): Promise<boolean> {
  const entries = await loadMemory(workspaceRoot, scope);
  if (index < 0 || index >= entries.length) return false;
  entries[index].content = content;
  entries[index].updatedAt = new Date().toISOString();
  await saveMemory(workspaceRoot, entries, scope);
  return true;
}
export async function deleteMemory(workspaceRoot: string, index: number, scope: "workspace" | "global" = "workspace"): Promise<boolean> {
  const entries = await loadMemory(workspaceRoot, scope);
  if (index < 0 || index >= entries.length) return false;
  entries.splice(index, 1);
  await saveMemory(workspaceRoot, entries, scope);
  return true;
}
async function saveMemory(workspaceRoot: string, entries: MemoryEntry[], scope: "workspace" | "global"): Promise<void> {
  const p = memoryPath(workspaceRoot, scope);
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const groups = new Map<string, MemoryEntry[]>();
  for (const e of entries) {
    const list = groups.get(e.category) ?? [];
    list.push(e);
    groups.set(e.category, list);
  }
  const lines: string[] = [];
  for (const [cat, list] of groups) {
    lines.push(`## ${cat}`);
    for (const e of list) {
      lines.push(`- **${formatDate(e.createdAt)}**: ${e.content}`);
    }
    lines.push("");
  }
  await fs.writeFile(p, lines.join("\n"), "utf-8");
}
function memoryPath(workspaceRoot: string, scope: "workspace" | "global"): string {
  const dir = scope === "global" ? getArcDir() : getWorkspaceArcDir(workspaceRoot);
  return path.join(dir, "MEMORY.md");
}
function parseMemoryMd(raw: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  let category = "general";
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { category = h2[1].trim(); continue; }
    const bullet = line.match(/^-\s+\*\*([^*]+)\*\*:\s*(.+)/);
    if (bullet) {
      entries.push({
        category,
        content: bullet[2].trim(),
        createdAt: bullet[1].trim(),
        updatedAt: bullet[1].trim(),
      });
    }
  }
  return entries;
}
function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return iso;
  }
}
export type { MemoryEntry } from "./types.js";
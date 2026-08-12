import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getWorkspaceArcDir } from "../arc-dir.js";
const MAX_NOTES = 80;
const MAX_INJECT_CHARS = 2000;
export const NOTES_FILENAME = "NOTES.md";
function notesPath(workspaceRoot: string): string {
  return path.join(getWorkspaceArcDir(workspaceRoot), NOTES_FILENAME);
}
function formatStamp(ts: Date): string {
  return ts.toISOString().slice(0, 16).replace("T", " ");
}
export async function appendNote(workspaceRoot: string, text: string): Promise<{ index: number; total: number }> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { index: -1, total: 0 };
  const p = notesPath(workspaceRoot);
  let lines: string[] = [];
  try {
    const raw = await fs.readFile(p, "utf-8");
    lines = raw.split(/\r?\n/).filter(Boolean);
  } catch {}
  const line = `- [${formatStamp(new Date())}] ${clean}`;
  if (lines.length > 0 && lines[lines.length - 1].slice(5) === line.slice(5)) {
    return { index: lines.length - 1, total: lines.length };
  }
  lines.push(line);
  if (lines.length > MAX_NOTES) lines = lines.slice(-MAX_NOTES);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, lines.join("\n") + "\n", "utf-8");
  return { index: lines.length - 1, total: lines.length };
}
export async function loadNotes(workspaceRoot: string, maxChars: number = MAX_INJECT_CHARS): Promise<string> {
  try {
    const raw = await fs.readFile(notesPath(workspaceRoot), "utf-8");
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (trimmed.length <= maxChars) return trimmed;
    return trimmed.slice(-maxChars);
  } catch {
    return "";
  }
}
export async function clearNotes(workspaceRoot: string): Promise<void> {
  try {
    await fs.unlink(notesPath(workspaceRoot));
  } catch {}
}
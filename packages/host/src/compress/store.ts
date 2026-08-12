import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { getWorkspaceArcDir } from "../arc-dir.js";
const MAX_BLOBS = 200;
const MAX_DIR_BYTES = 64 * 1024 * 1024;
function contextDir(workspaceRoot: string): string {
  return path.join(getWorkspaceArcDir(workspaceRoot), "context");
}
export async function saveBlob(workspaceRoot: string, _toolName: string, content: string): Promise<string> {
  const full = createHash("sha256").update(content).digest("hex");
  const dir = contextDir(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${full}.txt`);
  try {
    await fs.writeFile(target, content, { encoding: "utf-8", mode: 0o600 });
  } catch {
    try {
      await fs.access(target);
    } catch {
      throw new Error("failed to persist context blob");
    }
  }
  await prune(dir);
  return full.slice(0, 12);
}
export async function loadBlob(workspaceRoot: string, id: string): Promise<string | undefined> {
  const safe = String(id ?? "").trim().replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (safe.length < 8 || safe.length > 64) return undefined;
  const dir = contextDir(workspaceRoot);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return undefined;
  }
  const match = entries.find((e) => e.toLowerCase().startsWith(safe) && e.endsWith(".txt"));
  if (!match) return undefined;
  try {
    return await fs.readFile(path.join(dir, match), "utf-8");
  } catch {
    return undefined;
  }
}
async function prune(dir: string): Promise<void> {
  let entries: { name: string; size: number; mtimeMs: number }[] = [];
  try {
    const names = await fs.readdir(dir);
    const stats = await Promise.all(
      names.map(async (n) => {
        try {
          const s = await fs.stat(path.join(dir, n));
          return { name: n, size: s.size, mtimeMs: s.mtimeMs };
        } catch {
          return undefined;
        }
      }),
    );
    entries = stats.filter((s): s is { name: string; size: number; mtimeMs: number } => s !== undefined);
  } catch {
    return;
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  while (entries.length > MAX_BLOBS || total > MAX_DIR_BYTES) {
    const oldest = entries.shift();
    if (!oldest) break;
    try {
      await fs.unlink(path.join(dir, oldest.name));
      total -= oldest.size;
    } catch {}
  }
}
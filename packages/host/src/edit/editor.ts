import * as fs from "node:fs/promises";
import * as path from "node:path";
import { applyEdit, type ApplyEditResult } from "./apply.js";
import { fileLock } from "./lock.js";
export class FileEditor {
  constructor(private root: string) {}
  async read(file: string, opts?: { offset?: number; limit?: number }): Promise<string> {
    const full = this.resolve(file);
    const raw = await fs.readFile(full, "utf-8");
    const offset = opts?.offset ?? 1;
    const limit = opts?.limit;
    if (offset === 1 && limit === undefined) return raw;
    const lines = raw.split("\n");
    const start = Math.max(1, offset);
    const end = limit !== undefined ? Math.min(lines.length, start + limit - 1) : lines.length;
    return lines.slice(start - 1, end).join("\n");
  }
  async exists(file: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(file));
      return true;
    } catch {
      return false;
    }
  }
  async apply(file: string, search: string, replace: string, opts?: { replaceAll?: boolean }): Promise<ApplyEditResult & { file: string }> {
    const full = this.resolve(file);
    await fileLock.acquire(full);
    try {
      let before = "";
      let created = false;
      try {
        before = await fs.readFile(full, "utf-8");
      } catch {
        created = true;
      }
      const result = applyEdit({ before, search, replace, replaceAll: opts?.replaceAll });
      if (!result.ok && !created) {
        return { ...result, file };
      }
      if (created) {
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, replace, "utf-8");
        return {
          ok: true,
          after: replace,
          matches: 1,
          strategy: "write",
          diff: [{ value: "", count: 0, added: false, removed: false }, { value: replace, count: 0, added: true, removed: false }],
          file,
        };
      }
      await fs.writeFile(full, result.after, "utf-8");
      return { ...result, file };
    } finally {
      fileLock.release(full);
    }
  }
  resolve(file: string): string {
    return path.isAbsolute(file) ? path.normalize(file) : path.join(this.root, file);
  }
}
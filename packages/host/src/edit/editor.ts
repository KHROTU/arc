import * as fs from "node:fs/promises";
import * as path from "node:path";
import { applyEdit, type ApplyEditResult } from "./apply.js";
export class FileEditor {
  constructor(private root: string) {}
  async read(file: string): Promise<string> {
    const full = this.resolve(file);
    return fs.readFile(full, "utf-8");
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
        strategy: "append",
        diff: [{ value: "", count: 0, added: false, removed: false }, { value: replace, count: 0, added: true, removed: false }],
        file,
      };
    }
    await fs.writeFile(full, result.after, "utf-8");
    return { ...result, file };
  }
  resolve(file: string): string {
    const full = path.isAbsolute(file) ? file : path.join(this.root, file);
    if (!this.isInside(full)) {
      throw new Error(`Path escapes workspace: ${file}`);
    }
    return full;
  }
  private isInside(full: string): boolean {
    const rel = path.relative(this.root, full);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }
}
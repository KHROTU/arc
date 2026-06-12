import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
export interface TurnSnapshot {
  turnId: string;
  ts: number;
  files: Record<string, string>;
  root: string;
  todoItems?: { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" }[];
}
export type TurnSnapshotWithTodo = TurnSnapshot;
export interface CheckpointStoreOptions {
  dir: string;
}
export class CheckpointStore {
  constructor(private opts: CheckpointStoreOptions) {}
  static hash(content: string | Buffer): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
  }
  async snapshot(turnId: string, root: string, files: string[], todoItems?: TurnSnapshot["todoItems"]): Promise<TurnSnapshot> {
    const map: Record<string, string> = {};
    for (const rel of files) {
      const abs = path.join(root, rel);
      let content: Buffer;
      try {
        content = await fs.readFile(abs);
      } catch {
        map[rel] = "__none__";
        continue;
      }
      const h = CheckpointStore.hash(content);
      map[rel] = h;
      const blobPath = this.blobPath(h);
      try {
        await fs.access(blobPath);
      } catch {
        await fs.mkdir(path.dirname(blobPath), { recursive: true });
        await fs.writeFile(blobPath, content);
      }
    }
    const snap: TurnSnapshot = { turnId, ts: Date.now(), files: map, root };
    if (todoItems && todoItems.length) snap.todoItems = todoItems;
    const metaPath = this.metaPath(root, turnId);
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(snap, null, 2), "utf-8");
    return snap;
  }
  async listTurns(root: string): Promise<string[]> {
    const dir = this.turnsDir(root);
    try {
      const entries = await fs.readdir(dir);
      return entries.filter((e) => e.endsWith(".json")).map((e) => e.replace(/\.json$/, "")).sort();
    } catch {
      return [];
    }
  }
  async load(root: string, turnId: string): Promise<TurnSnapshot | undefined> {
    try {
      const raw = await fs.readFile(this.metaPath(root, turnId), "utf-8");
      return JSON.parse(raw) as TurnSnapshot;
    } catch {
      return undefined;
    }
  }
  async restore(root: string, turnId: string): Promise<{ restored: string[]; conflicts: string[] }> {
    const snap = await this.load(root, turnId);
    if (!snap) throw new Error(`No snapshot for turn ${turnId}`);
    const restored: string[] = [];
    const conflicts: string[] = [];
    for (const [rel, hash] of Object.entries(snap.files)) {
      const abs = path.join(root, rel);
      if (hash === "__none__") {
        try {
          await fs.unlink(abs);
          restored.push(rel);
        } catch {
        }
        continue;
      }
      let current: Buffer | undefined;
      try {
        current = await fs.readFile(abs);
      } catch {
      }
      if (current && CheckpointStore.hash(current) !== hash) {
        conflicts.push(rel);
      }
      const blob = await fs.readFile(this.blobPath(hash));
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, blob);
      restored.push(rel);
    }
    const all = await this.listTurns(root);
    const idx = all.indexOf(turnId);
    for (const later of all.slice(idx + 1)) {
      await fs.unlink(this.metaPath(root, later)).catch(() => undefined);
    }
    return { restored, conflicts };
  }
  async clear(root: string) {
    const dir = this.turnsDir(root);
    try {
      const entries = await fs.readdir(dir);
      await Promise.all(entries.map((e) => fs.unlink(path.join(dir, e))));
} catch {  }
  }
  private blobPath(hash: string): string {
    return path.join(this.opts.dir, "blobs", hash.slice(0, 2), hash);
  }
  private turnsDir(root: string): string {
    const id = encodeURIComponent(root);
    return path.join(this.opts.dir, "turns", id);
  }
  private metaPath(root: string, turnId: string): string {
    return path.join(this.turnsDir(root), `${turnId}.json`);
  }
}
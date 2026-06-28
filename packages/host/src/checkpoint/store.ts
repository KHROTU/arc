import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
export interface TurnSnapshot {
  turnId: string;
  ts: number;
  files: Record<string, string>;
  root: string;
  todoItems?: { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" | "blocked" | "failed" }[];
  label?: string;
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
  async snapshot(turnId: string, root: string, files: string[], todoItems?: TurnSnapshot["todoItems"], label?: string): Promise<TurnSnapshot> {
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
    if (label) snap.label = label;
    const metaPath = this.metaPath(root, turnId);
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(snap, null, 2), "utf-8");
    return snap;
  }
  async listTurns(root: string): Promise<string[]> {
    const dir = this.turnsDir(root);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const turns = entries
        .filter((e) => e.isFile() && e.name.endsWith(".json"))
        .map((e) => ({ id: e.name.replace(/\.json$/, ""), mtimeMs: 0 }));
      const stats = await Promise.allSettled(
        turns.map((t) => fs.stat(path.join(dir, `${t.id}.json`))),
      );
      for (let i = 0; i < turns.length; i++) {
        const s = stats[i];
        if (s.status === "fulfilled") turns[i].mtimeMs = s.value.mtimeMs;
      }
      turns.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return turns.map((t) => t.id);
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
    for (const newer of all.slice(0, idx)) {
      await fs.unlink(this.metaPath(root, newer)).catch(() => undefined);
    }
    const remaining = await this.listTurns(root);
    const referenced = new Set<string>();
    for (const rem of remaining) {
      const snap = await this.load(root, rem);
      if (snap) {
        for (const hash of Object.values(snap.files)) {
          if (hash !== "__none__") referenced.add(hash);
        }
      }
    }
    const blobsDir = path.join(this.opts.dir, "blobs");
    try {
      const blobDirs = await fs.readdir(blobsDir, { withFileTypes: true });
      for (const dirEnt of blobDirs) {
        if (!dirEnt.isDirectory()) continue;
        const subDir = path.join(blobsDir, dirEnt.name);
        const files = await fs.readdir(subDir);
        for (const f of files) {
          if (!referenced.has(f)) {
            await fs.unlink(path.join(subDir, f)).catch(() => {});
          }
        }
      }
    } catch {}
    return { restored, conflicts };
  }
  async clear(root: string) {
    const dir = this.turnsDir(root);
    try {
      const entries = await fs.readdir(dir);
      await Promise.all(entries.map((e) => fs.unlink(path.join(dir, e))));
} catch {  }
  }
  async compare(root: string, turnA: string, turnB: string): Promise<{ added: string[]; removed: string[]; modified: string[] }> {
    const snapA = await this.load(root, turnA);
    const snapB = await this.load(root, turnB);
    if (!snapA || !snapB) throw new Error("One or both snapshots not found.");
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];
    const allFiles = new Set([...Object.keys(snapA.files), ...Object.keys(snapB.files)]);
    for (const file of allFiles) {
      const hashA = snapA.files[file];
      const hashB = snapB.files[file];
      if (!hashA && hashB) added.push(file);
      else if (hashA && !hashB) removed.push(file);
      else if (hashA !== hashB) modified.push(file);
    }
    return { added, removed, modified };
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
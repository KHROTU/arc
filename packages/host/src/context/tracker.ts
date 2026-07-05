import * as fs from "node:fs/promises";
import * as path from "node:path";
export interface FileContextEntry {
  file: string;
  reads: number;
  edits: number;
  lastRead?: number;
  lastEdit?: number;
}
export type TouchKind = "read" | "edit";
export interface FileContextTrackerOptions {
  dbPath: string;
  maxEntries?: number;
  saveDebounceMs?: number;
}
export class FileContextTracker {
  private entries = new Map<string, FileContextEntry>();
  private maxEntries: number;
  private saveDebounceMs: number;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private loaded = false;
  constructor(private opts: FileContextTrackerOptions) {
    this.maxEntries = opts.maxEntries ?? 500;
    this.saveDebounceMs = opts.saveDebounceMs ?? 1000;
  }
  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.opts.dbPath, "utf-8");
      const parsed = JSON.parse(raw) as { entries?: FileContextEntry[] };
      this.entries.clear();
      for (const e of parsed.entries ?? []) {
        this.entries.set(e.file, e);
      }
    } catch {
    } finally {
      this.loaded = true;
    }
  }
  private ensureLoaded(): void {
    if (!this.loaded) throw new Error("FileContextTracker.load() must be called before use.");
  }
  touch(file: string, kind: TouchKind): void {
    this.ensureLoaded();
    const now = Date.now();
    const existing = this.entries.get(file);
    if (existing) this.entries.delete(file);
    const entry: FileContextEntry = existing ?? { file, reads: 0, edits: 0 };
    if (kind === "read") {
      entry.reads += 1;
      entry.lastRead = now;
    } else {
      entry.edits += 1;
      entry.lastEdit = now;
    }
    this.entries.set(file, entry);
    this.evictIfNeeded();
    this.scheduleSave();
  }
  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.save(); }, this.saveDebounceMs);
  }
  async save(): Promise<void> {
    clearTimeout(this.saveTimer);
    try {
      await fs.mkdir(path.dirname(this.opts.dbPath), { recursive: true });
      await fs.writeFile(this.opts.dbPath, JSON.stringify({ entries: [...this.entries.values()] }, null, 2), "utf-8");
    } catch {
    }
  }
  get(file: string): FileContextEntry | undefined {
    return this.entries.get(file);
  }
  list(): FileContextEntry[] {
    return [...this.entries.values()].reverse();
  }
  recent(n = 10): FileContextEntry[] {
    return this.list().slice(0, n);
  }
  size(): number {
    return this.entries.size;
  }
}
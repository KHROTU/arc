import * as fs from "node:fs";
import * as path from "node:path";
import { Indexer, walk, DEFAULT_INCLUDE, DEFAULT_EXCLUDE } from "./indexer.js";
export interface WatcherOptions {
  root: string;
  indexer: Indexer;
  debounceMs?: number;
  poll?: boolean;
  pollIntervalMs?: number;
  include?: string[];
  exclude?: string[];
  onUpdate?: (files: { updated: string[]; removed: string[] }) => void;
  onError?: (file: string, error: Error) => void;
}
type WatchEvent = "change" | "rename" | "remove";
export class IndexWatcher {
  private watchers: fs.FSWatcher[] = [];
  private pending = new Map<string, WatchEvent>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private knownMtimes = new Map<string, number>();
  constructor(private opts: WatcherOptions) {}
  start(): void {
    this.stopped = false;
    if (this.opts.poll) {
      this.pollLoop();
      return;
    }
    try {
      const w = fs.watch(this.opts.root, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const rel = String(filename).replace(/\\/g, "/");
        const evt: WatchEvent = event === "rename" ? "rename" : "change";
        this.schedule(rel, evt);
      });
      this.watchers.push(w);
    } catch {
      this.pollLoop();
    }
  }
  stop(): void {
    this.stopped = true;
    for (const w of this.watchers) {
try { w.close(); } catch {  }
    }
    this.watchers = [];
    if (this.timer) clearTimeout(this.timer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }
  private schedule(rel: string, evt: WatchEvent): void {
    this.pending.set(rel, evt);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.opts.debounceMs ?? 250);
  }
  private async flush(): Promise<void> {
    const items = Array.from(this.pending.entries());
    this.pending.clear();
    this.timer = undefined;
    const updated: string[] = [];
    const removed: string[] = [];
    for (const [rel, evt] of items) {
      if (evt === "remove") {
        this.opts.indexer.removeFile(rel);
        removed.push(rel);
        continue;
      }
      try {
        const full = path.join(this.opts.root, rel);
        const stat = await fs.promises.stat(full).catch(() => undefined);
        if (!stat) {
          this.opts.indexer.removeFile(rel);
          removed.push(rel);
          continue;
        }
        if (!stat.isFile()) continue;
        await this.opts.indexer.reindexFile(this.opts.root, rel);
        updated.push(rel);
      } catch (e) {
        this.opts.onError?.(rel, e as Error);
      }
    }
    if (updated.length || removed.length) this.opts.onUpdate?.({ updated, removed });
  }
  private pollLoop(): void {
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.pollScan();
      } catch {
      }
      if (this.stopped) return;
      this.pollTimer = setTimeout(tick, this.opts.pollIntervalMs ?? 5000);
    };
    this.pollTimer = setTimeout(tick, 0);
  }
  private async pollScan(): Promise<void> {
    const include = this.opts.include ?? DEFAULT_INCLUDE;
    const exclude = this.opts.exclude ?? DEFAULT_EXCLUDE;
    const files = await walk(this.opts.root, include, exclude);
    const seen = new Set<string>();
    const updated: string[] = [];
    const removed: string[] = [];
    for (const rel of files) {
      seen.add(rel);
      const full = path.join(this.opts.root, rel);
      let mtimeMs: number;
      try {
        mtimeMs = (await fs.promises.stat(full)).mtimeMs;
      } catch {
        continue;
      }
      const prev = this.knownMtimes.get(rel);
      if (prev === undefined || prev !== mtimeMs) {
        this.knownMtimes.set(rel, mtimeMs);
        try {
          await this.opts.indexer.reindexFile(this.opts.root, rel);
          updated.push(rel);
        } catch (e) {
          this.opts.onError?.(rel, e as Error);
        }
      }
    }
    for (const rel of Array.from(this.knownMtimes.keys())) {
      if (!seen.has(rel)) {
        this.knownMtimes.delete(rel);
        this.opts.indexer.removeFile(rel);
        removed.push(rel);
      }
    }
    if (updated.length || removed.length) this.opts.onUpdate?.({ updated, removed });
  }
}
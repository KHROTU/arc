import * as fs from "node:fs";
import { Indexer } from "./indexer.js";
export interface WatcherOptions {
  root: string;
  indexer: Indexer;
  debounceMs?: number;
  poll?: boolean;
  pollIntervalMs?: number;
}
type WatchEvent = "change" | "rename" | "remove";
export class IndexWatcher {
  private watchers: fs.FSWatcher[] = [];
  private pending = new Map<string, WatchEvent>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
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
    for (const [rel, evt] of items) {
      if (evt === "remove") {
        this.opts.indexer.removeFile(rel);
        continue;
      }
      try {
        await this.opts.indexer.reindexFile(this.opts.root, rel);
      } catch {
      }
    }
  }
  private pollLoop(): void {
    const tick = async () => {
      if (this.stopped) return;
      setTimeout(tick, this.opts.pollIntervalMs ?? 5000);
    };
    setTimeout(tick, this.opts.pollIntervalMs ?? 5000);
  }
}
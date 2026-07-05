import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { EmbeddingBackend } from "./backend.js";
import { VectorIndex } from "./vector-index.js";
export interface ChunkOptions {
  maxChunkChars?: number;
  overlapChars?: number;
}
export interface IndexOptions {
  include?: string[];
  exclude?: string[];
  chunk?: ChunkOptions;
}
const DEFAULT_INCLUDE = [
  "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs",
  "**/*.py", "**/*.rs", "**/*.go", "**/*.java", "**/*.kt", "**/*.cs",
  "**/*.rb", "**/*.php", "**/*.swift", "**/*.c", "**/*.cpp", "**/*.h",
  "**/*.hpp", "**/*.md", "**/*.mdx", "**/*.txt", "**/*.json", "**/*.yaml", "**/*.yml",
  "**/*.toml", "**/*.html", "**/*.css", "**/*.scss", "**/*.sql",
];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**", "**/.git/**", "**/dist/**", "**/out/**", "**/build/**",
  "**/.next/**", "**/.vscode/**", "**/coverage/**", "**/.cache/**",
  "**/target/**", "**/venv/**", "**/__pycache__/**", "**/*.min.js", "**/*.lock",
  "**/*.lockb", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock",
];
export { DEFAULT_INCLUDE, DEFAULT_EXCLUDE };
export interface IndexerOptions {
  backend: EmbeddingBackend;
  opts?: IndexOptions;
  batchSize?: number;
}
export interface IndexProgress {
  filesScanned: number;
  filesIndexed: number;
  chunksEmbedded: number;
  errors: number;
}
export class Indexer {
  private index = new VectorIndex();
  private pathsById = new Map<string, { file: string; start: number; end: number }>();
  constructor(private opts: IndexerOptions) {}
  getIndex(): VectorIndex { return this.index; }
  async save(filePath: string): Promise<void> {
    await this.index.save(filePath);
  }
  static async load(filePath: string, backend: EmbeddingBackend): Promise<Indexer> {
    const idx = await VectorIndex.load(filePath);
    const indexer = new Indexer({ backend });
    indexer.index = idx;
    indexer.rebuildPathMap();
    return indexer;
  }
  private rebuildPathMap(): void {
    this.pathsById.clear();
    for (const rec of this.index.filter(() => true)) {
      const file = rec.meta.file as string | undefined;
      const start = rec.meta.start as number | undefined;
      const end = rec.meta.end as number | undefined;
      if (file && typeof start === "number" && typeof end === "number") {
        this.pathsById.set(rec.id, { file, start, end });
      }
    }
  }
  async indexWorkspace(root: string): Promise<IndexProgress> {
    const files = await walk(root, this.opts.opts?.include ?? DEFAULT_INCLUDE, this.opts.opts?.exclude ?? DEFAULT_EXCLUDE);
    const progress: IndexProgress = { filesScanned: files.length, filesIndexed: 0, chunksEmbedded: 0, errors: 0 };
    for (const file of files) {
      try {
        const full = path.join(root, file);
        const stat = await fs.stat(full);
        if (!stat.isFile()) continue;
        const text = await fs.readFile(full, "utf-8");
        const chunks = chunkText(text, this.opts.opts?.chunk ?? {});
        for (const c of chunks) {
          const id = `${file}#${c.start}-${c.end}-${randomUUID().slice(0, 6)}`;
          this.pathsById.set(id, { file, start: c.start, end: c.end });
        }
        progress.chunksEmbedded += chunks.length;
        progress.filesIndexed += 1;
        const inputs = chunks.map((c) => c.text);
        const vecs = await this.opts.backend.embed({ model: this.opts.backend.model, input: inputs });
        for (let i = 0; i < chunks.length; i++) {
          const id = Array.from(this.pathsById.entries()).find(([, v]) => v.file === file && v.start === chunks[i].start && v.end === chunks[i].end)?.[0];
          if (!id) continue;
          this.index.add({ id, vector: vecs[i].values, meta: { file, start: chunks[i].start, end: chunks[i].end, text: chunks[i].text.slice(0, 400) } });
        }
      } catch {
        progress.errors += 1;
      }
    }
    return progress;
  }
  async reindexFile(root: string, file: string): Promise<number> {
    const full = path.join(root, file);
    let text: string;
    try {
      text = await fs.readFile(full, "utf-8");
    } catch {
      this.removeFile(file);
      return 0;
    }
    this.removeFile(file);
    const chunks = chunkText(text, this.opts.opts?.chunk ?? {});
    if (chunks.length === 0) return 0;
    const inputs = chunks.map((c) => c.text);
    const vecs = await this.opts.backend.embed({ model: this.opts.backend.model, input: inputs });
    for (let i = 0; i < chunks.length; i++) {
      const id = `${file}#${chunks[i].start}-${chunks[i].end}-${randomUUID().slice(0, 6)}`;
      this.pathsById.set(id, { file, start: chunks[i].start, end: chunks[i].end });
      this.index.add({ id, vector: vecs[i].values, meta: { file, start: chunks[i].start, end: chunks[i].end, text: chunks[i].text.slice(0, 400) } });
    }
    return chunks.length;
  }
  removeFile(file: string): number {
    let removed = 0;
    for (const [id, meta] of Array.from(this.pathsById.entries())) {
      if (meta.file === file) {
        this.index.remove(id);
        this.pathsById.delete(id);
        removed++;
      }
    }
    return removed;
  }
  async search(query: string, k = 10): Promise<{ id: string; score: number; file: string; start: number; end: number; text: string }[]> {
    const vecs = await this.opts.backend.embed({ model: this.opts.backend.model, input: query });
    if (!vecs.length) return [];
    const hits = this.index.search(vecs[0], k);
    return hits.map((h) => ({
      id: h.id,
      score: h.score,
      file: String(h.meta.file),
      start: Number(h.meta.start),
      end: Number(h.meta.end),
      text: String(h.meta.text),
    }));
  }
}
export interface TextChunk {
  text: string;
  start: number;
  end: number;
}
export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const max = opts.maxChunkChars ?? 1500;
  const overlap = opts.overlapChars ?? 200;
  if (text.length <= max) return [{ text, start: 0, end: text.length }];
  const chunks: TextChunk[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + max);
    if (end < text.length) {
      const nl = text.indexOf("\n", end - 100);
      if (nl > 0 && nl < end + 100) end = nl + 1;
    }
    const slice = text.slice(i, end);
    chunks.push({ text: slice, start: i, end });
    if (end >= text.length) break;
    i = Math.max(i + 1, end - overlap);
  }
  return chunks;
}
export async function walk(root: string, include: string[], exclude: string[]): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        if (matchesAny(rel + "/", exclude)) continue;
        await visit(full);
      } else if (ent.isFile()) {
        if (matchesAny(rel, exclude)) continue;
        if (matchesAny(rel, include)) out.push(rel);
      }
    }
  }
  await visit(root);
  return out;
}
function matchesAny(p: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    if (matchGlob(p, pat)) return true;
  }
  return false;
}
function matchGlob(path: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(path);
}
function globToRegex(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}
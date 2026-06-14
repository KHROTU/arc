import * as fs from "node:fs/promises";
import type { EmbeddingVector } from "./backend.js";
export interface VectorRecord {
  id: string;
  vector: number[];
  meta: Record<string, unknown>;
}
export interface SearchHit {
  id: string;
  score: number;
  meta: Record<string, unknown>;
}
export class VectorIndex {
  private records = new Map<string, VectorRecord>();
  add(rec: VectorRecord): void {
    this.records.set(rec.id, rec);
  }
  remove(id: string): boolean {
    return this.records.delete(id);
  }
  get(id: string): VectorRecord | undefined {
    return this.records.get(id);
  }
  size(): number {
    return this.records.size;
  }
  clear(): void {
    this.records.clear();
  }
  search(query: EmbeddingVector, k: number): SearchHit[] {
    if (this.records.size === 0) return [];
    const q = normalize(query.values);
    if (!q) return [];
    const scored: SearchHit[] = [];
    for (const rec of this.records.values()) {
      const v = normalize(rec.vector);
      if (!v) continue;
      const score = cosine(q, v);
      scored.push({ id: rec.id, score, meta: rec.meta });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
  filter(predicate: (rec: VectorRecord) => boolean): VectorRecord[] {
    const out: VectorRecord[] = [];
    for (const rec of this.records.values()) {
      if (predicate(rec)) out.push(rec);
    }
    return out;
  }
  async save(filePath: string): Promise<void> {
    await fs.mkdir(pathDir(filePath), { recursive: true });
    const recs = Array.from(this.records.values());
    const metaBufs: Buffer[] = [];
    const idBufs: Buffer[] = [];
    const vecBufs: Buffer[] = [];
    let totalMeta = 0;
    let totalId = 0;
    let totalVec = 0;
    for (const rec of recs) {
      const idEnc = Buffer.from(rec.id, "utf-8");
      if (idEnc.length > 65535) throw new Error(`Record id too long: ${idEnc.length} > 65535`);
      idBufs.push(idEnc);
      totalId += idEnc.length;
      const metaEnc = Buffer.from(JSON.stringify(rec.meta), "utf-8");
      if (metaEnc.length > 65535) throw new Error(`Record meta too long: ${metaEnc.length} > 65535`);
      metaBufs.push(metaEnc);
      totalMeta += metaEnc.length;
      if (rec.vector.length > 65535) throw new Error(`Vector dim too large: ${rec.vector.length} > 65535`);
      const vecBuf = Buffer.alloc(rec.vector.length * 4);
      for (let i = 0; i < rec.vector.length; i++) vecBuf.writeFloatLE(rec.vector[i], i * 4);
      vecBufs.push(vecBuf);
      totalVec += vecBuf.length;
    }
    const header = Buffer.alloc(16);
    header.write("ARCX", 0, "ascii");
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(recs.length, 8);
    header.writeUInt32LE(0, 12);
    const bufs: Buffer[] = [header];
    for (let i = 0; i < recs.length; i++) {
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16LE(idBufs[i].length, 0);
      bufs.push(idLen, idBufs[i]);
      const metaLen = Buffer.alloc(2);
      metaLen.writeUInt16LE(metaBufs[i].length, 0);
      bufs.push(metaLen, metaBufs[i]);
      const dim = Buffer.alloc(2);
      dim.writeUInt16LE(recs[i].vector.length, 0);
      bufs.push(dim, vecBufs[i]);
    }
    const out = Buffer.concat(bufs);
    await fs.writeFile(filePath, out);
  }
  static async load(filePath: string): Promise<VectorIndex> {
    const idx = new VectorIndex();
    const buf = await fs.readFile(filePath);
    if (buf.length < 16) return idx;
    const magic = buf.toString("ascii", 0, 4);
    if (magic !== "ARCX") throw new Error(`Not an Arc index file: ${filePath}`);
    const version = buf.readUInt32LE(4);
    if (version !== 1) throw new Error(`Unsupported index version: ${version}`);
    const count = buf.readUInt32LE(8);
    let off = 16;
    for (let i = 0; i < count; i++) {
      if (off + 2 > buf.length) break;
      const idLen = buf.readUInt16LE(off); off += 2;
      if (off + idLen > buf.length) break;
      const id = buf.toString("utf-8", off, off + idLen); off += idLen;
      if (off + 2 > buf.length) break;
      const metaLen = buf.readUInt16LE(off); off += 2;
      if (off + metaLen > buf.length) break;
      const metaJson = buf.toString("utf-8", off, off + metaLen); off += metaLen;
      const meta = JSON.parse(metaJson) as Record<string, unknown>;
      if (off + 2 > buf.length) break;
      const dim = buf.readUInt16LE(off); off += 2;
      if (off + dim * 4 > buf.length) break;
      const vector: number[] = [];
      for (let j = 0; j < dim; j++) {
        vector.push(buf.readFloatLE(off));
        off += 4;
      }
      idx.add({ id, vector, meta });
    }
    return idx;
  }
}
function normalize(v: number[]): number[] | null {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return null;
  return v.map((x) => x / norm);
}
function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}
function pathDir(p: string): string {
  const sep = p.lastIndexOf("/");
  const bs = p.lastIndexOf("\\");
  const idx = Math.max(sep, bs);
  return idx >= 0 ? p.slice(0, idx) : ".";
}
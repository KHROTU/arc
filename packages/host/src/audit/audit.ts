import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { getWorkspaceArcDir } from "../arc-dir.js";
export interface AuditEntry {
  seq: number;
  ts: string;
  type: string;
  data: unknown;
  prevHash: string;
  hash: string;
}
export interface AuditVerifyResult {
  ok: boolean;
  entries: number;
  brokenAtSeq?: number;
  reason?: string;
}
const GENESIS_HASH = "0".repeat(64);
function computeHash(prevHash: string, seq: number, ts: string, type: string, data: unknown): string {
  const payload = JSON.stringify({ seq, ts, type, data, prevHash });
  return createHash("sha256").update(payload).digest("hex");
}
export function auditLogPath(workspaceRoot: string): string {
  return path.join(getWorkspaceArcDir(workspaceRoot), "audit.jsonl");
}
export async function readAuditLog(filePath: string): Promise<AuditEntry[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return raw.split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as AuditEntry);
  } catch {
    return [];
  }
}
const appendChains = new Map<string, Promise<unknown>>();
export async function appendAuditEntry(workspaceRoot: string, type: string, data: unknown): Promise<AuditEntry> {
  const filePath = auditLogPath(workspaceRoot);
  const prior = appendChains.get(filePath) ?? Promise.resolve();
  const task = prior.then(async () => {
    const entries = await readAuditLog(filePath);
    const last = entries[entries.length - 1];
    const seq = last ? last.seq + 1 : 0;
    const ts = new Date().toISOString();
    const prevHash = last?.hash ?? GENESIS_HASH;
    const hash = computeHash(prevHash, seq, ts, type, data);
    const entry: AuditEntry = { seq, ts, type, data, prevHash, hash };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
    return entry;
  });
  appendChains.set(filePath, task.catch(() => undefined));
  return task;
}
export function verifyAuditChain(entries: AuditEntry[]): AuditVerifyResult {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) {
      return { ok: false, entries: entries.length, brokenAtSeq: e.seq, reason: `expected sequence ${i}, got ${e.seq}` };
    }
    if (e.prevHash !== prevHash) {
      return { ok: false, entries: entries.length, brokenAtSeq: e.seq, reason: "prevHash does not match the preceding entry's hash" };
    }
    const expectedHash = computeHash(e.prevHash, e.seq, e.ts, e.type, e.data);
    if (expectedHash !== e.hash) {
      return { ok: false, entries: entries.length, brokenAtSeq: e.seq, reason: "hash mismatch - entry has been tampered with" };
    }
    prevHash = e.hash;
  }
  return { ok: true, entries: entries.length };
}
export async function verifyAuditLogFile(filePath: string): Promise<AuditVerifyResult> {
  const entries = await readAuditLog(filePath);
  return verifyAuditChain(entries);
}

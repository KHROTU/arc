import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { appendAuditEntry, readAuditLog, verifyAuditChain, verifyAuditLogFile, auditLogPath } from "../src/audit/audit";
async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "arc-audit-"));
}
describe("audit log hash chain", () => {
  it("appends entries with a chained sha-256 hash", async () => {
    const root = await tmpRoot();
    await appendAuditEntry(root, "tool_call", { toolName: "file.read" });
    await appendAuditEntry(root, "tool_call", { toolName: "file.edit" });
    const entries = await readAuditLog(auditLogPath(root));
    expect(entries).toHaveLength(2);
    expect(entries[0].seq).toBe(0);
    expect(entries[1].seq).toBe(1);
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries[0].prevHash).toMatch(/^0{64}$/);
  });
  it("verifies an untampered chain as ok", async () => {
    const root = await tmpRoot();
    for (let i = 0; i < 5; i++) await appendAuditEntry(root, "user_message", { i });
    const result = await verifyAuditLogFile(auditLogPath(root));
    expect(result.ok).toBe(true);
    expect(result.entries).toBe(5);
  });
  it("detects a tampered entry (mutated data breaks the hash)", async () => {
    const root = await tmpRoot();
    await appendAuditEntry(root, "approval", { toolName: "shell.run", allowed: true });
    await appendAuditEntry(root, "approval", { toolName: "shell.run", allowed: false });
    const entries = await readAuditLog(auditLogPath(root));
    entries[0].data = { toolName: "shell.run", allowed: false };
    const result = verifyAuditChain(entries);
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(0);
    expect(result.reason).toContain("tampered");
  });
  it("detects a deleted entry (breaks prevHash linkage)", async () => {
    const root = await tmpRoot();
    await appendAuditEntry(root, "turn.start", { turnId: "a" });
    await appendAuditEntry(root, "turn.start", { turnId: "b" });
    await appendAuditEntry(root, "turn.start", { turnId: "c" });
    const entries = await readAuditLog(auditLogPath(root));
    entries.splice(1, 1);
    const result = verifyAuditChain(entries);
    expect(result.ok).toBe(false);
  });
  it("handles concurrent appends without corrupting the chain", async () => {
    const root = await tmpRoot();
    await Promise.all(Array.from({ length: 10 }, (_, i) => appendAuditEntry(root, "tool_call", { i })));
    const entries = await readAuditLog(auditLogPath(root));
    expect(entries).toHaveLength(10);
    expect(entries.map((e) => e.seq).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const result = verifyAuditChain(entries);
    expect(result.ok).toBe(true);
  });
  it("returns ok for an empty/nonexistent log", async () => {
    const root = await tmpRoot();
    const result = await verifyAuditLogFile(auditLogPath(root));
    expect(result.ok).toBe(true);
    expect(result.entries).toBe(0);
  });
});
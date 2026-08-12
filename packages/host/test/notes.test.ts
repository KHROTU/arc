import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { appendNote, loadNotes, clearNotes, NOTES_FILENAME } from "../src/memory/notes";
import { getWorkspaceArcDir } from "../src/arc-dir";
describe("workspace notes", () => {
  it("appends and loads notes", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-notes-"));
    const r = await appendNote(tmp, "Fixed the router bug");
    expect(r.index).toBe(0);
    const r2 = await appendNote(tmp, "Next: write tests");
    expect(r2.index).toBe(1);
    const loaded = await loadNotes(tmp);
    expect(loaded).toContain("Fixed the router bug");
    expect(loaded).toContain("Next: write tests");
    const raw = await fs.readFile(path.join(getWorkspaceArcDir(tmp), NOTES_FILENAME), "utf-8");
    expect(raw).toMatch(/^\- \[\d{4}-\d{2}-\d{2}/m);
  });
  it("dedupes an identical trailing note", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-notes-"));
    await appendNote(tmp, "same note");
    const r = await appendNote(tmp, "same note");
    expect(r.index).toBe(0);
    expect(r.total).toBe(1);
  });
  it("caps the note count at MAX_NOTES", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-notes-"));
    for (let i = 0; i < 100; i++) {
      await appendNote(tmp, `note ${i}`);
    }
    const loaded = await loadNotes(tmp);
    expect(loaded).toContain("note 99");
    expect(loaded).not.toContain("note 0");
    const raw = await fs.readFile(path.join(getWorkspaceArcDir(tmp), NOTES_FILENAME), "utf-8");
    expect(raw.split(/\r?\n/).filter(Boolean).length).toBe(80);
  });
  it("loadNotes caps injection length to the most recent chars", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-notes-"));
    await appendNote(tmp, "a".repeat(5000));
    const loaded = await loadNotes(tmp, 1000);
    expect(loaded.length).toBeLessThanOrEqual(1000);
    expect(loaded.endsWith("a".repeat(1000))).toBe(true);
  });
  it("clearNotes removes the file and loadNotes returns empty", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-notes-"));
    await appendNote(tmp, "temp");
    await clearNotes(tmp);
    expect(await loadNotes(tmp)).toBe("");
  });
  it("rejects blank notes", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "arc-notes-"));
    const r = await appendNote(tmp, "   \n ");
    expect(r.index).toBe(-1);
  });
});
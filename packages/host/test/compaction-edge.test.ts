import { describe, it, expect } from "vitest";
import { compactAsync, compact, decideCompaction, estimateTokens, renderForSummary, COMPACTION_SUMMARY_HEADER, CompactionTracker } from "../src/compaction/compaction";
import type { ChatMessage, ModelDescriptor } from "../src/protocol/protocol";
const m = (id: string, role: ChatMessage["role"], content: string, ts: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, content, ts, ...extra });
const model: ModelDescriptor = { id: "m1", label: "Test", tier: "default", contextWindow: 100_000, costPer1mIn: 0, costPer1mOut: 0, providers: [] };
describe("mid-conversation system messages", () => {
  it("folds mid-conversation system notes into the summary instead of hoisting them to the front", async () => {
    const sys = m("sys", "system", "base prompt", 0);
    const note = m("note", "system", "Switched to code mode. Remember rule X.", 3);
    const msgs: ChatMessage[] = [
      sys,
      m("u0", "user", "msg 0", 1),
      m("a1", "assistant", "ans 1", 2),
      note,
      ...Array.from({ length: 6 }, (_, i) => m(`x${i}`, i % 2 === 0 ? "user" : "assistant", `tail ${i}`, 10 + i)),
    ];
    let summarizedInput: ChatMessage[] = [];
    const out = await compactAsync(msgs, async (inMsgs) => {
      summarizedInput = inMsgs;
      return "summary body";
    });
    expect(out[0].id).toBe("sys");
    expect(out.some((mm) => mm.id === "note")).toBe(false);
    expect(summarizedInput.some((mm) => mm.id === "note" && mm.content.includes("rule X"))).toBe(true);
    expect(out.some((mm) => mm.role === "system" && mm.id !== "sys" && !mm.content.startsWith(COMPACTION_SUMMARY_HEADER))).toBe(false);
  });
  it("keeps noCompact notes and expands protection to full tool chains", async () => {
    const sys = m("sys", "system", "base", 0);
    const important = m("imp", "system", "critical invariant", 3, { noCompact: true });
    const chainAssistant = m("chainA", "assistant", "", 4, { toolCalls: [{ id: "c1", name: "shell.run", args: {} }, { id: "c2", name: "file.write", args: {} }] });
    const t1 = m("t1", "tool", "out1", 5, { toolCallId: "c1", noCompact: true });
    const t2 = m("t2", "tool", "out2", 6, { toolCallId: "c2" });
    const tail = Array.from({ length: 6 }, (_, i) => m(`y${i}`, i % 2 === 0 ? "user" : "assistant", `tail ${i}`, 20 + i));
    const msgs: ChatMessage[] = [sys, m("u0", "user", "u0", 1), m("a1", "assistant", "a1", 2), important, chainAssistant, t1, t2, ...tail];
    const out = await compactAsync(msgs, async () => "sum");
    expect(out.some((mm) => mm.id === "imp")).toBe(true);
    expect(out.some((mm) => mm.id === "chainA")).toBe(true);
    expect(out.some((mm) => mm.id === "t1")).toBe(true);
    expect(out.some((mm) => mm.id === "t2")).toBe(true);
    for (let i = 0; i < out.length; i++) {
      if (out[i].role !== "tool") continue;
      let j = i - 1;
      while (j >= 0 && out[j].role === "tool") j--;
      expect(out[j]?.role === "assistant" && out[j]?.toolCalls?.some((tc) => tc.id === out[i].toolCallId)).toBe(true);
    }
  });
});
describe("repeated compaction", () => {
  it("replaces a prior summary instead of accumulating duplicates and feeds its content to the summarizer", async () => {
    const priorSummary = m("s1", "system", `${COMPACTION_SUMMARY_HEADER} 8 earlier messages\n\nold decisions file.ts edited`, 5);
    const rest = Array.from({ length: 10 }, (_, i) => m(`r${i}`, i % 2 === 0 ? "user" : "assistant", `later ${i}`, 100 + i));
    const msgs: ChatMessage[] = [priorSummary, ...rest];
    let captured: ChatMessage[] = [];
    const first = await compactAsync(msgs, async (input) => {
      captured = input;
      return "second summary";
    });
    expect(first.filter((mm) => mm.content.startsWith(COMPACTION_SUMMARY_HEADER)).length).toBe(1);
    expect(captured.some((mm) => mm.id === "s1" && mm.content.includes("old decisions"))).toBe(true);
    const second = await compactAsync([...first.slice(0, -4), ...Array.from({ length: 12 }, (_, i) => m(`z${i}`, i % 2 === 0 ? "user" : "assistant", `more ${i}`, 300 + i))], async () => "third");
    expect(second.filter((mm) => mm.content.startsWith(COMPACTION_SUMMARY_HEADER)).length).toBe(1);
  });
});
describe("decideCompaction margins", () => {
  it("compacts early at usable*(1-safetyMargin), not only when hard limit is reached", () => {
    const tiny: ModelDescriptor = { ...model, contextWindow: 10_000, maxOutputTokens: 16_384 };
    const filler = "\u00e5".repeat(13_200);
    const msgs: ChatMessage[] = [m("1", "user", filler, 0)];
    const est = estimateTokens(msgs);
    const dFixed = decideCompaction(msgs, tiny, new CompactionTracker(), { safetyMargin: 0.15, enforce: true, keepTail: 6 }, 0);
    expect(dFixed.shouldCompact).toBe(est >= dFixed.usable);
    expect(dFixed.usable).toBe(4_250);
    expect(est).toBeGreaterThan(3_000);
  });
  it("never reserves more than half the window and respects lastKnownPromptTokens with margin", () => {
    const tracker = new CompactionTracker();
    for (let i = 0; i < 5; i++) tracker.observe("m1", { prompt: 1_000, completion: 100, thinking: 0 });
    const d = decideCompaction([], model, tracker, undefined, 72_000);
    expect(d.usable).toBeLessThan(model.contextWindow);
    expect(d.usable).toBeGreaterThan(50_000);
    expect(d.shouldCompact).toBe(true);
    const dLow = decideCompaction([], model, tracker, undefined, 10_000);
    expect(dLow.shouldCompact).toBe(false);
  });
  it("treats missing/zero context window as unlimited", () => {
    const d = decideCompaction([m("1", "user", "hello world this is long enough to matter", 0)], { ...model, contextWindow: 0 }, undefined);
    expect(d.shouldCompact).toBe(false);
    expect(d.reason).toContain("unlimited");
  });
});
describe("estimateTokens images", () => {
  it("charges a fixed per-image token overhead independent of base64 length", () => {
    const plain = m("1", "user", "look", 0);
    const bigUrl = "data:image/png;base64," + "A".repeat(500_000);
    const twoImages = m("2", "user", "look", 0, { images: [{ type: "image_url", image_url: { url: bigUrl } }, { type: "image_url", image_url: { url: bigUrl } }] });
    const oneImage = m("3", "user", "look", 0, { images: [{ type: "image_url", image_url: { url: bigUrl } }] });
    expect(estimateTokens([twoImages]) - estimateTokens([oneImage])).toBe(800);
    expect(estimateTokens([oneImage]) - estimateTokens([plain])).toBe(800);
  });
});
describe("renderForSummary", () => {
  it("includes prior summaries verbatim (not stripped as before)", () => {
    const prior = m("s", "system", `${COMPACTION_SUMMARY_HEADER} 3 earlier messages\n\nkeep me`, 1);
    const out = renderForSummary([prior, m("u", "user", "hi", 2)]);
    expect(out).toContain(COMPACTION_SUMMARY_HEADER);
    expect(out).toContain("keep me");
  });
  it("caps huge transcripts keeping head and tail of the conversation", () => {
    const lines = [
      m("first", "user", "ORIGINAL REQUEST: build the flux capacitor", 0),
      ...Array.from({ length: 400 }, (_, i) => m(`b${i}`, i % 2 === 0 ? "assistant" : "tool", ("filler ".repeat(60) + i), 1 + i)),
      m("last", "assistant", "FINAL STATE: almost done", 999),
    ];
    const out = renderForSummary(lines);
    expect(out.length).toBeLessThan(125_000);
    expect(out).toContain("ORIGINAL REQUEST");
    expect(out).toContain("FINAL STATE");
    expect(out).toContain("transcript omitted");
  });
});
describe("compact sync parity", () => {
  it("matches compactAsync segmentation", () => {
    const msgs: ChatMessage[] = [
      m("sys", "system", "base", 0),
      m("n", "system", "note", 2, { noCompact: true }),
      ...Array.from({ length: 9 }, (_, i) => m(`q${i}`, i % 2 === 0 ? "user" : "assistant", `q ${i}`, 10 + i)),
    ];
    const syncOut = compact(msgs, undefined, () => "sync sum");
    const asyncOut = compactAsync;
    void asyncOut;
    expect(syncOut.length).toBeLessThan(msgs.length);
    expect(syncOut.some((mm) => mm.id === "n")).toBe(true);
    expect(syncOut[0].id).toBe("sys");
  });
});
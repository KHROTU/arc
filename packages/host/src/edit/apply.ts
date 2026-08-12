import { diffLines } from "./line-diff.js";
import type { LineChange as Change } from "./line-diff.js";
export type { LineChange } from "./line-diff.js";
export interface ApplyEditInput {
  before: string;
  search: string;
  replace: string;
  replaceAll?: boolean;
}
export interface ApplyEditResult {
  ok: boolean;
  after: string;
  matches: number;
  strategy: "exact" | "trim" | "blank-collapse" | "fuzzy" | "regex" | "append" | "write";
  diff: Change[];
  error?: string;
}
const NL = /\r\n?|\n/;
function normalizeLines(s: string): string {
  return s.split(NL).map((l) => l.replace(/[ \t]+$/, "")).join("\n");
}
function collapseBlank(s: string): string {
  return s.replace(/\n{3,}/g, "\n\n");
}
function findIndex(haystack: string, needle: string): number {
  if (!needle) return -1;
  return haystack.indexOf(needle);
}
function findRegex(haystack: string, needle: string): { index: number; length: number } | null {
  if (!needle) return null;
  const m = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "m").exec(haystack);
  return m ? { index: m.index, length: m[0].length } : null;
}
function lineStartOffsets(s: string): { start: number; termLen: number }[] {
  const out = [{ start: 0, termLen: 0 }];
  const re = /\r\n|\r|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out[out.length - 1].termLen = m[0].length;
    out.push({ start: m.index + m[0].length, termLen: 0 });
  }
  return out;
}
function windowedMatch(haystack: string, needle: string): { index: number; length: number } | null {
  const needleLines = needle.split(NL);
  const nLines = needleLines.length;
  if (nLines === 0) return null;
  const hLines = haystack.split(NL);
  const lineStarts = lineStartOffsets(haystack);
  for (let i = 0; i <= hLines.length - nLines; i++) {
    let all = true;
    for (let j = 0; j < nLines; j++) {
      if (hLines[i + j].trim() !== needleLines[j].trim()) {
        all = false;
        break;
      }
    }
    if (all) {
      const last = lineStarts[i + nLines - 1];
      const end = (i + nLines < lineStarts.length ? lineStarts[i + nLines].start : haystack.length) - last.termLen;
      return { index: lineStarts[i].start, length: end - lineStarts[i].start };
    }
  }
  return null;
}
const DIFF_OPEN = /^<<<<<<< SEARCH\s*$/;
const DIFF_DIVIDER = /^=======\s*$/;
const DIFF_CLOSE = /^>>>>>>> REPLACE\s*$/;
const HAS_DIFF_MARKER = /<<<<<<< SEARCH\s*(?:\r\n|\r|\n)/;
export function tryExtractDiffBlock(text: string): { search: string; replace: string } | null {
  if (!text) return null;
  if (!HAS_DIFF_MARKER.test(text) && !DIFF_OPEN.test(text)) return null;
  const lines = text.split(/\r\n?|\n/);
  let searchStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (DIFF_OPEN.test(lines[i])) { searchStart = i; break; }
  }
  if (searchStart === -1) return null;
  let dividerIdx = -1;
  for (let i = searchStart + 1; i < lines.length; i++) {
    if (DIFF_DIVIDER.test(lines[i])) { dividerIdx = i; break; }
  }
  if (dividerIdx === -1) return null;
  let closeIdx = -1;
  for (let i = dividerIdx + 1; i < lines.length; i++) {
    if (DIFF_CLOSE.test(lines[i])) { closeIdx = i; break; }
  }
  if (closeIdx === -1) return null;
  const search = lines.slice(searchStart + 1, dividerIdx).join("\n");
  const replace = lines.slice(dividerIdx + 1, closeIdx).join("\n");
  return { search, replace };
}
export function applyEdit(input: ApplyEditInput): ApplyEditResult {
  const { before, search, replace, replaceAll } = input;
  const diff = tryExtractDiffBlock(search);
  if (diff) {
    return applyEdit({ before, search: diff.search, replace: diff.replace, replaceAll });
  }
  if (!search) {
    return {
      ok: true,
      after: replace,
      matches: 1,
      strategy: "write",
      diff: diffLines(before, replace),
    };
  }
  if (before.includes(search)) {
    return finalize(before, search, replace, replaceAll, "exact");
  }
  {
    const norm = normalizeLines(before);
    const normSearch = normalizeLines(search);
    if (norm.includes(normSearch)) {
      return finalize(norm, normSearch, normalizeLines(replace), replaceAll, "trim");
    }
    const col = collapseBlank(norm);
    const colSearch = collapseBlank(normSearch);
    if (col.includes(colSearch)) {
      const w2 = windowedMatch(before, search);
      if (!w2) {
        return finalize(col, colSearch, collapseBlank(normalizeLines(replace)), replaceAll, "blank-collapse");
      }
    }
  }
  {
    const w = windowedMatch(before, search);
    if (w) {
      const after = before.slice(0, w.index) + replace + before.slice(w.index + w.length);
      return {
        ok: true,
        after,
        matches: 1,
        strategy: "fuzzy",
        diff: diffLines(before, after),
      };
    }
  }
  {
    const r = findRegex(before, search);
    if (r) {
      const after = before.slice(0, r.index) + replace + before.slice(r.index + r.length);
      return {
        ok: true,
        after,
        matches: 1,
        strategy: "regex",
        diff: diffLines(before, after),
      };
    }
  }
  return {
    ok: false,
    after: before,
    matches: 0,
    strategy: "exact",
    diff: diffLines(before, before),
    error: "search text not found",
  };
}
function finalize(before: string, search: string, replace: string, replaceAll: boolean | undefined, strategy: ApplyEditResult["strategy"]): ApplyEditResult {
  let count = 0;
  let after = before;
  if (replaceAll) {
    const parts = before.split(search);
    count = parts.length - 1;
    after = parts.join(replace);
  } else {
    const idx = findIndex(before, search);
    if (idx >= 0) {
      after = before.slice(0, idx) + replace + before.slice(idx + search.length);
      count = 1;
      if (before.split(search).length - 1 > 1) {
        return {
          ok: false,
          after: before,
          matches: 0,
          strategy,
          diff: diffLines(before, before),
          error: "search text matches multiple locations; pass replaceAll:true to replace every occurrence",
        };
      }
    }
  }
  return {
    ok: count > 0,
    after,
    matches: count,
    strategy,
    diff: diffLines(before, after),
  };
}
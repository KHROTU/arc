import { saveBlob } from "./store.js";
export type ContentKind = "json-array" | "json-object" | "log" | "text";
export interface CompressOutcome {
  output: string;
  id?: string;
  kind: ContentKind | "none";
  originalLength: number;
  saved: number;
}
const MIN_SAVINGS_RATIO = 0.3;
const MAX_STORE_BYTES = 1024 * 1024;
const ERROR_MARKERS = /error|fail|exception|warn|denied|invalid|fatal|trace|timeout|abort|reject/i;
export function detectKind(text: string): ContentKind {
  const t = text.trimStart();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const v = JSON.parse(text);
      if (Array.isArray(v)) return "json-array";
      if (v !== null && typeof v === "object") return "json-object";
    } catch {}
  }
  const lines = text.split(/\r?\n/);
  if (lines.length >= 40) return "log";
  return "text";
}
export async function compressForContext(text: string, toolName: string, workspaceRoot: string): Promise<CompressOutcome> {
  if (text.length < 4096) return { output: text, kind: "none", originalLength: text.length, saved: 0 };
  const kind = detectKind(text);
  let compressed: string | undefined;
  if (kind === "json-array") compressed = crushJsonArray(text);
  else if (kind === "log") compressed = crushLines(text, 25, 15);
  else if (kind === "json-object") compressed = crushJsonObject(text);
  else compressed = crushLines(text, 40, 20);
  const saved = text.length - (compressed?.length ?? 0);
  if (!compressed || saved <= 0 || compressed.length > text.length * (1 - MIN_SAVINGS_RATIO)) {
    return { output: text, kind: "none", originalLength: text.length, saved: 0 };
  }
  let id: string | undefined;
  if (text.length <= MAX_STORE_BYTES) {
    try {
      id = await saveBlob(workspaceRoot, toolName, text);
    } catch {}
  }
  const retrieval = id
    ? `\n[Compressed output. To view the full original, call context.retrieve with id "${id}".]`
    : "";
  return { output: `${compressed}${retrieval}`, id, kind, originalLength: text.length, saved };
}
export function crushJsonArray(text: string): string | undefined {
  let rows: unknown[];
  try {
    const v = JSON.parse(text);
    if (!Array.isArray(v)) return undefined;
    rows = v;
  } catch {
    return undefined;
  }
  if (rows.length < 40) return undefined;
  const keepHead = 3;
  const keepTail = 5;
  const maxKeep = 40;
  const kept = new Set<number>();
  for (let i = 0; i < Math.min(keepHead, rows.length); i++) kept.add(i);
  for (let i = rows.length - 1; i >= rows.length - keepTail && i >= 0; i--) kept.add(i);
  for (let i = 0; i < rows.length && kept.size < maxKeep; i++) {
    if (kept.has(i)) continue;
    const s = JSON.stringify(rows[i]) ?? "";
    if (s.length >= 12 && ERROR_MARKERS.test(s)) kept.add(i);
  }
  for (let i = 0; i < rows.length && kept.size < maxKeep; i++) {
    if (!kept.has(i)) kept.add(i);
  }
  const omitted = rows.length - kept.size;
  if (omitted <= 0) return undefined;
  const parts: string[] = [];
  let prev = -1;
  let omittedRun = 0;
  const pushGap = (end: number) => {
    if (end > prev + 1) omittedRun += end - prev - 1;
  };
  for (let i = 0; i < rows.length; i++) {
    if (kept.has(i)) {
      pushGap(i);
      if (prev >= 0) {
        if (omittedRun > 0) parts.push(`... (${omittedRun} rows omitted)`);
        else parts.push(",");
      }
      parts.push(JSON.stringify(rows[i]));
      omittedRun = 0;
      prev = i;
    }
  }
  if (rows.length - 1 > prev) omittedRun += rows.length - 1 - prev;
  const body = parts.join(" ");
  const summary = `[... ${omitted} of ${rows.length} rows omitted]`;
  return `${summary}\n${body}`;
}
export function crushJsonObject(text: string): string | undefined {
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
    const compact = JSON.stringify(v);
    if (compact.length >= text.length * 0.7) return undefined;
    return compact;
  } catch {
    return undefined;
  }
}
export function crushLines(text: string, keepHead: number, keepTail: number): string | undefined {
  const lines = text.split(/\r?\n/);
  const stripped = lines.map((l) => l.replace(/[ \t]+$/g, ""));
  if (stripped.length <= keepHead + keepTail) return undefined;
  const head = stripped.slice(0, keepHead);
  const tail = stripped.slice(-keepTail);
  const omitted = stripped.length - head.length - tail.length;
  const collapsed = [...head, `... (${omitted} lines omitted)`, ...tail].join("\n");
  if (collapsed.length >= text.length) return undefined;
  return collapsed;
}
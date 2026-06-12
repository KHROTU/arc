/**
 * Remove comments from source files. Single-line (//) and multi-line (/* *)
 * comments are stripped. Text inside strings, templates, and regexes is left
 * untouched.
 *
 * Adapted from bloxdforge/scripts/remove-blank-lines.mjs for the Arc
 * extension's source tree, with the comment-stripping logic added.
 */
import { glob } from 'glob';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(decodeURI(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));

const DIRS = [
  'packages/host/src',
  'packages/host/test',
  'packages/arc/src',
  'packages/arc/webview-ui/src',
  'packages/arc/webview-ui/test',
];

const EXT_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,css}';

function processFile(filePath) {
  const original = readFileSync(filePath, 'utf-8');
  const lines = original.split('\n');
  let inTemplate = false;
  let inSingleString = false;
  let inDoubleString = false;
  let inRegex = false;
  let inBlockComment = false;
  const outputLines = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const startedInBlock = inBlockComment;
    let inSingleLineComment = false;
    let escapeNext = false;
    // -1 = whole line suppressed; 0 = keep from start; >0 = keep left of this col.
    let keepLeftOf = 0;
    // When a block comment opens/closes mid-line, these track non-comment
    // content before/after. `nonCommentPrefix` is the text before `/*`;
    // `nonCommentSuffixCol` is the column right after `*/`.
    let nonCommentPrefix = -1;
    let nonCommentSuffixCol = -1;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (inSingleLineComment) {
        // A `//` consumed the rest of the line. If it started at column 0
        // (whole line is a comment), suppress the line. Otherwise keep
        // everything to the left of the `//`.
        if (keepLeftOf === 0 && nonCommentPrefix === -1) {
          keepLeftOf = -1; // whole line suppressed
        }
        break;
      }
      if (inRegex) {
        if (ch === '\\') { escapeNext = true; continue; }
        if (ch === '/') { inRegex = false; }
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && line[i + 1] === '/') {
          inBlockComment = false;
          i++;
          nonCommentSuffixCol = i + 1;
        }
        continue;
      }
      const insideCode = inTemplate || inSingleString || inDoubleString;
      if (ch === '/' && line[i + 1] === '/' && !insideCode) {
        const prev = line.slice(0, i);
        keepLeftOf = prev.trim() ? i : 0;
        inSingleLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && line[i + 1] === '*' && !insideCode) {
        inBlockComment = true;
        // The opening `/*` is at column `i`. Everything before it is
        // live code. If the whole line is a block comment (started at
        // very beginning), we'll detect that in the output logic below.
        if (!startedInBlock && keepLeftOf === 0) {
          nonCommentPrefix = i;
        }
        i++;
        continue;
      }
      if (ch === '/' && line[i + 1] !== '/' && line[i + 1] !== '*' && !insideCode) {
        let k = i - 1;
        while (k >= 0 && (line[k] === ' ' || line[k] === '\t')) k--;
        if (k >= 0) {
          const prev = line[k];
          if ('(=,!?:|&[~{+-;'.includes(prev) || prev === '<' || prev === '>') {
            inRegex = true;
            continue;
          }
        }
      }
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === "'" && !inDoubleString && !inTemplate) {
        inSingleString = !inSingleString;
        continue;
      }
      if (ch === '"' && !inSingleString && !inTemplate) {
        inDoubleString = !inDoubleString;
        continue;
      }
      if (ch === '`' && !inSingleString && !inDoubleString) {
        inTemplate = !inTemplate;
      }
    }

    // --- Decide what to emit for this line ---

    // 1) Whole-line `//` comment.
    if (keepLeftOf === -1) continue;

    // 2) Entire line is inside a block comment (started on a previous line
    //    and no `*/` appeared on this line).
    if (startedInBlock && nonCommentSuffixCol === -1 && !inBlockComment) {
      // Block comment closed but suffixCol was set? Actually if closed, suffix
      // is set. If NOT closed, the whole line is inside the block comment.
      continue;
    }

    // 3) Line ended inside a block comment (after a `/*` on this line with
    //    no `*/`). Only keep what's before the `/*`. If nothing meaningful
    //    before, drop entirely.
    if (inBlockComment && nonCommentPrefix >= 0) {
      const kept = line.slice(0, nonCommentPrefix);
      if (kept.trim().length > 0) outputLines.push(kept);
      continue;
    }
    if (inBlockComment && nonCommentPrefix < 0) {
      // The whole line is `/* ...` — drop it.
      continue;
    }

    // 4) A block comment opened AND closed on this line (`/* ... */`).
    //    Keep the prefix (before `/*`) and suffix (after `*/`), join them.
    if (!startedInBlock && nonCommentPrefix >= 0 && nonCommentSuffixCol >= 0) {
      const prefix = line.slice(0, nonCommentPrefix);
      const suffix = line.slice(nonCommentSuffixCol);
      const joined = (prefix + suffix).trim();
      if (joined.length > 0) outputLines.push(joined);
      continue;
    }

    // 5) Line started inside a block comment (from a previous line) but
    //    `*/` appeared on THIS line. Keep everything after `*/`.
    if (startedInBlock && nonCommentSuffixCol >= 0) {
      const suffix = line.slice(nonCommentSuffixCol);
      if (suffix.trim().length > 0) outputLines.push(suffix);
      continue;
    }

    // 6) Trailing `//` comment — keep the code before it.
    if (keepLeftOf > 0) {
      const kept = line.slice(0, keepLeftOf);
      if (kept.trim().length > 0) outputLines.push(kept);
      continue;
    }

    // 7) No comment on this line at all. Keep as-is.
    outputLines.push(line);
  }

  const result = outputLines.join('\n');
  if (result !== original) {
    writeFileSync(filePath, result, 'utf-8');
    console.log(`  cleaned: ${filePath}`);
    return true;
  }
  return false;
}

async function main() {
  let totalFiles = 0;
  let changedFiles = 0;
  for (const dir of DIRS) {
    const pattern = `${dir}/${EXT_GLOB}`;
    const files = await glob(pattern, { cwd: ROOT, nodir: true, dot: false });
    console.log(`\n${dir}/ (${files.length} files)`);
    for (const f of files) {
      const abs = resolve(ROOT, f);
      if (processFile(abs)) changedFiles++;
      totalFiles++;
    }
  }
  console.log(`\nDone. Processed ${totalFiles} files, changed ${changedFiles}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

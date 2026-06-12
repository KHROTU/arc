/**
 * Remove blank lines from source files. Blank lines INSIDE strings,
 * templates, regexes, or multi-line comments are preserved (their line
 * breaks are part of the syntax). Only true "whitespace-only" lines that
 * sit at the top level are stripped.
 *
 * Adapted from bloxdforge/scripts/remove-blank-lines.mjs for the Arc
 * extension's source tree.
 */
import { glob } from 'glob';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(decodeURI(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));

// Source dirs to process. The webview tree, the host package, and the
// extension entry point. node_modules, dist, .vscode, and the .reference
// (Kilo) tree are excluded.
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
    const wasInTemplate = inTemplate;
    let inSingleLineComment = false;
    let escapeNext = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (inSingleLineComment) {
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
        }
        continue;
      }
      const insideCode = inTemplate || inSingleString || inDoubleString;
      if (ch === '/' && line[i + 1] === '/' && !insideCode) {
        inSingleLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && line[i + 1] === '*' && !insideCode) {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === '/' && line[i + 1] !== '/' && line[i + 1] !== '*' && !insideCode) {
        // Heuristic: a `/` that opens a regex is one whose previous
        // non-whitespace character is an operator, a paren, or a
        // punctuation that commonly precedes a regex.
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

    const trimmed = line.trim();
    if (trimmed.length > 0 || wasInTemplate) {
      outputLines.push(line);
    }
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

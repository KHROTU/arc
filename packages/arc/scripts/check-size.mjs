import { statSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "..");
const MAX_KB = 500;
try {
  const files = readdirSync(pkgDir).filter((f) => f.endsWith(".vsix"));
  if (files.length === 0) {
    console.log("No VSIX found in package directory.");
    process.exit(0);
  }
  const vsixPath = resolve(pkgDir, files[0]);
  const info = statSync(vsixPath);
  const kb = info.size / 1024;
  const mb = (kb / 1024).toFixed(3);
  console.log(`VSIX: ${kb.toFixed(1)} KB (${mb} MB) — ${files[0]}`);
  if (kb > MAX_KB) {
    console.error(`ERROR: VSIX exceeds ${MAX_KB} KB budget (${kb.toFixed(1)} KB)`);
    process.exit(1);
  }
  console.log(`OK: within ${MAX_KB} KB budget`);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(0);
}
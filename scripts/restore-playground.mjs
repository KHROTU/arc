import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ZIP = join(ROOT, "scripts", "playground-clean.zip");
const PLAYGROUND = join(ROOT, "playground");
if (!existsSync(ZIP)) {
  console.error(`Archive not found: ${ZIP}`);
  process.exit(1);
}
if (existsSync(PLAYGROUND)) {
  rmSync(PLAYGROUND, { recursive: true, force: true });
}
if (process.platform === "win32") {
  execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${ZIP}' -DestinationPath '${ROOT}' -Force"`, { stdio: "inherit" });
} else {
  execSync(`unzip -oq "${ZIP}" -d "${ROOT}"`, { stdio: "inherit" });
}
console.log("Playground restored.");

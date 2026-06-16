import { execSync } from "node:child_process";
import * as os from "node:os";
const PLATFORM = os.platform();
export type SandboxProfile = "off" | "read-only" | "workspace";
let warnedMissing = false;
export function getSandboxArgs(profile: SandboxProfile, workspaceRoot: string): string[] {
  if (profile === "off") return [];
  switch (PLATFORM) {
    case "darwin":
      return getSeatbeltArgs(profile, workspaceRoot);
    case "linux":
      return getLandlockArgs(profile, workspaceRoot);
    case "win32":
      return getWindowsSandboxArgs(profile, workspaceRoot);
    default:
      return [];
  }
}
export function sandboxBinaryAvailable(profile: SandboxProfile): boolean {
  if (profile === "off") return true;
  try {
    switch (PLATFORM) {
      case "darwin":
        execSync("which sandbox-exec", { stdio: "ignore" });
        return true;
      case "linux":
        return checkLandlock();
      case "win32":
        return false;
      default:
        return false;
    }
  } catch {
    return false;
  }
}
export function warnSandboxUnavailable(profile: SandboxProfile): string | undefined {
  if (profile === "off" || sandboxBinaryAvailable(profile)) return undefined;
  if (warnedMissing) return undefined;
  warnedMissing = true;
  return `Sandbox profile '${profile}' is configured but the native sandbox binary was not found on this system. All shell commands will run unsandboxed.`;
}
function getSeatbeltArgs(profile: SandboxProfile, root: string): string[] {
  const sb = `(allow file-read* file-write* (subpath "${root}") (allow default))`;
  if (profile === "read-only") return ["sandbox-exec", "-p", sb.replace("file-write*", "")];
  return ["sandbox-exec", "-p", sb];
}
function getLandlockArgs(_profile: SandboxProfile, _root: string): string[] {
  return ["bwrap", "--ro-bind", "/", "/", "--bind", _root, _root, "--dev", "/dev", "--proc", "/proc"];
}
function getWindowsSandboxArgs(_profile: SandboxProfile, _root: string): string[] {
  return [];
}
function checkLandlock(): boolean {
  try {
    const fs = require("node:fs");
    return fs.existsSync("/usr/bin/bwrap") || fs.existsSync("/usr/local/bin/bwrap");
  } catch {
    return false;
  }
}
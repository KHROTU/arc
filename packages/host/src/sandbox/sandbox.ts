import { execSync } from "node:child_process";
import * as os from "node:os";
const PLATFORM = os.platform();
export type SandboxProfile = "off" | "read-only" | "workspace";
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
function getSeatbeltArgs(profile: SandboxProfile, root: string): string[] {
  const escaped = root.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const workspaceWrite = profile === "workspace" ? `(allow file-write* (subpath "${escaped}"))` : "";
  const write = `${workspaceWrite}(allow file-write* (subpath "/private/tmp"))(allow file-write* (subpath "/tmp"))`;
  const sb = `(version 1)(deny default)(allow process*)(allow file-read*)(allow network*)${write}`;
  return ["sandbox-exec", "-p", sb];
}
function getLandlockArgs(profile: SandboxProfile, root: string): string[] {
  const args = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"];
  if (profile === "workspace") args.push("--bind", root, root);
  return args;
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
export function wrapSandbox(profile: SandboxProfile, workspaceRoot: string, executable: string, args: string[]): { executable: string; args: string[] } {
  if (profile === "off") return { executable, args };
  if (!sandboxBinaryAvailable(profile)) throw new Error(`Sandbox profile '${profile}' is unavailable on ${PLATFORM}.`);
  const wrapper = getSandboxArgs(profile, workspaceRoot);
  if (!wrapper.length) throw new Error(`Sandbox profile '${profile}' produced no confinement command.`);
  const separator = wrapper[0] === "bwrap" ? ["--"] : [];
  return { executable: wrapper[0], args: [...wrapper.slice(1), ...separator, executable, ...args] };
}
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
export function getArcDir(): string {
  return path.join(os.homedir(), ".arc");
}
export function workspaceHash(workspaceRoot: string): string {
  return createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 12);
}
export function getWorkspaceArcDir(workspaceRoot: string): string {
  return path.join(getArcDir(), "workspaces", workspaceHash(workspaceRoot));
}
export function getSkillsDir(): string {
  return path.join(getArcDir(), "skills");
}
export function getLocalWorkspaceArcDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".arc");
}
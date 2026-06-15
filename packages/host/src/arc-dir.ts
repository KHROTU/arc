import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
export function getArcDir(): string {
  return path.join(os.homedir(), ".arc");
}
export function getWorkspaceArcDir(workspaceRoot: string): string {
  const hash = createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 12);
  return path.join(getArcDir(), "workspaces", hash);
}
export function getSkillsDir(): string {
  return path.join(getArcDir(), "skills");
}
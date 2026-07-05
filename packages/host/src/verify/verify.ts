import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getWorkspaceArcDir } from "../arc-dir.js";
const pexec = promisify(exec);
const IS_WIN = process.platform === "win32";
const EXEC_SHELL: string | undefined = IS_WIN ? "pwsh.exe" : undefined;
export interface VerifyCommand { name: string; command: string; glob?: string }
export interface VerifyConfig { commands: VerifyCommand[]; maxRetries: number }
export interface VerifyCommandResult { name: string; ok: boolean; output: string }
export interface VerifyRunResult { ok: boolean; results: VerifyCommandResult[] }
export function parseVerifyToml(raw: string): VerifyConfig {
  const commands: VerifyCommand[] = [];
  let maxRetries = 3;
  let current: Partial<VerifyCommand> | undefined;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[commands]]") {
      if (current?.name && current.command) commands.push(current as VerifyCommand);
      current = {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = parseTomlScalar(line.slice(eq + 1).trim());
    if (current) {
      if (key === "name") current.name = String(value);
      else if (key === "command") current.command = String(value);
      else if (key === "glob") current.glob = String(value);
    } else if (key === "maxRetries") {
      maxRetries = Number(value);
    }
  }
  if (current?.name && current.command) commands.push(current as VerifyCommand);
  return { commands, maxRetries };
}
function parseTomlScalar(raw: string): unknown {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}
export async function loadVerifyConfig(workspaceRoot: string): Promise<VerifyConfig | undefined> {
  const filePath = path.join(getWorkspaceArcDir(workspaceRoot), "verify.toml");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return parseVerifyToml(raw);
  } catch {
    return undefined;
  }
}
export function matchesVerifyGlob(rel: string, glob: string): boolean {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re).test(rel);
}
export async function runVerification(workspaceRoot: string, config: VerifyConfig, changedFiles: string[]): Promise<VerifyRunResult> {
  const results: VerifyCommandResult[] = [];
  for (const cmd of config.commands) {
    const rels = changedFiles.map((f) => f.replace(/\\/g, "/"));
    if (cmd.glob && rels.length && !rels.some((f) => matchesVerifyGlob(f, cmd.glob!))) continue;
    try {
      const { stdout, stderr } = await pexec(cmd.command, { cwd: workspaceRoot, windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, shell: EXEC_SHELL });
      const output = (stdout + (stderr ? `\n${stderr}` : "")).trim();
      results.push({ name: cmd.name, ok: true, output: output.slice(0, 2000) });
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const output = ((err.stdout ?? "") + (err.stderr ? `\n${err.stderr}` : "") || err.message || "verification failed").toString();
      results.push({ name: cmd.name, ok: false, output: output.slice(0, 2000) });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
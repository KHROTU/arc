import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { wrapSandbox, type SandboxProfile } from "../sandbox/sandbox.js";
export const PROCESS_OUTPUT_LIMIT = 1024 * 1024;
export interface ProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  sandboxProfile?: SandboxProfile;
  workspaceRoot?: string;
  onChunk?: (stream: "stdout" | "stderr", text: string) => void;
  onSpawn?: (process: ChildProcess) => void;
  stdio?: "ignore" | ["pipe" | "ignore", "pipe" | "ignore", "pipe" | "ignore"];
  detached?: boolean;
  input?: string | Buffer;
}
export interface ProcessResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
  truncated: boolean;
}
export function shellCommand(command: string): { executable: string; args: string[] } {
  if (process.platform === "win32") {
    return { executable: "pwsh.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] };
  }
  return { executable: "/bin/sh", args: ["-lc", command] };
}
export function proxyEnvironment(proxyUrl: string | undefined): NodeJS.ProcessEnv | undefined {
  if (!proxyUrl) return undefined;
  try {
    const parsed = new URL(proxyUrl);
    parsed.username = "";
    parsed.password = "";
    const safe = parsed.toString();
    return { HTTP_PROXY: safe, HTTPS_PROXY: safe, http_proxy: safe, https_proxy: safe };
  } catch {
    return undefined;
  }
}
export function minimalEnvironment(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = ["HOME", "USERPROFILE", "TMP", "TEMP", "SystemRoot", "ComSpec", "PATHEXT", "PSModulePath", "LOCALAPPDATA", "APPDATA", "LANG"];
  const env: NodeJS.ProcessEnv = {};
  env.PATH = process.env.PATH ?? process.env.Path;
  for (const key of keys) if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, ...extra };
}
export function spawnBounded(executable: string, args: string[], opts: ProcessOptions): ChildProcess {
  const invocation = opts.sandboxProfile && opts.sandboxProfile !== "off"
    ? wrapSandbox(opts.sandboxProfile, opts.workspaceRoot ?? opts.cwd, executable, args)
    : { executable, args };
  return spawn(invocation.executable, invocation.args, {
    cwd: path.resolve(opts.cwd),
    env: opts.env ?? minimalEnvironment(),
    windowsHide: true,
    stdio: opts.stdio ?? ["pipe", "pipe", "pipe"],
    detached: opts.detached ?? process.platform !== "win32",
    shell: false,
  });
}
export function terminateProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false });
    return;
  }
  try { process.kill(-proc.pid, "SIGKILL"); }
  catch { try { proc.kill("SIGKILL"); } catch {} }
}
export function runProcess(executable: string, args: string[], opts: ProcessOptions): Promise<ProcessResult> {
  const max = opts.maxOutputBytes ?? PROCESS_OUTPUT_LIMIT;
  return new Promise((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawnBounded(executable, args, opts);
      opts.onSpawn?.(proc);
    } catch (error) {
      resolve({ ok: false, stdout: "", stderr: (error as Error).message, truncated: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let truncated = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean, exitCode?: number) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ok, stdout, stderr, exitCode, truncated });
    };
    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (truncated) return;
      const remaining = Math.max(0, max - bytes);
      const accepted = remaining > 0 ? chunk.subarray(0, remaining) : Buffer.alloc(0);
      bytes += accepted.length;
      const text = accepted.toString();
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (text) opts.onChunk?.(stream, text);
      if (accepted.length < chunk.length || bytes >= max) {
        truncated = true;
        terminateProcessTree(proc);
      }
    };
    proc.stdout?.on("data", (d: Buffer) => append("stdout", d));
    proc.stderr?.on("data", (d: Buffer) => append("stderr", d));
    proc.on("error", (error) => {
      stderr += `${stderr ? "\n" : ""}${error.message}`;
      finish(false);
    });
    proc.on("exit", (code) => finish(code === 0 && !truncated, code ?? undefined));
    proc.stdin?.end(opts.input);
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        stderr += `${stderr ? "\n" : ""}Process timed out after ${opts.timeoutMs}ms`;
        terminateProcessTree(proc);
        finish(false);
      }, opts.timeoutMs);
    }
  });
}
export function runShellCommand(command: string, opts: ProcessOptions): Promise<ProcessResult> {
  const invocation = shellCommand(command);
  return runProcess(invocation.executable, invocation.args, opts);
}
let gitOverride: string | undefined;
let gitCache: string | undefined;
export function setGitPath(p: string | undefined): void {
  gitOverride = p ? String(p) : undefined;
  gitCache = undefined;
}
export async function resolveGit(): Promise<string> {
  if (gitOverride) return gitOverride;
  if (gitCache !== undefined) return gitCache;
  gitCache = await findGit();
  return gitCache ?? "git";
}
async function findGit(): Promise<string | undefined> {
  if (await gitProbe("git")) return "git";
  if (process.platform !== "win32") return undefined;
  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe") : undefined,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git", "cmd", "git.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Git", "cmd", "git.exe") : undefined,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "scoop", "apps", "git", "current", "cmd", "git.exe") : undefined,
  ];
  for (const candidate of candidates) {
    if (candidate && (await gitProbe(candidate))) return candidate;
  }
  return undefined;
}
async function gitProbe(executable: string): Promise<boolean> {
  try {
    const r = await runProcess(executable, ["--version"], { cwd: process.cwd(), timeoutMs: 8000, maxOutputBytes: 4096 });
    return r.ok;
  } catch {
    return false;
  }
}
export async function runGit(args: string[], opts: ProcessOptions): Promise<ProcessResult> {
  return runProcess(await resolveGit(), args, opts);
}
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getArcDir } from "../arc-dir.js";
const pexec = promisify(exec);
const IS_WIN = process.platform === "win32";
const EXEC_SHELL: string | undefined = IS_WIN ? "pwsh.exe" : undefined;
export interface HookConfig {
  preWrite?: PreWriteHook[];
  postEdit?: PostEditHook[];
}
export interface PreWriteHook {
  type: "secret-scan" | "custom";
  pattern?: string;
  message?: string;
  command?: string;
}
export interface PostEditHook {
  type: "command";
  command: string;
  glob?: string;
  label: string;
}
export interface HookResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}
async function loadHookConfig(): Promise<HookConfig> {
  const p = path.join(getArcDir(), "hooks.json");
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
const SECRET_PATTERNS = [
  { pattern: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----/i, label: "private key" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key" },
  { pattern: /(?:sk|secret|password|token|apikey|api_key)\s*[:=]\s*['"][^'"]{8,}['"]/i, label: "hardcoded secret" },
  { pattern: /ghp_[0-9a-zA-Z]{36}/, label: "GitHub personal access token" },
  { pattern: /github_pat_[0-9a-zA-Z_]{36,}/, label: "GitHub fine-grained token" },
  { pattern: /sk-[a-zA-Z0-9]{32,}/, label: "OpenAI API key" },
  { pattern: /sk-ant-[a-zA-Z0-9]{32,}/, label: "Anthropic API key" },
];
export async function runPreWriteHooks(filePath: string, content: string): Promise<HookResult> {
  const cfg = await loadHookConfig();
  const errors: string[] = [];
  const warnings: string[] = [];
  const hooks = cfg.preWrite ?? [];
  for (const hook of hooks) {
    if (hook.type === "secret-scan" || (!hook.type && !hook.command)) {
      const patterns = hook.pattern
        ? [{ pattern: new RegExp(hook.pattern, "gm"), label: "custom pattern" }]
        : SECRET_PATTERNS;
      for (const p of patterns) {
        const matches = content.match(p.pattern);
        if (matches && matches.length > 0) {
          const msg = hook.message ?? `Secret scan: potential ${p.label} detected in ${filePath}`;
          warnings.push(msg);
        }
      }
    }
    if (hook.type === "custom" && hook.command) {
      try {
        const { stdout } = await pexec(hook.command, { windowsHide: true, timeout: 10_000, shell: EXEC_SHELL });
        if (stdout.trim()) warnings.push(`Pre-write hook "${hook.command}": ${stdout.trim().slice(0, 500)}`);
      } catch (e) {
        warnings.push(`Pre-write hook "${hook.command}" failed: ${(e as Error).message}`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
export async function runPostEditHooks(filePath: string, root: string): Promise<HookResult> {
  const cfg = await loadHookConfig();
  const errors: string[] = [];
  const warnings: string[] = [];
  const hooks = cfg.postEdit ?? [];
  for (const hook of hooks) {
    if (hook.type !== "command" || !hook.command) continue;
    if (hook.glob) {
      const rel = path.relative(root, filePath).replace(/\\/g, "/");
      const globRe = new RegExp("^" + hook.glob.replace(/\*/g, "[^/]*").replace(/\./g, "\\.").replace(/\*\*/g, ".*") + "$");
      if (!globRe.test(rel)) continue;
    }
    try {
      const cwd = path.dirname(filePath);
      const { stdout, stderr } = await pexec(hook.command, { cwd, windowsHide: true, timeout: 30_000, shell: EXEC_SHELL });
      if (stdout.trim()) {
        warnings.push(`[${hook.label}] ${stdout.trim().slice(0, 500)}`);
      }
      if (stderr.trim()) {
        warnings.push(`[${hook.label}] ${stderr.trim().slice(0, 500)}`);
      }
    } catch (e) {
      warnings.push(`Post-edit hook "${hook.label}" failed: ${(e as Error).message}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getArcDir, getWorkspaceArcDir } from "../arc-dir.js";
const pexec = promisify(exec);
const IS_WIN = process.platform === "win32";
const EXEC_SHELL: string | undefined = IS_WIN ? "pwsh.exe" : undefined;
export type HookEvent =
  | "session.start"
  | "user.submit"
  | "pre.tool"
  | "post.tool"
  | "pre.compact"
  | "post.compact"
  | "pre.handoff"
  | "notification"
  | "stop"
  | "subagent.spawn";
export interface HookMatcher {
  tool?: string;
  mode?: string;
  modelTier?: string;
}
export interface HookEntry {
  event: HookEvent;
  command: string;
  command_windows?: string;
  timeout_sec?: number;
  matchers?: HookMatcher;
}
export interface HookConfig {
  hooks?: HookEntry[];
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
export interface HookEventContext {
  event: HookEvent;
  tool?: string;
  args?: Record<string, unknown>;
  workspaceRoot: string;
  mode?: string;
  modelTier?: string;
  userMessage?: string;
  extra?: Record<string, unknown>;
}
export interface HookDecision {
  decision: "allow" | "deny" | "ask";
  modifiedArgs?: Record<string, unknown>;
  message?: string;
  contextMessage?: string;
}
let cachedConfig: HookConfig | undefined;
let cachedWorkspaceRoot: string | undefined;
export function clearHookConfigCache() {
  cachedConfig = undefined;
  cachedWorkspaceRoot = undefined;
}
async function loadHookConfig(workspaceRoot?: string): Promise<HookConfig> {
  if (workspaceRoot === cachedWorkspaceRoot && cachedConfig) return cachedConfig;
  const globalPath = path.join(getArcDir(), "hooks.json");
  const workspacePath = workspaceRoot ? path.join(getWorkspaceArcDir(workspaceRoot), "hooks.json") : null;
  const global: HookConfig = await loadJson(globalPath);
  const workspace: HookConfig = workspaceRoot ? await loadJson(workspacePath!) : {};
  cachedConfig = {
    hooks: [...(global.hooks ?? []), ...(workspace.hooks ?? [])],
    preWrite: [...(global.preWrite ?? []), ...(workspace.preWrite ?? [])],
    postEdit: [...(global.postEdit ?? []), ...(workspace.postEdit ?? [])],
  };
  cachedWorkspaceRoot = workspaceRoot;
  return cachedConfig;
}
async function loadJson(p: string): Promise<HookConfig> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function matchHook(hook: HookEntry, ctx: HookEventContext): boolean {
  if (hook.event !== ctx.event) return false;
  const m = hook.matchers;
  if (!m) return true;
  if (m.tool && m.tool !== ctx.tool) return false;
  if (m.mode && m.mode !== ctx.mode) return false;
  if (m.modelTier && m.modelTier !== ctx.modelTier) return false;
  return true;
}
export async function runHooks(ctx: HookEventContext): Promise<HookDecision[]> {
  const cfg = await loadHookConfig(ctx.workspaceRoot);
  const decisions: HookDecision[] = [];
  for (const hook of cfg.hooks ?? []) {
    if (!matchHook(hook, ctx)) continue;
    const cmd = IS_WIN && hook.command_windows ? hook.command_windows : hook.command;
    if (!cmd) continue;
    try {
      const { stdout } = await pexec(cmd, {
        windowsHide: true,
        timeout: (hook.timeout_sec ?? 10) * 1000,
        shell: EXEC_SHELL,
        env: { ...process.env, ARC_HOOK: JSON.stringify(ctx) },
      });
      const trimmed = stdout.trim();
      if (!trimmed) continue;
      try {
        const d = JSON.parse(trimmed) as HookDecision;
        if (d.decision === "deny" || d.decision === "ask") {
          decisions.push(d);
          return decisions;
        }
        if (d.decision === "allow" && d.modifiedArgs) {
          decisions.push(d);
          return decisions;
        }
        if (d.contextMessage) decisions.push(d);
      } catch {
        decisions.push({ decision: "deny", message: `Hook ${hook.event} returned invalid JSON: ${trimmed.slice(0, 200)}` });
        return decisions;
      }
    } catch {
    }
  }
  return decisions;
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
export async function runPreWriteHooks(filePath: string, content: string, workspaceRoot?: string): Promise<HookResult> {
  const cfg = await loadHookConfig(workspaceRoot);
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
  const cfg = await loadHookConfig(root);
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
      if (stdout.trim()) warnings.push(`[${hook.label}] ${stdout.trim().slice(0, 500)}`);
      if (stderr.trim()) warnings.push(`[${hook.label}] ${stderr.trim().slice(0, 500)}`);
    } catch (e) {
      warnings.push(`Post-edit hook "${hook.label}" failed: ${(e as Error).message}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
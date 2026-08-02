import * as path from "node:path";
import * as fs from "node:fs/promises";
import { getWorkspaceArcDir } from "../arc-dir.js";
import { classifyWorkspacePath } from "../security/path-policy.js";
import type { ApprovalsConfig, ApprovalPreset, SessionApprovals } from "./types.js";
import { PRESETS } from "./types.js";
export function resolvePreset(preset: ApprovalPreset): ApprovalsConfig {
  return PRESETS[preset] ?? PRESETS.dev;
}
export function resolveApproval(
  config: ApprovalsConfig,
  session: SessionApprovals,
  category: string,
  extra?: { filePath?: string; workspaceRoot?: string; command?: string; mcpServer?: string },
): "auto" | "ask" {
  const effectiveConfig = config.preset ? resolvePreset(config.preset) : config;
  const taskConfig = session.taskOverride ?? effectiveConfig;
  if (category === "code.execute" || category === "subagent" || category === "mcp.configure") return "ask";
  if (category === "read" && extra?.filePath && extra.workspaceRoot && classifyWorkspacePath(extra.workspaceRoot, extra.filePath).external) return "ask";
  if ((category === "write.local" || category === "write.external") && classifyWritePath(extra?.filePath, extra?.workspaceRoot) === "write.external") return "ask";
  if (session.autoApproveAll) return "auto";
  if (category === "mcp" && extra?.mcpServer) {
    const perServer = taskConfig.mcp.perServer[extra.mcpServer];
    if (perServer) return perServer;
    return taskConfig.mcp.default;
  }
  if (category === "read" && extra?.filePath && extra.workspaceRoot) {
    const actual = classifyWorkspacePath(extra.workspaceRoot, extra.filePath).external ? "read.external" : "read";
    return taskConfig[actual] ?? "ask";
  }
  if (category === "write.local" || category === "write.external") {
    const actual = classifyWritePath(extra?.filePath, extra?.workspaceRoot);
    return taskConfig[actual] ?? "ask";
  }
  if (category === "shell.safe" || category === "shell.other") {
    if (extra?.command && isSessionAllowed(session, extra.command)) return "auto";
    return taskConfig[category] ?? "ask";
  }
  const configured = (taskConfig as unknown as Record<string, unknown>)[category];
  return configured === "auto" ? "auto" : "ask";
}
function classifyWritePath(filePath: string | undefined, workspaceRoot: string | undefined): "write.local" | "write.external" {
  if (!filePath || !workspaceRoot) return "write.external";
  return classifyWorkspacePath(workspaceRoot, filePath).external ? "write.external" : "write.local";
}
function isSessionAllowed(session: SessionApprovals, command: string): boolean {
  const trimmed = command.trim();
  for (const prefix of session.sessionCommandAllowlist) {
    if (trimmed === prefix || trimmed.startsWith(prefix + " ")) return true;
  }
  for (const mem of session.commandPrefixMemory) {
    if (trimmed === mem.prefix || trimmed.startsWith(mem.prefix + " ")) return true;
  }
  return false;
}
export function initSession(): SessionApprovals {
  return {
    autoApproveAll: false,
    sessionCommandAllowlist: [],
    commandPrefixMemory: [],
  };
}
export async function loadApprovalsMemory(workspaceRoot: string): Promise<{ prefix: string; createdAt: string }[]> {
  try {
    const p = path.join(getWorkspaceArcDir(workspaceRoot), "approvals.json");
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}
export async function saveApprovalPrefix(workspaceRoot: string, prefix: string): Promise<void> {
  const existing = await loadApprovalsMemory(workspaceRoot);
  if (existing.some((e) => e.prefix === prefix)) return;
  existing.push({ prefix, createdAt: new Date().toISOString() });
  const dir = getWorkspaceArcDir(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "approvals.json"), JSON.stringify(existing, null, 2), "utf-8");
}
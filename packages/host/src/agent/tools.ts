import { exec, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FileEditor } from "../edit/editor.js";
import { getSkillsDir } from "../arc-dir.js";
import { runPreWriteHooks, runPostEditHooks } from "../hooks/hooks.js";
import { getSandboxArgs } from "../sandbox/sandbox.js";
import { makeProxyDispatcher } from "../util/proxy.js";
import type { SandboxProfile } from "../sandbox/sandbox.js";
import type { DiffHunk } from "../protocol/process.js";
const pexec = promisify(exec);
const IS_WIN = process.platform === "win32";
const SHELL: string | boolean = IS_WIN ? "pwsh.exe" : true;
const EXEC_SHELL: string | undefined = IS_WIN ? "pwsh.exe" : undefined;
function shellEnv(proxyUrl: string | undefined): Record<string, string> | undefined {
  if (!proxyUrl) return undefined;
  return { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl };
}
type BrowserAdapter = import("../browser/browser.js").BrowserAdapter;
type BrowserSource = BrowserAdapter | (() => Promise<BrowserAdapter>);
async function resolveBrowser(src: BrowserSource | undefined): Promise<BrowserAdapter | undefined> {
  if (!src) return undefined;
  return typeof src === "function" ? await src() : src;
}
interface BgProcess { proc: ChildProcess; stdout: string; stderr: string; exited: boolean; exitCode: number | undefined; }
const bgProcesses = new Map<string, BgProcess>();
let bgIds = 0;
const activeProcesses = new Set<ChildProcess>();
export function killActiveProcesses(): { count: number; pids: number[] } {
  const pids: number[] = [];
  let count = 0;
  for (const proc of activeProcesses) {
    if (proc.pid && !proc.killed) {
      pids.push(proc.pid);
      try { process.kill(proc.pid, "SIGINT"); } catch {}
      try { proc.kill("SIGINT"); } catch {}
      count++;
    }
  }
  activeProcesses.clear();
  return { count, pids };
}
async function runAfterCmd(cmd: string | undefined, cwd: string): Promise<{ command: string; output: string } | undefined> {
  if (!cmd) return undefined;
  try {
    const { stdout, stderr } = await pexec(cmd, { cwd, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: EXEC_SHELL });
    const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(0, 2000) || "(no output)";
    return { command: cmd, output };
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { command: cmd, output: `[runAfter failed] ${err.message ?? e}` };
  }
}
async function runSingleCommand(
  cmd: string,
  cwd: string,
  _ctx: ToolContext,
  onChunk?: (stream: "stdout" | "stderr", text: string) => void,
): Promise<{ ok: boolean; output: string }> {
  const sandboxArgs = _ctx.sandboxProfile ? getSandboxArgs(_ctx.sandboxProfile, _ctx.workspacePath) : [];
  const fullCmd = sandboxArgs.length ? sandboxArgs.concat([cmd]).join(" ") : cmd;
  const proxyEnv = shellEnv(_ctx.proxyShell || _ctx.proxyUrl);
  return new Promise((resolve) => {
    const proc = spawn(fullCmd, { cwd, shell: SHELL, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...(proxyEnv ? { env: { ...process.env, ...proxyEnv } } : {}) });
    activeProcesses.add(proc);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finalize = (ok: boolean, errMsg?: string) => {
      if (settled) return;
      settled = true;
      activeProcesses.delete(proc);
      const out = errMsg
        ? `${errMsg}\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`
        : stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
      resolve({ ok, output: out });
    };
    proc.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      onChunk?.("stdout", s);
    });
    proc.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      onChunk?.("stderr", s);
    });
    proc.on("error", (err) => finalize(false, err.message));
    proc.on("exit", (code) => {
      if (code === 0) finalize(true);
      else finalize(false, `Process exited with code ${code}`);
    });
  });
}
import type { ApprovalsConfig, SessionApprovals, ApproveShellMeta } from "../approvals/index.js";
import type { SkillRegistry } from "../skills/index.js";
import type { RuleRegistry } from "../rules/index.js";
export interface ToolContext {
  root: string;
  approvalsConfig: ApprovalsConfig;
  sessionApprovals: SessionApprovals;
  requestApproval?: (description: string, meta?: ApproveShellMeta) => Promise<boolean>;
  addSessionCommand?: (command: string) => void;
  skillRegistry?: SkillRegistry;
  ruleRegistry?: RuleRegistry;
  sandboxProfile?: SandboxProfile;
  problems?: () => Promise<import("../lsp/bridge.js").DiagnosticLite[]>;
  problemsFor?: (file: string) => Promise<import("../lsp/bridge.js").DiagnosticLite[]>;
  summaryForFiles?: (files: string[]) => Promise<{ hasErrors: boolean; hasWarnings: boolean; text: string }>;
  grep?: (pattern: string, include?: string) => Promise<{ file: string; line: number; column: number; text: string }[]>;
  glob?: (pattern: string) => Promise<string[]>;
  browser?: import("../browser/browser.js").BrowserAdapter | (() => Promise<import("../browser/browser.js").BrowserAdapter>);
  mcp?: import("../mcp/mcp.js").McpAggregator;
  workspacePath: string;
  onChunk?: (stream: "stdout" | "stderr", text: string) => void;
  proxyUrl?: string;
  proxyProvider?: string;
  proxyWeb?: string;
  proxyShell?: string;
  semanticSearch?: (query: string, k?: number) => Promise<{ file: string; start: number; end: number; score: number; snippet: string }[]>;
}
export interface ToolResult {
  ok: boolean;
  output: string;
  touchedFiles?: string[];
  todoState?: { items: { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" | "blocked" | "failed"; children?: { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" | "blocked" | "failed" }[] }[] };
  clarification?: { id: string; answer: string };
  diffHunks?: DiffHunk[];
  filePath?: string;
  runAfter?: { command: string; output: string };
}
export type ToolFn = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
export function checkWriteGlob(filePath: string, glob: string): { allowed: boolean } {
  try {
    const re = new RegExp(glob, "i");
    return { allowed: re.test(filePath) };
  } catch {
    return { allowed: true };
  }
}
export const tools: Record<string, { description: string; fn: ToolFn }> = {
  "file.read": {
    description: "Read a file from the workspace. Args: { path, offset?, limit? }",
    fn: async (args, ctx) => {
      const ed = new FileEditor(ctx.root);
      const offset = args.offset ? Number(args.offset) : undefined;
      const limit = args.limit ? Number(args.limit) : undefined;
      const body = await ed.read(String(args.path), { offset, limit });
      return { ok: true, output: body, filePath: String(args.path) };
    },
  },
  "file.edit": {
    description: "Apply an edit. PREFER passing a SEARCH/REPLACE block in `search`:\n<<<<<<< SEARCH\nexact text\n=======\nreplacement\n>>>>>>> REPLACE\nFallback args: { path, search, replace, replaceAll?, runAfter? }",
    fn: async (args, ctx) => {
      const ed = new FileEditor(ctx.root);
      const filePath = String(args.path);
      const replace = String(args.replace);
      await runPreWriteHooks(filePath, replace, ctx.root);
      const r = await ed.apply(filePath, String(args.search), replace, { replaceAll: !!args.replaceAll });
      const ra = await runAfterCmd(args.runAfter ? String(args.runAfter) : undefined, ctx.workspacePath);
      if (r.ok) {
        runPostEditHooks(filePath, ctx.root).catch(() => {});
      }
      return {
        ok: r.ok,
        output: r.ok ? `Edited ${filePath} (${r.strategy}, ${r.matches} match${r.matches === 1 ? "" : "es"})` : `Error: ${r.error}`,
        touchedFiles: r.ok ? [filePath] : [],
        diffHunks: r.diff.map((c) => ({ added: c.added ?? false, removed: c.removed ?? false, value: c.value })),
        filePath: filePath,
        runAfter: ra,
      };
    },
  },
  "file.write": {
    description: "Write a new file (or overwrite). Args: { path, content, runAfter? }",
    fn: async (args, ctx) => {
      const ed = new FileEditor(ctx.root);
      const filePath = String(args.path);
      const content = String(args.content);
      await runPreWriteHooks(filePath, content, ctx.root);
      const r = await ed.apply(filePath, "", content);
      const ra = await runAfterCmd(args.runAfter ? String(args.runAfter) : undefined, ctx.workspacePath);
      runPostEditHooks(filePath, ctx.root).catch(() => {});
      return {
        ok: true,
        output: `Wrote ${filePath}`,
        touchedFiles: [filePath],
        diffHunks: r.diff.map((c) => ({ added: c.added ?? false, removed: c.removed ?? false, value: c.value })),
        filePath: filePath,
        runAfter: ra,
      };
    },
  },
  "file.grep": {
    description: "Search the workspace for a regex pattern. Args: { pattern, include? }",
    fn: async (args, ctx) => {
      if (!ctx.grep) return { ok: false, output: "Grep not available in this environment." };
      const pattern = String(args.pattern ?? "");
      const include = args.include ? String(args.include) : undefined;
      if (!pattern) return { ok: false, output: "No pattern provided." };
      const results = await ctx.grep(pattern, include);
      if (results.length === 0) return { ok: true, output: `No matches for /${pattern}/` };
      const out = results.map((r) => `${r.file}:${r.line}:${r.column}: ${r.text}`).join("\n");
      return { ok: true, output: out };
    },
  },
  "file.glob": {
    description: "Find files matching a glob pattern. Args: { pattern }",
    fn: async (args, ctx) => {
      if (!ctx.glob) return { ok: false, output: "Glob not available in this environment." };
      const pattern = String(args.pattern ?? "");
      if (!pattern) return { ok: false, output: "No pattern provided." };
      const files = await ctx.glob(pattern);
      if (files.length === 0) return { ok: true, output: `No files matching ${pattern}` };
      return { ok: true, output: files.join("\n") };
    },
  },
  "shell.run": {
    description: "Run a shell command in the workspace (subject to approval).",
    fn: async (args, ctx) => {
      const cmd = String(args.command);
      const sandboxArgs = ctx.sandboxProfile ? getSandboxArgs(ctx.sandboxProfile, ctx.workspacePath) : [];
      const fullCmd = sandboxArgs.length ? sandboxArgs.concat([cmd]).join(" ") : cmd;
      const timeoutSec = args.timeout ? Number(args.timeout) : -1;
      const cwd = (args.cwd ? String(args.cwd) : ctx.root) || ctx.root;
      const onChunk = ctx.onChunk;
      const proxyEnv = shellEnv(ctx.proxyShell || ctx.proxyUrl);
      return new Promise<ToolResult>((resolve) => {
        const proc = spawn(fullCmd, { cwd, shell: SHELL, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...(proxyEnv ? { env: { ...process.env, ...proxyEnv } } : {}) });
        activeProcesses.add(proc);
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finalize = (ok: boolean, errMsg?: string, killed = false) => {
          if (settled) return;
          settled = true;
          activeProcesses.delete(proc);
          const combined = (stdout + (stderr ? `\n[stderr]\n${stderr}` : ""));
          const hint = killed ? ` (killed after ${timeoutSec}s timeout)` : "";
          const out = errMsg
            ? `${errMsg}${hint}\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`
            : combined;
          resolve({ ok, output: out });
        };
        proc.stdout?.on("data", (d: Buffer) => {
          const s = d.toString();
          stdout += s;
          onChunk?.("stdout", s);
        });
        proc.stderr?.on("data", (d: Buffer) => {
          const s = d.toString();
          stderr += s;
          onChunk?.("stderr", s);
        });
        proc.on("error", (err) => finalize(false, err.message));
        proc.on("exit", (code) => {
          if (code === 0) finalize(true);
          else finalize(false, `Process exited with code ${code}`);
        });
        if (timeoutSec > 0) {
          setTimeout(() => {
            if (!settled) {
              proc.kill();
              finalize(false, "Process killed after timeout", true);
            }
          }, timeoutSec * 1000);
        }
      });
    },
  },
  "shell.backgroundRun": {
    description: "Launch a long-running shell process in the background.",
    fn: async (args, ctx) => {
      const cmd = String(args.command);
      const cwd = (args.cwd ? String(args.cwd) : ctx.root) || ctx.root;
      try {
        const proxyEnv = shellEnv(ctx.proxyShell || ctx.proxyUrl);
        const proc = spawn(cmd, { cwd, shell: SHELL, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...(proxyEnv ? { env: { ...process.env, ...proxyEnv } } : {}) });
        activeProcesses.add(proc);
        const bg: BgProcess = { proc, stdout: "", stderr: "", exited: false, exitCode: undefined };
        const id = String(bgIds++);
        bgProcesses.set(id, bg);
        const onChunk = ctx.onChunk;
        proc.stdout?.on("data", (d: Buffer) => {
          const s = d.toString();
          bg.stdout += s;
          onChunk?.("stdout", s);
        });
        proc.stderr?.on("data", (d: Buffer) => {
          const s = d.toString();
          bg.stderr += s;
          onChunk?.("stderr", s);
        });
        proc.on("exit", (code) => { bg.exited = true; bg.exitCode = code ?? undefined; activeProcesses.delete(proc); setTimeout(() => { bgProcesses.delete(id); }, 60_000); });
        proc.on("error", (err) => { bg.exited = true; bg.stderr += `\n[spawn error] ${err.message}`; activeProcesses.delete(proc); setTimeout(() => { bgProcesses.delete(id); }, 60_000); });
        return { ok: true, output: `Background process started (id: ${id}). Use shell.check to poll output.` };
      } catch (e: unknown) {
        return { ok: false, output: `Failed to start background process: ${(e as Error).message}` };
      }
    },
  },
  "shell.check": {
    description: "Poll a background process for output and status. Args: { id }",
    fn: async (args) => {
      const id = String(args.id ?? "");
      const bg = bgProcesses.get(id);
      if (!bg) return { ok: false, output: `No background process with id '${id}'.` };
      const status = bg.exited ? `exited (code ${bg.exitCode ?? "unknown"})` : "running";
      const out = (bg.stdout + (bg.stderr ? `\n[stderr]\n${bg.stderr}` : ""));
      return { ok: true, output: `[${status}]\n${out}` };
    },
  },
  "shell.write": {
    description: "Send input to a running background process. Args: { id, input }",
    fn: async (args) => {
      const id = String(args.id ?? "");
      const input = String(args.input ?? "");
      const bg = bgProcesses.get(id);
      if (!bg) return { ok: false, output: `No background process with id '${id}'.` };
      if (bg.exited) return { ok: false, output: `Process ${id} has already exited.` };
      try {
        bg.proc.stdin?.write(input);
        return { ok: true, output: `Sent ${input.length} bytes to process ${id}.` };
      } catch (e: unknown) {
        return { ok: false, output: `Failed to write to process ${id}: ${(e as Error).message}` };
      }
    },
  },
  "shell.customRun": {
    description: "Define a named series of shell commands and persist them as a skill. Args: { name, commands, overwrite? }",
    fn: async (args) => {
      const name = String(args.name ?? "").trim();
      if (!name) return { ok: false, output: "customRun requires a name." };
      const commands = Array.isArray(args.commands) ? (args.commands as string[]).map(String) : [];
      if (commands.length === 0) return { ok: false, output: "customRun requires at least one command." };
      const safeId = name.replace(/[^a-zA-Z0-9_.-]/g, "_");
      if (!safeId) return { ok: false, output: "customRun name must contain at least one alphanumeric character." };
      const dir = getSkillsDir();
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${safeId}.json`);
      let existing: { createdAt: number } | undefined;
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        existing = JSON.parse(raw);
      } catch {}
      if (existing && !args.overwrite) return { ok: false, output: `Skill '${name}' already exists. Use overwrite:true to replace it, or use shell.editCustomRun to update it.` };
      const skill = { id: safeId, name, commands, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() };
      await fs.writeFile(filePath, JSON.stringify(skill, null, 2), "utf-8");
      const cmdList = commands.map((c, i) => `  ${i + 1}. ${c}`).join("\n");
      return { ok: true, output: `Created custom run '${name}' (id: ${safeId}) with ${commands.length} command(s):\n${cmdList}` };
    },
  },
  "shell.editCustomRun": {
    description: "Update a previously-defined custom run by ID. Args: { id, commands?, name? }",
    fn: async (args) => {
      const id = String(args.id ?? "").trim();
      if (!id) return { ok: false, output: "editCustomRun requires an id." };
      const dir = getSkillsDir();
      const filePath = path.join(dir, `${id}.json`);
      let skill: { id: string; name: string; commands: string[]; createdAt: number; updatedAt: number };
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        skill = JSON.parse(raw);
      } catch {
        return { ok: false, output: `No custom run found with id '${id}'.` };
      }
      if (args.name !== undefined) skill.name = String(args.name).trim() || skill.name;
      if (args.commands !== undefined) {
        const cmds = Array.isArray(args.commands) ? (args.commands as string[]).map(String) : [];
        if (cmds.length === 0) return { ok: false, output: "commands must be a non-empty array." };
        skill.commands = cmds;
      }
      skill.updatedAt = Date.now();
      await fs.writeFile(filePath, JSON.stringify(skill, null, 2), "utf-8");
      const cmdList = skill.commands.map((c, i) => `  ${i + 1}. ${c}`).join("\n");
      return { ok: true, output: `Updated custom run '${skill.name}' (id: ${id}) with ${skill.commands.length} command(s):\n${cmdList}` };
    },
  },
  "shell.runCustomRun": {
    description: "Execute a previously-defined custom run by id or name. Executes each command sequentially in the workspace. Args: { id, cwd? }",
    fn: async (args, ctx) => {
      const id = String(args.id ?? "").trim();
      if (!id) return { ok: false, output: "runCustomRun requires an id." };
      const dir = getSkillsDir();
      const filePath = path.join(dir, `${id}.json`);
      let skill: { name: string; commands: string[] };
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        skill = JSON.parse(raw);
      } catch {
        return { ok: false, output: `No custom run found with id '${id}'.` };
      }
      if (!skill.commands || skill.commands.length === 0) {
        return { ok: false, output: `Custom run '${skill.name}' has no commands.` };
      }
      const cwd = (args.cwd ? String(args.cwd) : ctx.workspacePath) || ctx.root;
      const onChunk = ctx.onChunk;
      const results: string[] = [];
      let allOk = true;
      for (let i = 0; i < skill.commands.length; i++) {
        const cmd = skill.commands[i];
        const label = `[${i + 1}/${skill.commands.length}] ${cmd}`;
        const result = await runSingleCommand(cmd, cwd, ctx, onChunk);
        const entry = result.ok ? `${label}\n${result.output}` : `${label}\nFAILED: ${result.output}`;
        results.push(entry);
        if (!result.ok) allOk = false;
      }
      return { ok: allOk, output: `Ran custom run '${skill.name}':\n\n${results.join("\n\n")}` };
    },
  },
  "test.run": {
    description: "Run tests in the workspace. Auto-detects vitest, jest, mocha, pytest, or go test. Args: { scope?, path? } where scope is 'file'|'nearest'|'workspace'|'failed'.",
    fn: async (args, ctx) => {
      const scope = String(args.scope ?? "workspace");
      const testPath = args.path ? String(args.path) : "";
      let cmd = "";
      try {
        const pkgRaw = await fs.readFile(path.join(ctx.workspacePath, "package.json"), "utf-8");
        const pkg = JSON.parse(pkgRaw);
        if (pkg.scripts?.test) cmd = "pnpm test";
        else if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) cmd = "npx vitest run";
        else if (pkg.devDependencies?.jest || pkg.dependencies?.jest) cmd = "npx jest";
        else if (pkg.devDependencies?.mocha || pkg.dependencies?.mocha) cmd = "npx mocha";
      } catch {}
      if (!cmd) {
        try { await fs.access(path.join(ctx.workspacePath, "go.mod")); cmd = "go test ./..."; } catch {}
      }
      if (!cmd) {
        try {
          const pyFiles = await fs.readdir(ctx.workspacePath);
          if (pyFiles.some((f) => f.startsWith("test_") && f.endsWith(".py"))) cmd = "python -m pytest";
        } catch {}
      }
      if (!cmd) return { ok: false, output: "No test runner detected. Add a test script to package.json." };
      if (scope === "file" && testPath) cmd = `${cmd} -- "${testPath}"`;
      else if (scope === "failed" && (cmd.includes("vitest") || cmd.includes("jest"))) cmd = `${cmd} --last-failed`;
      const testProxyEnv = shellEnv(ctx.proxyShell || ctx.proxyUrl);
      const execOpts: Record<string, unknown> = { cwd: ctx.workspacePath, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: EXEC_SHELL };
      if (testProxyEnv) execOpts.env = { ...process.env, ...testProxyEnv };
      try {
        const { stdout, stderr } = await pexec(cmd, execOpts);
        return { ok: true, output: stdout + (stderr ? `\n[stderr]\n${stderr}` : "") };
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        return { ok: false, output: (err.stdout ?? "") + (err.stderr ? `\n[stderr]\n${err.stderr}` : "") || err.message || "Tests failed." };
      }
    },
  },
  "lsp.problems": {
    description: "Get ALL current LSP problems in the workspace (snapshot of the Problems tab). Args: {}",
    fn: async (_args, ctx) => {
      if (!ctx.problems) return { ok: false, output: "LSP problems not available in this environment." };
      const list = await ctx.problems();
      if (list.length === 0) return { ok: true, output: "No problems in the workspace." };
      return { ok: true, output: list.map((d) => `[${d.severity}] ${d.file}:${d.line}:${d.column}  ${d.message}${d.source ? `  (${d.source})` : ""}`).join("\n") };
    },
  },
  "lsp.problemsFor": {
    description: "Get LSP problems for one file. Args: { path }",
    fn: async (args, ctx) => {
      if (!ctx.problemsFor) return { ok: false, output: "LSP problems not available." };
      const list = await ctx.problemsFor(String(args.path));
      if (list.length === 0) return { ok: true, output: `No problems in ${args.path}.` };
      return { ok: true, output: list.map((d) => `[${d.severity}] ${d.file}:${d.line}:${d.column}  ${d.message}`).join("\n") };
    },
  },
  "todo.write": {
    description: "Set the live todo list. Args: { items: [{ id, text, state }] }",
    fn: async (args) => {
      const items = Array.isArray(args.items) ? (args.items as { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" }[]) : [];
      return { ok: true, output: `Todo list updated (${items.length} items).`, todoState: { items } };
    },
  },
  "browser.navigate": { description: "Navigate the browser. Args: { url }", fn: async (a, ctx) => { const b = await resolveBrowser(ctx.browser); return b ? b.navigate(String(a.url)) : { ok: false, output: "Browser not available." }; } },
  "browser.click": { description: "Click a selector. Args: { selector }", fn: async (a, ctx) => { const b = await resolveBrowser(ctx.browser); return b ? b.click(String(a.selector)) : { ok: false, output: "Browser not available." }; } },
  "browser.type": { description: "Type into a selector. Args: { selector, text }", fn: async (a, ctx) => { const b = await resolveBrowser(ctx.browser); return b ? b.type(String(a.selector), String(a.text)) : { ok: false, output: "Browser not available." }; } },
  "browser.screenshot": { description: "Take a screenshot. Args: { path? }", fn: async (a, ctx) => { const b = await resolveBrowser(ctx.browser); return b ? b.screenshot(a.path ? String(a.path) : undefined) : { ok: false, output: "Browser not available." }; } },
  "browser.evaluate": { description: "Run JS in the page. Args: { script }", fn: async (a, ctx) => { const b = await resolveBrowser(ctx.browser); return b ? b.evaluate(String(a.script)) : { ok: false, output: "Browser not available." }; } },
  "browser.readDom": { description: "Read the page's accessibility tree. Args: {} ", fn: async (_a, ctx) => { const b = await resolveBrowser(ctx.browser); return b ? b.readDom() : { ok: false, output: "Browser not available." }; } },
  "browser.close": { description: "Close the browser. Args: {}", fn: async (_a, ctx) => { const b = await resolveBrowser(ctx.browser); if (b) await b.close(); return { ok: true, output: "Browser closed." }; } },
  "web.fetch": {
    description: "Fetch raw text content from a web URL. Args: { url }",
    fn: async (args, ctx) => {
      try {
        const url = String(args.url);
        const webProxy = ctx.proxyWeb || ctx.proxyUrl;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          ...(webProxy ? { dispatcher: makeProxyDispatcher(webProxy) } : {}),
        });
        if (!res.ok) return { ok: false, output: `HTTP ${res.status}: ${res.statusText}` };
        const text = await res.text();
        return { ok: true, output: text };
      } catch (e: unknown) {
        return { ok: false, output: `Fetch failed: ${(e as Error).message}` };
      }
    },
  },
  "web.search": {
    description: "Search the web via DuckDuckGo. Args: { query, count? }",
    fn: async (args, ctx) => {
      try {
        const rawQuery = String(args.query ?? "");
        const count = Math.min(args.count ? Number(args.count) : 10, 20);
        const dispatcher = ctx.proxyWeb || ctx.proxyUrl ? makeProxyDispatcher(ctx.proxyWeb || ctx.proxyUrl!) : undefined;
        const results = await ddgSearch(rawQuery, count, dispatcher);
        const out = results.length > 0
          ? results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`).join("\n\n")
          : "No results found (CAPTCHA or rate limit may have been triggered). Try a more specific query.";
        return { ok: true, output: out };
      } catch (e: unknown) {
        return { ok: false, output: `Search failed: ${(e as Error).message}` };
      }
    },
  },
  "file.semanticSearch": {
    description: "Semantic search across the workspace via the local embedding index. Args: { query, k? }",
    fn: async (args, ctx) => {
      if (!ctx.semanticSearch) return { ok: false, output: "Semantic search index is not available in this environment." };
      const query = String(args.query ?? "");
      if (!query) return { ok: false, output: "No query provided." };
      const k = args.k ? Number(args.k) : 10;
      try {
        const hits = await ctx.semanticSearch(query, k);
        if (hits.length === 0) return { ok: true, output: `No semantic matches for '${query}'.` };
        const out = hits.map((h) => `${h.file} [${h.start}-${h.end}] score=${h.score.toFixed(3)}: ${h.snippet.replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
        return { ok: true, output: out };
      } catch (e: unknown) {
        return { ok: false, output: `Semantic search failed: ${(e as Error).message}` };
      }
    },
  },
  "mcp.call": {
    description: "Call a tool exposed by an MCP server. Args: { server, tool, args }",
    fn: async (a, ctx) => {
      if (!ctx.mcp) return { ok: false, output: "MCP not available." };
      const r = await ctx.mcp.call(String(a.server), String(a.tool), (a.args as Record<string, unknown>) ?? {});
      return { ok: r.ok, output: typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2) };
    },
  },
  "mcp.create": {
    description: "Define and register a new MCP server at runtime. Args: { name, transport: { type, command|url, ... }, enabled? }",
    fn: async (a, ctx) => {
      if (!ctx.mcp) return { ok: false, output: "MCP not available." };
      const name = String(a.name ?? "").trim();
      if (!name) return { ok: false, output: "Server name is required." };
      const transport = a.transport as { type?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> } | undefined;
      if (!transport || !transport.type) return { ok: false, output: "transport.type is required ('stdio' or 'http')." };
      let normalized: import("../mcp/client.js").McpTransport;
      if (transport.type === "stdio") {
        const cmd = String(transport.command ?? "").trim();
        if (!cmd) return { ok: false, output: "stdio transport requires 'command'." };
        normalized = { type: "stdio", command: cmd, args: Array.isArray(transport.args) ? transport.args.map(String) : undefined, env: transport.env };
      } else if (transport.type === "http") {
        const url = String(transport.url ?? "").trim();
        if (!url) return { ok: false, output: "http transport requires 'url'." };
        normalized = { type: "http", url, headers: transport.headers };
      } else {
        return { ok: false, output: `Unknown transport type '${transport.type}'.` };
      }
      const enabled = a.enabled === undefined ? true : !!a.enabled;
      try {
        await ctx.mcp.addServer({ name, enabled, transport: normalized });
        const srv = ctx.mcp.listServers().find((s) => s.name === name);
        const toolList = (srv?.tools ?? []).map((t) => `${t.name}${t.description ? ` — ${t.description}` : ""}`).join("\n");
        return {
          ok: true,
          output: `Registered MCP server '${name}' (${normalized.type}). Tools:\n${toolList || "(none discovered yet)"}`,
        };
      } catch (e) {
        return { ok: false, output: `Failed to register server: ${(e as Error).message}` };
      }
    },
  },
  "mcp.remove": {
    description: "Remove a registered MCP server. Args: { name }",
    fn: async (a, ctx) => {
      if (!ctx.mcp) return { ok: false, output: "MCP not available." };
      const name = String(a.name ?? "");
      await ctx.mcp.removeServer(name);
      return { ok: true, output: `Removed MCP server '${name}'.` };
    },
  },
  "mcp.toggle": {
    description: "Enable or disable an MCP server. Args: { name, enabled }",
    fn: async (a, ctx) => {
      if (!ctx.mcp) return { ok: false, output: "MCP not available." };
      const name = String(a.name ?? "");
      const enabled = !!a.enabled;
      await ctx.mcp.enableServer(name, enabled);
      return { ok: true, output: `MCP server '${name}' ${enabled ? "enabled" : "disabled"}.` };
    },
  },
  "mcp.resources/list": {
    description: "List resources on an MCP server. Args: { server }",
    fn: async (a, ctx) => {
      if (!ctx.mcp) return { ok: false, output: "MCP not available." };
      const server = String(a.server ?? "");
      const list = ctx.mcp.listResources().filter((r) => r.server === server);
      if (list.length === 0) return { ok: true, output: `No resources on server '${server}'.` };
      return { ok: true, output: list.map((r) => `${r.uri}${r.name ? ` — ${r.name}` : ""}${r.mimeType ? ` (${r.mimeType})` : ""}`).join("\n") };
    },
  },
  "mcp.resources/read": {
    description: "Read a resource URI. Args: { server, uri }",
    fn: async (a, ctx) => {
      if (!ctx.mcp) return { ok: false, output: "MCP not available." };
      const r = await ctx.mcp.readResource(String(a.server), String(a.uri));
      return { ok: r.ok, output: typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2) ?? String(r.output) };
    },
  },
  "mcp.prompts/list": {
    description: "List prompt templates on an MCP server. Args: { server }",
    fn: async (a, ctx) => {
      if (!ctx.mcp) return { ok: false, output: "MCP not available." };
      const server = String(a.server ?? "");
      const list = ctx.mcp.listPrompts().filter((p) => p.server === server);
      if (list.length === 0) return { ok: true, output: `No prompts on server '${server}'.` };
      return { ok: true, output: list.map((p) => `${p.name}${p.description ? ` — ${p.description}` : ""}`).join("\n") };
    },
  },
  "mcp.prompts/get": {
    description: "Fetch a prompt template. Args: { server, name, args? }",
    fn: async (a, ctx) => {
      if (!ctx.mcp) return { ok: false, output: "MCP not available." };
      const r = await ctx.mcp.getPrompt(String(a.server), String(a.name), (a.args as Record<string, unknown>) ?? undefined);
      return { ok: r.ok, output: typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2) ?? String(r.output) };
    },
  },
  "skill.read": {
    description: "Read a skill's full SKILL.md body by name. Args: { name }",
    fn: async (args, ctx) => {
      if (!ctx.skillRegistry) return { ok: false, output: "Skill registry not available." };
      const name = String(args.name ?? "");
      if (!name) return { ok: false, output: "Skill name required." };
      const meta = ctx.skillRegistry.get(name);
      if (!meta) return { ok: false, output: `Skill '${name}' not found. Available: ${ctx.skillRegistry.list().map((s) => s.name).join(", ")}` };
      const body = await ctx.skillRegistry.readBody(name);
      return { ok: true, output: body ?? "(empty skill)" };
    },
  },
  "memory.list": {
    description: "List stored memories. Args: { limit? }",
    fn: async (args, ctx) => {
      const { loadMemory } = await import("../memory/store.js");
      const entries = await loadMemory(ctx.root);
      const limit = args.limit ? Number(args.limit) : 20;
      const slice = entries.slice(-limit);
      if (!slice.length) return { ok: true, output: "No memories stored." };
      return { ok: true, output: slice.map((e, i) => `${entries.length - slice.length + i}. [${e.category}] ${e.content} (${e.createdAt})`).join("\n") };
    },
  },
  "memory.edit": {
    description: "Edit a memory by index. Args: { index, content }",
    fn: async (args, ctx) => {
      const { editMemory } = await import("../memory/store.js");
      const idx = Number(args.index ?? -1);
      const content = String(args.content ?? "");
      const ok = await editMemory(ctx.root, idx, content);
      return ok ? { ok: true, output: `Memory ${idx} updated.` } : { ok: false, output: `Invalid index ${idx}.` };
    },
  },
  "memory.delete": {
    description: "Delete a memory by index. Args: { index }",
    fn: async (args, ctx) => {
      const { deleteMemory } = await import("../memory/store.js");
      const idx = Number(args.index ?? -1);
      const ok = await deleteMemory(ctx.root, idx);
      return ok ? { ok: true, output: `Memory ${idx} deleted.` } : { ok: false, output: `Invalid index ${idx}.` };
    },
  },
  "rule.list": {
    description: "List available rules. Args: {}",
    fn: async (_args, ctx) => {
      if (!ctx.ruleRegistry) return { ok: false, output: "Rule registry not available." };
      const rules = ctx.ruleRegistry.list();
      if (!rules.length) return { ok: true, output: "No rules configured." };
      return { ok: true, output: rules.map((r) => `- **${r.name}** (${r.scope}): ${r.description} [glob: ${r.glob ?? "*"}]`).join("\n") };
    },
  },
  "rule.read": {
    description: "Read a rule's full body by name. Args: { name }",
    fn: async (args, ctx) => {
      if (!ctx.ruleRegistry) return { ok: false, output: "Rule registry not available." };
      const rule = ctx.ruleRegistry.get(String(args.name ?? ""));
      if (!rule) return { ok: false, output: `Rule not found. Available: ${ctx.ruleRegistry.list().map((r) => r.name).join(", ")}` };
      return { ok: true, output: `# ${rule.name}\n\n**Glob:** ${rule.glob ?? "*"}\n**Scope:** ${rule.scope}\n\n${rule.body}` };
    },
  },
  "rule.create": {
    description: "Create a new rule. Args: { name, glob, description, body }",
    fn: async (args, ctx) => {
      if (!ctx.ruleRegistry) return { ok: false, output: "Rule registry not available." };
      const name = String(args.name ?? "").trim();
      if (!name) return { ok: false, output: "Rule name required." };
      await ctx.ruleRegistry.create(name, String(args.glob ?? "*"), String(args.description ?? ""), String(args.body ?? ""));
      return { ok: true, output: `Rule '${name}' created.` };
    },
  },
  "git.diffStaged": {
    description: "Show the staged diff (git diff --cached). Args: { path? } to scope to a single file.",
    fn: async (args, ctx) => {
      try {
        const scope = args.path ? ` -- "${String(args.path)}"` : "";
        const { stdout, stderr } = await pexec(`git diff --cached${scope}`, { cwd: ctx.workspacePath, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: EXEC_SHELL });
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
        return { ok: true, output: output || "(no staged changes)" };
      } catch (e: unknown) {
        return { ok: false, output: `git diffStaged failed: ${(e as Error).message}` };
      }
    },
  },
  "git.diffUnstaged": {
    description: "Show the unstaged diff (git diff). Args: { path? } to scope to a single file.",
    fn: async (args, ctx) => {
      try {
        const scope = args.path ? ` -- "${String(args.path)}"` : "";
        const { stdout, stderr } = await pexec(`git diff${scope}`, { cwd: ctx.workspacePath, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: EXEC_SHELL });
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
        return { ok: true, output: output || "(no unstaged changes)" };
      } catch (e: unknown) {
        return { ok: false, output: `git diffUnstaged failed: ${(e as Error).message}` };
      }
    },
  },
  "git.changedFiles": {
    description: "List all changed files (staged and unstaged) with status. Args: {}",
    fn: async (_args, ctx) => {
      try {
        const { stdout } = await pexec("git status --porcelain", { cwd: ctx.workspacePath, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: EXEC_SHELL });
        if (!stdout.trim()) return { ok: true, output: "(no changed files)" };
        const lines = stdout.trim().split("\n").map((l) => {
          const m = l.match(/^(..) (.+)$/);
          if (!m) return l;
          const status = m[1].trim();
          const file = m[2].trim();
          const staged = status.length > 0 && status !== "??";
          return `${status || " "} ${file} ${staged ? "(staged)" : "(unstaged)"}`;
        });
        return { ok: true, output: lines.join("\n") };
      } catch (e: unknown) {
        return { ok: false, output: `git changedFiles failed: ${(e as Error).message}` };
      }
    },
  },
  "git.branchDiff": {
    description: "Show the diff between the current branch and its merge base with a target branch (defaults to main/master). Args: { base? }",
    fn: async (args, ctx) => {
      try {
        const base = String(args.base ?? "main");
        const { stdout: mbOut } = await pexec(`git merge-base HEAD "${base}"`, { cwd: ctx.workspacePath, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: EXEC_SHELL }).catch(() => ({ stdout: "" }));
        const mergeBase = mbOut.trim();
        const target = mergeBase || base;
        const { stdout, stderr } = await pexec(`git diff "${target}"...HEAD`, { cwd: ctx.workspacePath, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: EXEC_SHELL });
        const output = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
        return { ok: true, output: output || "(no differences from base)" };
      } catch (e: unknown) {
        return { ok: false, output: `git branchDiff failed: ${(e as Error).message}` };
      }
    },
  },
  "git.commitMessage": {
    description: "Generate a well-formed commit message from a diff. Pass the diff as `diff` input, or omit to use the current staged diff. Args: { diff? }",
    fn: async (args, ctx) => {
      const diff = args.diff ? String(args.diff) : "";
      if (!diff) {
        try {
          const { stdout } = await pexec("git diff --cached", { cwd: ctx.workspacePath, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: EXEC_SHELL });
          if (!stdout.trim()) return { ok: true, output: "(no staged changes to generate a commit message from)" };
          return { ok: true, output: `Staged diff (use this as input to compose a commit message):\n${stdout}` };
        } catch (e: unknown) {
          return { ok: false, output: `Failed to read staged diff: ${(e as Error).message}` };
        }
      }
      return { ok: true, output: `Diff provided (${diff.length} chars). Use this to compose a conventional commit message:\n${diff}` };
    },
  },
  "browser.hover": {
    description: "Hover over an element matching a CSS selector.",
    fn: async (args, ctx) => {
      const b = await resolveBrowser(ctx.browser);
      if (!b) return { ok: false, output: "Browser not available." };
      return b.hover(String(args.selector ?? ""));
    },
  },
  "browser.scroll": {
    description: "Scroll the page by pixel offset or to a selector.",
    fn: async (args, ctx) => {
      const b = await resolveBrowser(ctx.browser);
      if (!b) return { ok: false, output: "Browser not available." };
      return b.scroll(args.pixels ? Number(args.pixels) : undefined, args.selector ? String(args.selector) : undefined);
    },
  },
  "browser.waitFor": {
    description: "Wait for a selector, URL change, or network idle.",
    fn: async (args, ctx) => {
      const b = await resolveBrowser(ctx.browser);
      if (!b) return { ok: false, output: "Browser not available." };
      return b.waitFor(
        args.selector ? String(args.selector) : undefined,
        args.url ? String(args.url) : undefined,
        args.state ? String(args.state) as "networkidle" | "load" | "domcontentloaded" : undefined,
      );
    },
  },
  "browser.console": {
    description: "Read the browser's console log (last 50 entries). Args: {}",
    fn: async (_args, ctx) => {
      const b = await resolveBrowser(ctx.browser);
      if (!b) return { ok: false, output: "Browser not available." };
      const logs = b.consoleLog();
      return { ok: true, output: logs.length ? logs.join("\n") : "(no console output)" };
    },
  },
  "browser.network": {
    description: "Read the browser's network request log (last 50 entries). Args: {}",
    fn: async (_args, ctx) => {
      const b = await resolveBrowser(ctx.browser);
      if (!b) return { ok: false, output: "Browser not available." };
      const logs = b.networkLog();
      return { ok: true, output: logs.length ? logs.join("\n") : "(no network requests)" };
    },
  },
  "browser.domSnapshot": {
    description: "Get a combined snapshot of the browser's DOM state, console log, and network log. Args: {}",
    fn: async (_args, ctx) => {
      const b = await resolveBrowser(ctx.browser);
      if (!b) return { ok: false, output: "Browser not available." };
      return { ok: true, output: b.domSnapshot() || "(empty snapshot)" };
    },
  },
};
interface SearchResult { title: string; snippet: string; url: string; }
const STEALTH_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "DNT": "1",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};
const CAPTCHA_MARKERS = ["anomaly-modal", "not a robot", "g-recaptcha", "challenge-form", "not a bot"];
async function ddgSearch(query: string, max: number, proxyDispatcher: unknown): Promise<SearchResult[]> {
  const results = await ddgSearchLite(query, max, proxyDispatcher);
  if (results.length > 0) return results;
  return await ddgSearchHtml(query, max, proxyDispatcher);
}
async function ddgSearchLite(query: string, max: number, proxyDispatcher: unknown): Promise<SearchResult[]> {
  try {
    const formData = new URLSearchParams({ q: query, kl: "us-en" });
    const opts: Record<string, unknown> = {
      method: "POST",
      headers: { ...STEALTH_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
      signal: AbortSignal.timeout(15000),
    };
    if (proxyDispatcher) opts.dispatcher = proxyDispatcher;
    const res = await fetch("https://lite.duckduckgo.com/lite/", opts as RequestInit);
    if (!res.ok) return [];
    const html = await res.text();
    return parseLiteResults(html, max);
  } catch {
    return [];
  }
}
async function ddgSearchHtml(query: string, max: number, proxyDispatcher: unknown): Promise<SearchResult[]> {
  try {
    const params = new URLSearchParams({ q: query });
    const opts: Record<string, unknown> = { headers: STEALTH_HEADERS, signal: AbortSignal.timeout(15000) };
    if (proxyDispatcher) opts.dispatcher = proxyDispatcher;
    const res = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, opts as RequestInit);
    if (!res.ok) return [];
    const html = await res.text();
    if (hasCaptcha(html)) return [];
    return parseHtmlResults(html, max);
  } catch {
    return [];
  }
}
function hasCaptcha(html: string): boolean {
  return CAPTCHA_MARKERS.some((m) => html.toLowerCase().includes(m));
}
function extractUddgUrl(raw: string): string {
  const m = /uddg=([^"&]+)/.exec(raw);
  return m ? decodeURIComponent(m[1]) : raw;
}
function decodeHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#\d+;/g, "").trim();
}
function parseLiteResults(html: string, max: number): SearchResult[] {
  if (hasCaptcha(html)) return [];
  const results: SearchResult[] = [];
  const linkRe = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class='?result-link'?[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td[^>]*class='?result-snippet'?[^>]*>([\s\S]*?)<\/td>/gi;
  const links = [...html.matchAll(linkRe)];
  const snippets = [...html.matchAll(snippetRe)];
  for (let i = 0; i < Math.min(links.length, max); i++) {
    const href = links[i][1] ?? "";
    const title = decodeHtml(links[i][2] ?? "");
    const snippet = i < snippets.length ? decodeHtml(snippets[i][1] ?? "") : "";
    if (title && href) results.push({ title, snippet, url: href });
  }
  return results;
}
function parseHtmlResults(html: string, max: number): SearchResult[] {
  if (hasCaptcha(html) || !html.includes("result__body")) return [];
  const results: SearchResult[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < max) {
    const rawHref = m[1] ?? "";
    const title = decodeHtml(m[2] ?? "");
    const snippet = decodeHtml(m[3] ?? "");
    const url = extractUddgUrl(rawHref);
    if (title && url && !url.startsWith("//duckduckgo.com") && !url.startsWith("/")) {
      results.push({ title, snippet, url });
    }
  }
  return results;
}
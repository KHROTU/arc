import { exec, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FileEditor } from "../edit/editor.js";
import { getSkillsDir } from "../arc-dir.js";
import { runPreWriteHooks, runPostEditHooks } from "../hooks/hooks.js";
import type { DiffHunk } from "../protocol/process.js";
const pexec = promisify(exec);
const IS_WIN = process.platform === "win32";
const SHELL = IS_WIN ? "pwsh.exe" : true;
const EXEC_SHELL: string | undefined = IS_WIN ? "pwsh.exe" : undefined;
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
  ctx: ToolContext,
  onChunk?: (stream: "stdout" | "stderr", text: string) => void,
): Promise<{ ok: boolean; output: string }> {
  const baseCmd = cmd.trim().split(/\s+/)[0] || "";
  const blocked = ctx.shell.policy === "off"
    ? true
    : ctx.shell.policy === "allowlist" && !ctx.shell.allowlist.includes(baseCmd);
  if (blocked) {
    if (!ctx.requestApproval) return { ok: false, output: `Shell command '${baseCmd}' not in allowlist and no approval handler set.` };
    const ok = await ctx.requestApproval(`Run custom run command?\n\n${cmd}`);
    if (!ok) return { ok: false, output: "Denied by user." };
  }
  return new Promise((resolve) => {
    const proc = spawn(cmd, { cwd, shell: SHELL, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
export interface ToolContext {
  root: string;
  shell: { policy: "always" | "allowlist" | "off"; allowlist: string[] };
  requestApproval?: (description: string) => Promise<boolean>;
  problems?: () => Promise<import("../lsp/bridge.js").DiagnosticLite[]>;
  problemsFor?: (file: string) => Promise<import("../lsp/bridge.js").DiagnosticLite[]>;
  summaryForFiles?: (files: string[]) => Promise<{ hasErrors: boolean; hasWarnings: boolean; text: string }>;
  grep?: (pattern: string, include?: string) => Promise<{ file: string; line: number; column: number; text: string }[]>;
  glob?: (pattern: string) => Promise<string[]>;
  browser?: import("../browser/browser.js").BrowserAdapter | (() => Promise<import("../browser/browser.js").BrowserAdapter>);
  mcp?: import("../mcp/mcp.js").McpAggregator;
  workspacePath: string;
  onChunk?: (stream: "stdout" | "stderr", text: string) => void;
  semanticSearch?: (query: string, k?: number) => Promise<{ file: string; start: number; end: number; score: number; snippet: string }[]>;
}
export interface ToolResult {
  ok: boolean;
  output: string;
  touchedFiles?: string[];
  todoState?: { items: { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" }[] };
  clarification?: { id: string; answer: string };
  diffHunks?: DiffHunk[];
  filePath?: string;
  runAfter?: { command: string; output: string };
}
export type ToolFn = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
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
      await runPreWriteHooks(filePath, replace);
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
      await runPreWriteHooks(filePath, content);
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
    description: "Run a shell command. Args: { command, cwd?, timeout? }",
    fn: async (args, ctx) => {
      const cmd = String(args.command);
      const baseCmd = cmd.trim().split(/\s+/)[0] || "";
      const blocked = ctx.shell.policy === "off"
        ? true
        : ctx.shell.policy === "allowlist" && !ctx.shell.allowlist.includes(baseCmd);
      if (blocked) {
        if (!ctx.requestApproval) return { ok: false, output: `Shell command '${baseCmd}' not in allowlist and no approval handler set.` };
        const ok = await ctx.requestApproval(`Run shell command?\n\n${cmd}`);
        if (!ok) return { ok: false, output: "Denied by user." };
      }
      const timeoutSec = args.timeout ? Number(args.timeout) : -1;
      const cwd = (args.cwd ? String(args.cwd) : ctx.root) || ctx.root;
      const onChunk = ctx.onChunk;
      return new Promise<ToolResult>((resolve) => {
        const proc = spawn(cmd, { cwd, shell: SHELL, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
    description: "Launch a background shell process. Args: { command, cwd? }",
    fn: async (args, ctx) => {
      const cmd = String(args.command);
      const baseCmd = cmd.trim().split(/\s+/)[0] || "";
      const blocked = ctx.shell.policy === "off"
        ? true
        : ctx.shell.policy === "allowlist" && !ctx.shell.allowlist.includes(baseCmd);
      if (blocked) {
        if (!ctx.requestApproval) return { ok: false, output: `Shell command '${baseCmd}' not in allowlist and no approval handler set.` };
        const ok = await ctx.requestApproval(`Run background shell command?\n\n${cmd}`);
        if (!ok) return { ok: false, output: "Denied by user." };
      }
      const cwd = (args.cwd ? String(args.cwd) : ctx.root) || ctx.root;
      try {
        const proc = spawn(cmd, { cwd, shell: SHELL, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
        proc.on("exit", (code) => { bg.exited = true; bg.exitCode = code ?? undefined; activeProcesses.delete(proc); });
        proc.on("error", (err) => { bg.exited = true; bg.stderr += `\n[spawn error] ${err.message}`; activeProcesses.delete(proc); });
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
  "webfetch": {
    description: "Fetch raw text content from a web URL. Args: { url }",
    fn: async (args) => {
      try {
        const url = String(args.url);
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return { ok: false, output: `HTTP ${res.status}: ${res.statusText}` };
        const text = await res.text();
        return { ok: true, output: text };
      } catch (e: unknown) {
        return { ok: false, output: `Fetch failed: ${(e as Error).message}` };
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
      return { ok: r.ok, output: typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2) };
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
      return { ok: r.ok, output: typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2) };
    },
  },
};
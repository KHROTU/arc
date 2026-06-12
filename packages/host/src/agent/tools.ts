import { FileEditor } from "../edit/editor.js";
export interface ToolContext {
  root: string;
  shell: { policy: "always" | "allowlist" | "off"; allowlist: string[] };
  requestApproval?: (description: string) => Promise<boolean>;
  problems?: () => Promise<import("../lsp/bridge.js").DiagnosticLite[]>;
  problemsFor?: (file: string) => Promise<import("../lsp/bridge.js").DiagnosticLite[]>;
  summaryForFiles?: (files: string[]) => Promise<{ hasErrors: boolean; hasWarnings: boolean; text: string }>;
  browser?: import("../browser/browser.js").BrowserAdapter;
  mcp?: import("../mcp/mcp.js").McpAggregator;
  workspacePath: string;
}
export interface ToolResult {
  ok: boolean;
  output: string;
  touchedFiles?: string[];
  todoState?: { items: { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" }[] };
  clarification?: { id: string; answer: string };
}
export type ToolFn = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
export const tools: Record<string, { description: string; fn: ToolFn }> = {
  "file.read": {
    description: "Read a file from the workspace. Args: { path }",
    fn: async (args, ctx) => {
      const ed = new FileEditor(ctx.root);
      const body = await ed.read(String(args.path));
      return { ok: true, output: body };
    },
  },
  "file.edit": {
    description: "Apply a search/replace edit. Args: { path, search, replace, replaceAll? }",
    fn: async (args, ctx) => {
      const ed = new FileEditor(ctx.root);
      const r = await ed.apply(String(args.path), String(args.search), String(args.replace), { replaceAll: !!args.replaceAll });
      return { ok: r.ok, output: r.ok ? `Edited ${args.path} (${r.strategy}, ${r.matches} match${r.matches === 1 ? "" : "es"})` : `Error: ${r.error}`, touchedFiles: r.ok ? [String(args.path)] : [] };
    },
  },
  "file.write": {
    description: "Write a new file (or overwrite). Args: { path, content }",
    fn: async (args, ctx) => {
      const ed = new FileEditor(ctx.root);
      const r = await ed.apply(String(args.path), "", String(args.content));
      void r;
      return { ok: true, output: `Wrote ${args.path}`, touchedFiles: [String(args.path)] };
    },
  },
  "shell.run": {
    description: "Run a shell command. Args: { command, cwd? }",
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
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const pexec = promisify(exec);
      try {
        const cwd = (args.cwd ? String(args.cwd) : ctx.root) || ctx.root;
        const { stdout, stderr } = await pexec(cmd, { cwd, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
        return { ok: true, output: (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(0, 8000) };
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        return { ok: false, output: `${err.message ?? e}\n${err.stdout ?? ""}${err.stderr ? `\n[stderr]\n${err.stderr}` : ""}`.slice(0, 8000) };
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
  "browser.navigate": { description: "Navigate the browser. Args: { url }", fn: async (a, ctx) => (await ctx.browser?.navigate(String(a.url))) ?? { ok: false, output: "Browser not available." } },
  "browser.click": { description: "Click a selector. Args: { selector }", fn: async (a, ctx) => (await ctx.browser?.click(String(a.selector))) ?? { ok: false, output: "Browser not available." } },
  "browser.type": { description: "Type into a selector. Args: { selector, text }", fn: async (a, ctx) => (await ctx.browser?.type(String(a.selector), String(a.text))) ?? { ok: false, output: "Browser not available." } },
  "browser.screenshot": { description: "Take a screenshot. Args: { path? }", fn: async (a, ctx) => (await ctx.browser?.screenshot(a.path ? String(a.path) : undefined)) ?? { ok: false, output: "Browser not available." } },
  "browser.evaluate": { description: "Run JS in the page. Args: { script }", fn: async (a, ctx) => (await ctx.browser?.evaluate(String(a.script))) ?? { ok: false, output: "Browser not available." } },
  "browser.readDom": { description: "Read the page's accessibility tree. Args: {} ", fn: async (_a, ctx) => (await ctx.browser?.readDom()) ?? { ok: false, output: "Browser not available." } },
  "browser.close": { description: "Close the browser. Args: {}", fn: async (_a, ctx) => { await ctx.browser?.close(); return { ok: true, output: "Browser closed." }; } },
  "mcp.call": {
    description: "Call a tool exposed by an MCP server. Args: { server, tool, args }",
    fn: async (a, ctx) => {
      if (!ctx.mcp) return { ok: false, output: "MCP not available." };
      const r = await ctx.mcp.call(String(a.server), String(a.tool), (a.args as Record<string, unknown>) ?? {});
      return { ok: r.ok, output: typeof r.output === "string" ? r.output : JSON.stringify(r.output, null, 2) };
    },
  },
};
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  ModelRegistry, Agent, CheckpointStore, LspBridge, McpAggregator,
  makeVSCodeNotifier, setNotifier,   loadWorkspacePrompts, loadGlobalPrompts, mergePrecedence, render, injectRelevantRules,
  pickLogo, ChatHistory, createBrowser, getWorkspaceArcDir,
  ModeRegistry, DEFAULT_APPROVALS, loadApprovalsMemory, saveApprovalPrefix,
  SkillRegistry,
  RuleRegistry, loadMemory, deleteMemory,
  type ChatSnapshot, type ChatMessage, type BrowserAdapter,
  type HostMsg, type WebviewMsg, type ModelDescriptor, type ProviderConfig, type ProcessStep, type ApprovalsConfig,
  Indexer, HashEmbeddingBackend, OllamaEmbeddingBackend, DEFAULT_EMBEDDING_MODELS,
  type IndexProgress, type EmbeddingBackend,
} from "@arc/host";
const SECRET_PREFIX = "arc.apiKey.";
let log: vscode.OutputChannel;
let ctxRef: vscode.ExtensionContext;
let registry: ModelRegistry;
let store: CheckpointStore;
let lsp: LspBridge;
let mcp: McpAggregator;
let modeRegistry: ModeRegistry;
let skillRegistry: SkillRegistry;
let skillRegistryReady: Promise<void>;
let ruleRegistry: RuleRegistry;
let persist: () => void;
let persistAsync: () => Promise<void>;
let chatsFilePath: string;
let chatHistory: ChatHistory;
let initResolve: (() => void) | undefined;
const initReady = new Promise<void>((r) => { initResolve = r; });
type Session = { id: string; panel?: vscode.WebviewPanel; view?: vscode.WebviewView; agent: Agent; agentReady?: Promise<Agent | undefined>; steps: ProcessStep[]; messages: import("@arc/host").ChatMessage[]; };
const sidebarSession: Session = { id: "sidebar", agent: undefined as unknown as Agent, steps: [], messages: [] };
const fullscreenSessions = new Map<string, Session>();
const chatSessions = new Map<string, Session>();
const chatTotals = new Map<string, { cost: number; promptTokens: number; completionTokens: number; window: number }>();
const pendingApprovals = new Map<string, { resolve: (allowed: boolean) => void; session: Session }>();
let approvalId = 0;
let browser: BrowserAdapter | undefined;
let browserPromise: Promise<BrowserAdapter> | undefined;
let searchIndexer: Indexer | undefined;
let searchProgress: IndexProgress = { filesScanned: 0, filesIndexed: 0, chunksEmbedded: 0, errors: 0 };
let searchAbort: AbortController | undefined;
let approvalsConfig: ApprovalsConfig = { ...DEFAULT_APPROVALS };
function getBrowser(): Promise<BrowserAdapter> {
  if (browser) return Promise.resolve(browser);
  if (!browserPromise) {
    browserPromise = createBrowser("chromium", true).then((b) => {
      browser = b;
      return b;
    });
  }
  return browserPromise;
}
export function activate(context: vscode.ExtensionContext) {
  ctxRef = context;
  log = vscode.window.createOutputChannel("Arc");
  context.subscriptions.push(log);
  modeRegistry = new ModeRegistry(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  void modeRegistry.load().catch((err) => {
    log.appendLine(`[arc] Mode registry load failed: ${(err as Error)?.stack ?? err}`);
  });
  skillRegistry = new SkillRegistry(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  skillRegistryReady = skillRegistry.load().catch((err) => {
    log.appendLine(`[arc] Skill registry load failed: ${(err as Error)?.stack ?? err}`);
  });
  ruleRegistry = new RuleRegistry(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  void ruleRegistry.load().catch((err) => {
    log.appendLine(`[arc] Rule registry load failed: ${(err as Error)?.stack ?? err}`);
  });
  try {
    registerViewsAndCommands(context);
  } catch (err) {
    log.appendLine(`[arc] fatal during phase 1: ${(err as Error)?.stack ?? err}`);
    void vscode.window.showErrorMessage(`Arc failed to activate: ${(err as Error)?.message ?? err}`);
    return;
  }
  void initializeAsync(context).catch((err) => {
    log.appendLine(`[arc] async init failed: ${(err as Error)?.stack ?? err}`);
    initResolve?.();
  });
}
function registerViewsAndCommands(context: vscode.ExtensionContext) {
  const logo = pickLogo();
  void vscode.commands.executeCommand("setContext", "arc.isPrideMonth", logo.kind === "pride");
  const sidebarProvider: vscode.WebviewViewProvider = {
    async resolveWebviewView(webviewView: vscode.WebviewView) {
      try {
        sidebarSession.view = webviewView;
        webviewView.webview.options = {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.file(context.extensionPath)],
        };
        webviewView.webview.html = getWebviewHtml(webviewView.webview, context.extensionUri, "sidebar");
        wireWebview(webviewView.webview, sidebarSession);
        void ensureAgent(sidebarSession);
      } catch (err) {
        log.appendLine(`[arc] view resolve failed: ${(err as Error)?.stack ?? err}`);
      }
    },
  };
  vscode.window.registerWebviewViewProvider("arc-sidebar", sidebarProvider);
  vscode.window.registerWebviewViewProvider("arc-sidebar-pride", sidebarProvider);
  vscode.commands.registerCommand("arc.openSidebar", () => {
    void vscode.commands.executeCommand("workbench.view.extension.arc-activitybar");
  });
  vscode.commands.registerCommand("arc.openFullscreen", () => {
    openFullscreen();
  });
  vscode.commands.registerCommand("arc.openSettings", () => {
    openSettings();
  });
  vscode.commands.registerCommand("arc.newTask", () => {
    newTask();
  });
  vscode.commands.registerCommand("arc.stop", () => {
    void awaitAgent(sidebarSession).then((a) => a?.stop());
  });
  vscode.commands.registerCommand("arc.continue", () => {
    void awaitAgent(sidebarSession).then((a) => a?.continue());
  });
  vscode.commands.registerCommand("arc.toggleProblems", async () => {
    const cur = vscode.workspace.getConfiguration().get<boolean>("arc.showProblems", false);
    await vscode.workspace.getConfiguration().update("arc.showProblems", !cur, vscode.ConfigurationTarget.Workspace);
  });
  vscode.commands.registerCommand("arc.manageModels", async () => {
    openSettings();
  });
  vscode.commands.registerCommand("arc.manageMcp", async () => {
    openSettings();
  });
  vscode.commands.registerCommand("arc.managePrompts", async () => {
    openPrompt();
  });
  void vscode.commands.executeCommand("setContext", "arc.showProblems", false);
}
async function initializeAsync(context: vscode.ExtensionContext) {
  registry = new ModelRegistry();
  const stored = context.globalState.get<{ models: ModelDescriptor[]; providers: ProviderConfig[]; currentModelId?: string }>("arc.registry", { models: [], providers: [] });
  for (const p of stored.providers) {
    if (!p.apiKey) p.apiKey = await context.secrets.get(`${SECRET_PREFIX}${p.id}`);
  }
  registry.load(stored);
  chatHistory = new ChatHistory();
  chatsFilePath = `${context.globalStorageUri.fsPath}/arc.chats.json`;
  let loadedFromDisk = false;
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(chatsFilePath, "utf-8");
    const diskSnap = JSON.parse(raw) as ChatSnapshot;
    if (diskSnap.chats?.length) {
      chatHistory.load(diskSnap);
      loadedFromDisk = true;
    }
  } catch {  }
  if (!loadedFromDisk) {
    const storedChats = context.globalState.get<{ chats: import("@arc/host").ChatMeta[]; currentId?: string; messages?: Record<string, unknown[]> }>("arc.chats", { chats: [] });
    chatHistory.load(storedChats);
  }
  if (!chatHistory.current() && chatHistory.list().length === 0) {
    chatHistory.create("Welcome");
  }
  persist = () => {
    const snapshot = {
      models: registry.list(),
      providers: registry.listProviders().map(({ apiKey, ...rest }) => rest),
      currentModelId: registry.getCurrent()?.id,
    };
    void context.globalState.update("arc.registry", snapshot);
    void context.globalState.update("arc.chats", { chats: chatHistory.list(), currentId: chatHistory.current() });
  };
  persistAsync = async () => {
    persist();
    try {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      const snap = chatHistory.snapshot();
      await mkdir(dirname(chatsFilePath), { recursive: true });
      await writeFile(chatsFilePath, JSON.stringify(snap, null, 2), "utf-8");
    } catch (e) {
      log.appendLine(`[arc] failed to persist chats: ${(e as Error).message}`);
    }
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("arc")) persist();
  }));
  store = new CheckpointStore({ dir: context.globalStorageUri.fsPath });
  lsp = new LspBridge(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  mcp = new McpAggregator();
  mcp.setPersistence(() => persistMcpConfig(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()));
  mcp.onChange(() => {
    const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
    for (const webview of getAllWebviews()) {
      webview.postMessage({ type: "mcp/list", servers: list });
    }
  });
  void hydrateMcp(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()).catch((err) => {
    log.appendLine(`[arc] MCP hydration failed: ${(err as Error)?.stack ?? err}`);
  });
  setNotifier(makeVSCodeNotifier());
  const savedState = context.globalState.get<{ messages: unknown[]; steps: unknown[]; mode: string; todoItems: unknown[] }>("arc.agentState");
  const currentChat = chatHistory.ensure(chatHistory.current());
  sidebarSession.id = currentChat.id;
  chatSessions.set(currentChat.id, sidebarSession);
  void ensureAgent(sidebarSession).then(async (agent) => {
    if (agent && savedState?.messages?.length) {
      agent.restore(savedState as any).catch(() => {});
      context.globalState.update("arc.agentState", undefined);
    }
  });
  persist();
  void tryLoadIndex();
  initResolve?.();
}
async function openFullscreen(): Promise<vscode.Webview | undefined> {
  if (!ctxRef) return;
  for (const [, s] of fullscreenSessions) {
    if (s.panel) { s.panel.reveal(); return s.panel.webview; }
  }
  const panel = vscode.window.createWebviewPanel("arc.fullscreen", "Arc", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(ctxRef.extensionPath)],
  });
  panel.iconPath = vscode.Uri.file(ctxRef.asAbsolutePath("assets/arc-logo-mono.svg"));
  panel.webview.html = getWebviewHtml(panel.webview, ctxRef.extensionUri, "fullscreen");
  const mapKey = `fullscreen-${Date.now()}`;
  const chatId = chatHistory.ensure(chatHistory.current()).id;
  const session: Session = { id: chatId, panel, agent: undefined as unknown as Agent, steps: [], messages: [] };
  fullscreenSessions.set(mapKey, session);
  wireWebview(panel.webview, session);
  void ensureAgent(session);
  panel.onDidDispose(() => {
    fullscreenSessions.delete(mapKey);
  });
  return panel.webview;
}
function openSettings() {
  if (!ctxRef) return;
  if (sidebarSession.view) sidebarSession.view.webview.postMessage({ type: "ui/showSettings" });
  for (const [, s] of fullscreenSessions) s.panel?.webview.postMessage({ type: "ui/showSettings" });
  if (!sidebarSession.view && fullscreenSessions.size === 0) openFullscreen().then(() => {
    for (const [, s] of fullscreenSessions) s.panel?.webview.postMessage({ type: "ui/showSettings" });
  });
}
function newTask() {
  sidebarSession.messages = [];
  sidebarSession.steps = [];
  if (sidebarSession.agent) {
    sidebarSession.agent = undefined as unknown as Agent;
    sidebarSession.agentReady = undefined;
    void ensureAgent(sidebarSession);
  }
  if (sidebarSession.view) {
    sidebarSession.view.webview.postMessage({ type: "chat/current", chatId: sidebarSession.id });
    sidebarSession.view.webview.postMessage({
      type: "session/init",
      sessionId: sidebarSession.id,
      models: registry?.list() ?? [],
      currentModelId: registry?.getCurrent()?.id ?? "",
    });
  }
}
async function openPrompt() {
  if (!ctxRef) return;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const wsArcDir = getWorkspaceArcDir(root);
  const target = vscode.Uri.file(path.join(wsArcDir, "prompt.md"));
  try {
    await vscode.workspace.fs.stat(target);
  } catch {
    try { await vscode.workspace.fs.createDirectory(vscode.Uri.file(wsArcDir)); } catch {  }
    await vscode.workspace.fs.writeFile(
      target,
      new TextEncoder().encode("# Arc workspace prompt\n\nOverride Arc's system prompt for this workspace.\n"),
    );
  }
  await vscode.window.showTextDocument(target);
}
function classifyError(message: string): "timeout" | "rate_limit" | "auth" | "provider" | "malformed" | "network" | "aborted" | undefined {
  const m = message.toLowerCase();
  if (m.includes("timeout") || m.includes("timed out") || m.includes("etimedout") || m.includes("esockettimedout")) return "timeout";
  if (m.includes("429") || m.includes("rate limit") || m.includes("too many requests")) return "rate_limit";
  if (m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("forbidden") || m.includes("authentication")) return "auth";
  if (m.includes("abort") || m.includes("cancel")) return "aborted";
  if (m.includes("fetch failed") || m.includes("econnrefused") || m.includes("enotfound") || m.includes("network")) return "network";
  if (m.includes("parse") || m.includes("malformed") || m.includes("unexpected token") || m.includes("json")) return "malformed";
  if (m.includes("500") || m.includes("502") || m.includes("503")) return "provider";
  return undefined;
}
const buildSystemPrompt = async (mcpAggregator?: McpAggregator): Promise<string> => {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const globalParts = await loadGlobalPrompts();
  const wsParts = await loadWorkspacePrompts(root);
  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  const parts = injectRelevantRules([...globalParts, ...wsParts], activeFile);
  const basePrompt = `You are Arc, an agentic coding assistant. Be concise. Be precise.
Working dir: ${root} | OS: ${process.platform} | Date: ${new Date().toISOString().slice(0, 10)}

## Communication
- Drop articles, filler, hedging, and pleasantries where meaning stays clear. Short synonyms and fragments OK for routine feedback.
- Technical terms, code, API names, CLI commands, and error strings are always verbatim. Code blocks unchanged.
- No emojis, no em dashes. Lists flat — no nested bullets. No tool-call narration.
- EXCEPTIONS (revert to full sentences): security warnings, destructive operation confirmations, multi-step sequences where fragment order risks misread, compression creates ambiguity, user asks to clarify.
- Default to action: assume the user wants implementation, not a plan. Stay with the work until handled — don't stop at analysis or half-finished fixes.

## Rules
- Respect existing conventions, libraries, and patterns. Do NOT refactor or modify unrelated code. Let the codebase teach you how to move.
- Make precise, surgical changes that fully address the request. Do NOT describe code you haven't written — implement it completely.
- Discover bugs caused by or tightly coupled to your changes — fix those too. Skip unrelated pre-existing issues.
- Add abstraction only when it removes real complexity, reduces meaningful duplication, or clearly matches an established local pattern.
- If a request is ambiguous, ask before acting. Reserve questions for decisions the codebase cannot answer; for everything else pick a sensible default and proceed.
- Write diagnostic-as-code: no comments unless the WHY is non-obvious. The code should explain itself.
- Never revert changes you did not make. If there are unrelated changes in files you touch, work with them. Ignore changes in unrelated files.
- Never use destructive commands (git reset --hard, git checkout --) unless explicitly asked.

## Tool efficiency
- Prefer dedicated tools over shell.run when one fits: file.grep over rg/grep, file.glob over ls/find, file.read over cat/head/tail, webfetch over curl.
- When reading a large file, use offset/limit on file.read to target just the lines you need.
- For file.edit, pass the SEARCH/REPLACE block format in \`search\` — it is unambiguous and survives whitespace drift. Format:\n\npath/to/file.ts\n<<<<<<< SEARCH\nexact lines to replace (include enough context to be unique)\n=======\nreplacement lines\n>>>>>>> REPLACE\n\nInclude enough surrounding lines for a unique match. Fall back to plain search+replace only for trivial one-line changes.
- After a successful file.edit or file.write, do NOT re-read the file to verify — the tool would have errored if the change failed. LSP diagnostics run automatically.
- Launch independent Read or Glob calls in parallel — one response, multiple tool calls.
- Reflect on command output before proceeding to the next step.

## Shell
- Use shell.run for short-lived commands, shell.backgroundRun for long-running processes (builds, servers, watchers).
- Poll background processes with shell.check; send stdin with shell.write.
- Chain commands with && instead of separate shell.run calls. Suppress pagers (git --no-pager, append | cat).
- Commit or push only when the user asks. If on the default branch, branch first.

## Tools
file.read, file.edit, file.write, file.grep, file.glob, shell.run, shell.backgroundRun, shell.check, shell.write, webfetch, lsp.problems, lsp.problemsFor, todo.write, browser.*, mcp.call, checkpoint.revert, checkpoint.list, subagent.spawn, handoff, clarification.askUser, skill.read, skill.use, mode.switch, memory.add, memory.list, memory.edit, memory.delete, rule.list, rule.read, rule.create

## Workflow
1. Understand the task. Use file.grep and file.glob to locate relevant code. Read files with file.read (use offset/limit for large files).
2. **Plan-first for complex work:** When the task spans multiple files, involves architectural decisions, or has ambiguous scope, pause and use \`clarification.askUser\` to ask: "Plan first? I can outline a todo list for your review before making changes." If the user approves, produce a full todo list via \`todo.write\` and wait for sign-off (the user will say "proceed" or similar) before executing. Update the plan dynamically as you discover new information — add, remove, or reorder items as needed. Mark the current item \`in_progress\`, and mark items \`done\` after verifying them.
3. **For straightforward tasks:** proceed directly. Keep exactly one todo item in_progress at a time. After file.edit/write, fix any diagnostics in the same turn.
4. Delegate grunt work to subagents — they are cheap. For independent parallel investigations, launch multiple subagents in one turn.
5. If a task exceeds your capability, call handoff with a clear reason.
6. Do not create markdown files for planning, notes, or tracking — use todo.write instead.

## Output
- Report outcomes faithfully: if something fails, state what happened with the output. If something succeeds, state it plainly without hedging. If a step was skipped, say so.
- Reference code as \`file_path:line_number\` — it's clickable in the UI.`;
  let mcpBlock = "";
  if (mcpAggregator) {
    const tools = mcpAggregator.listTools();
    if (tools.length > 0) {
      const byServer = new Map<string, typeof tools>();
      for (const t of tools) { if (!byServer.has(t.server)) byServer.set(t.server, []); byServer.get(t.server)!.push(t); }
      const lines = ["\n## MCP servers"];
      for (const [server, serverTools] of byServer) {
        lines.push(`- ${server} (${serverTools.length} tool${serverTools.length === 1 ? "" : "s"}): ${serverTools.map((t) => t.name).join(", ")}`);
      }
      mcpBlock = lines.join("\n");
    }
  }
  const merged = mergePrecedence([{ scope: "global", body: basePrompt + mcpBlock }, ...parts]);
  if (skillRegistryReady) await skillRegistryReady;
  const skillsSection = skillRegistry ? skillRegistry.titlesForSystemPrompt() : "";
  return render(merged, {
    workspace: root,
    os: process.platform,
    date: new Date().toISOString().slice(0, 10),
  }) + skillsSection;
};
async function createAgent(session: Session): Promise<Agent | undefined> {
  if (!registry || !store || !lsp || !mcp || !ctxRef) return;
  const systemPrompt = await buildSystemPrompt(mcp);
  const toolContext = {
    problems: () => lsp.allProblems(),
    problemsFor: (file: string) => lsp.problemsFor(file),
    summaryForFiles: (files: string[]) => lsp.summaryForFiles(files),
    mcp,
    browser: getBrowser,
    skillRegistry,
    ruleRegistry,
    grep: async (pattern: string, include?: string) => {
      const results: { file: string; line: number; column: number; text: string }[] = [];
      const MAX_FILES = 200;
      const MAX_MATCHES = 500;
      const MAX_FILE_SIZE = 256 * 1024;
      let regex: RegExp;
      try { regex = new RegExp(pattern); } catch { return results; }
      const filePattern = include ? `**/${include}` : "**/*";
      const uris = await vscode.workspace.findFiles(filePattern, null, MAX_FILES);
      for (const uri of uris) {
        if (results.length >= MAX_MATCHES) break;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > MAX_FILE_SIZE) continue;
          const raw = await vscode.workspace.fs.readFile(uri);
          const text = new TextDecoder().decode(raw);
          const lines = text.split("\n");
          for (let li = 0; li < lines.length && results.length < MAX_MATCHES; li++) {
            const match = regex.exec(lines[li]);
            if (match) {
              results.push({
                file: vscode.workspace.asRelativePath(uri),
                line: li + 1,
                column: match.index + 1,
                text: lines[li].trimEnd(),
              });
            }
          }
} catch {  }
      }
      return results;
    },
    glob: async (pattern: string) => {
      const uris = await vscode.workspace.findFiles(pattern, null, 200);
      return uris.map((u) => vscode.workspace.asRelativePath(u));
    },
    semanticSearch: async (query: string, k?: number) => {
      const idx = searchIndexer;
      if (!idx) return [];
      const hits = await idx.search(query, k ?? 10);
      return hits.map((h) => ({ file: h.file, start: h.start, end: h.end, score: h.score, snippet: h.text }));
    },
  };
  const sinkId = session.id;
  const sink: import("@arc/host").AgentEventSink = {
    message: (m) => {
      session.messages.push(m);
      broadcast(session, { type: "session/message", message: m, sessionId: sinkId });
    },
    assistantDelta: (id, text) => broadcast(session, { type: "session/assistantText", id, text, sessionId: sinkId }),
    steps: (steps) => {
      session.steps = steps;
      chatHistory?.setSteps(session.id, steps);
      broadcast(session, { type: "session/steps", steps, sessionId: sinkId });
    },
    turnStart: (turnId) => broadcast(session, { type: "session/turnStart", turnId, sessionId: sinkId }),
    turnEnd: (turnId, ok, error) => broadcast(session, { type: "session/turnEnd", turnId, ok, ...(error ? { error } : {}), sessionId: sinkId }),
    usage: (usage, perModel) => {
      const totals = chatTotals.get(session.id) ?? { cost: 0, promptTokens: 0, completionTokens: 0, window: 0 };
      totals.promptTokens = Math.max(totals.promptTokens, usage.prompt);
      totals.completionTokens = usage.completion;
      totals.cost += usage.cost;
      const model = registry?.getCurrent();
      if (model) totals.window = model.contextWindow;
      chatTotals.set(session.id, totals);
      if (chatHistory) {
        chatHistory.bump(session.id, usage.cost);
        chatHistory.setMessages(session.id, session.agent.getMessages());
        chatHistory.setSteps(session.id, session.steps);
      }
      broadcast(session, { type: "session/usage", usage, perModel });
      for (const w of [session.view?.webview, session.panel?.webview].filter(Boolean) as vscode.Webview[]) {
        pushContextStats(w, session.id);
      }
      broadcastChatListAll();
      persist?.();
      void persistAsync?.();
    },
    handoff: (fromModel, toModel, reason) => broadcast(session, { type: "session/handoff", fromModel, toModel, reason }),
    todo: (items) => broadcast(session, { type: "todo/update", items }),
    clarification: (id, question, options) => broadcast(session, { type: "session/clarification", id, question, options }),
    done: () => {
      if (chatHistory) chatHistory.setMessages(session.id, session.agent.getMessages());
      void persistAsync?.();
      broadcast(session, { type: "session/done" });
    },
    guidance: (text) => broadcast(session, { type: "session/guidance", text }),
    error: (message) => broadcast(session, { type: "error", message, ...(classifyError(message) ? { code: classifyError(message) } : {}) }),
    compaction: (before, after, reason) => broadcast(session, { type: "session/compaction", before, after, reason }),
    timeline: (events) => broadcast(session, { type: "session/timeline", events }),
  };
  session.agent = new Agent(registry, store, sink, {
    systemPrompt,
    enabledTools: new Set([
      "file.read", "file.edit", "file.write", "file.grep", "file.glob",       "shell.run", "shell.backgroundRun", "shell.check", "shell.write", "shell.customRun", "shell.editCustomRun", "shell.runCustomRun",
      "test.run", "webfetch",
      "lsp.problems", "lsp.problemsFor",
      "todo.write",
      "browser.navigate", "browser.click", "browser.type", "browser.screenshot", "browser.evaluate", "browser.readDom", "browser.close", "browser.hover", "browser.scroll", "browser.waitFor",
      "browser.console", "browser.network", "browser.domSnapshot",
      "mcp.call", "mcp.create", "mcp.remove", "mcp.toggle",
      "mcp.resources/list", "mcp.resources/read", "mcp.prompts/list", "mcp.prompts/get",
      "subagent.spawn", "handoff", "clarification.askUser",
      "checkpoint.revert", "checkpoint.list", "checkpoint.compare",
      "file.semanticSearch",
      "mode.switch",
      "skill.read", "skill.use",
      "memory.list", "memory.edit", "memory.delete", "memory.add",
      "rule.list", "rule.read", "rule.create",
      "git.diffStaged", "git.diffUnstaged", "git.changedFiles", "git.branchDiff", "git.commitMessage",
      "session.exportTrace",
    ]),
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
    mode: "code",
    modeRegistry,
    approvalsConfig,
    isMain: true,
    toolContext,
    approveShell: async (description) => {
      const id = String(++approvalId);
      const promise = new Promise<boolean>((resolve) => {
        pendingApprovals.set(id, { resolve, session });
        setTimeout(() => {
          if (pendingApprovals.has(id)) {
            pendingApprovals.delete(id);
            resolve(false);
          }
        }, 120_000);
      });
      if (session.view) session.view.webview.postMessage({ type: "approval/request", id, description, kind: "shell" });
      if (session.panel) session.panel.webview.postMessage({ type: "approval/request", id, description, kind: "shell" });
      return promise;
    },
    askUser: async (question, options) => {
      if (!options.length) {
        const input = await vscode.window.showInputBox({ prompt: question });
        return input ?? "";
      }
      const labels = [...options, "Type custom..."];
      const pick = await vscode.window.showQuickPick(labels, { title: question, canPickMany: false });
      if (!pick) return "";
      if (pick === "Type custom...") {
        const input = await vscode.window.showInputBox({ prompt: question });
        return input ?? "";
      }
      return pick;
    },
    initialMessages: chatHistory?.getMessages(session.id) as ChatMessage[] ?? [],
  });
  return session.agent;
}
function broadcast(session: Session, msg: HostMsg) {
  if (session.view) session.view.webview.postMessage(msg);
  if (session.panel) session.panel.webview.postMessage(msg);
}
function ensureAgent(session: Session): Promise<Agent | undefined> {
  if (session.agentReady) return session.agentReady;
  session.agentReady = createAgent(session).catch((err) => {
    log.appendLine(`[arc] createAgent failed: ${(err as Error)?.stack ?? err}`);
    return undefined;
  });
  return session.agentReady;
}
async function awaitAgent(session: Session): Promise<Agent | undefined> {
  await initReady;
  const a = await ensureAgent(session);
  return a;
}
function broadcastChatList(webview: vscode.Webview) {
  if (!chatHistory) return;
  const current = chatHistory.current();
  const chats = chatHistory.list().map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    cost: c.cost,
    isActive: c.id === current,
  }));
  webview.postMessage({ type: "chat/list", chats });
}
function broadcastChatListAll() {
  for (const w of getAllWebviews()) {
    broadcastChatList(w);
  }
}
function switchToChat(chatId: string, webview: vscode.Webview) {
  if (sidebarSession.agent) {
    chatHistory?.setMessages(sidebarSession.id, sidebarSession.agent.getMessages());
    void persistAsync?.();
  }
  for (const [, s] of fullscreenSessions) {
    if (s.agent) {
      chatHistory?.setMessages(s.id, s.agent.getMessages());
    }
    s.id = chatId;
    s.steps = [];
    s.agent = undefined as unknown as Agent;
    s.agentReady = undefined;
  }
  webview.postMessage({ type: "chat/current", chatId });
  webview.postMessage({ type: "session/steps", steps: [] });
  const persisted = (chatHistory?.getMessages(chatId) ?? []) as ChatMessage[];
  const persistedSteps = chatHistory?.getSteps(chatId) ?? [];
  if (sidebarSession) {
    sidebarSession.id = chatId;
    sidebarSession.messages = persisted;
    sidebarSession.steps = persistedSteps as ProcessStep[];
    sidebarSession.agent = undefined as unknown as Agent;
    sidebarSession.agentReady = undefined;
  }
  for (const [, s] of fullscreenSessions) {
    s.messages = persisted;
    s.steps = persistedSteps as ProcessStep[];
  }
  webview.postMessage({ type: "session/steps", steps: persistedSteps.length ? persistedSteps : [] });
  for (const m of persisted) {
    webview.postMessage({ type: "session/message", message: m, sessionId: chatId });
  }
  chatTotals.set(chatId, { cost: 0, promptTokens: 0, completionTokens: 0, window: 0 });
  pushContextStats(webview, chatId);
  sidebarSession.agent = undefined as unknown as Agent;
  sidebarSession.agentReady = undefined;
  void ensureAgent(sidebarSession);
  for (const [, s] of fullscreenSessions) {
    s.agent = undefined as unknown as Agent;
    s.agentReady = undefined;
    void ensureAgent(s);
  }
}
function pushContextStats(webview: vscode.Webview, chatId: string) {
  const totals = chatTotals.get(chatId) ?? { cost: 0, promptTokens: 0, completionTokens: 0, window: 0 };
  const model = registry?.getCurrent();
  const window = model?.contextWindow ?? 0;
  const tokens = totals.promptTokens;
  const usedPct = window > 0 ? Math.min(100, (tokens / window) * 100) : 0;
  webview.postMessage({ type: "context/stats", usedPct, tokens, window, cost: totals.cost });
}
async function reindexWorkspace(webview: vscode.Webview) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    webview.postMessage({ type: "error", message: "No workspace folder to index." });
    return;
  }
  searchAbort?.abort();
  searchAbort = new AbortController();
  const signal = searchAbort.signal;
  const cfg = vscode.workspace.getConfiguration();
  const backend = cfg.get<string>("arc.search.backend", "hash-based");
  const enabled = cfg.get<boolean>("arc.search.enabled", true);
  if (!enabled) return;
  let be: EmbeddingBackend;
  if (backend === "semantic") {
    const tier = (cfg.get<string>("arc.search.modelTier", "low") ?? "low") as "low" | "mid" | "high";
    const url = cfg.get<string>("arc.search.ollamaUrl", "http://127.0.0.1:11434") ?? "http://127.0.0.1:11434";
    be = new OllamaEmbeddingBackend(DEFAULT_EMBEDDING_MODELS[tier], { baseUrl: url, signal });
  } else {
    be = new HashEmbeddingBackend(256);
  }
  searchIndexer = new Indexer({ backend: be });
  searchProgress = { filesScanned: 0, filesIndexed: 0, chunksEmbedded: 0, errors: 0 };
  const files = await walkWorkspace(root);
  searchProgress.filesScanned = files.length;
  broadcastAll({ type: "search/indexProgress", filesScanned: files.length, filesIndexed: 0, chunksEmbedded: 0, errors: 0 });
  if (signal.aborted) return;
  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) return;
    try {
      const added = await searchIndexer.reindexFile(root, files[i]);
      searchProgress.filesIndexed = i + 1;
      searchProgress.chunksEmbedded += added;
    } catch {
      searchProgress.filesIndexed = i + 1;
      searchProgress.errors++;
    }
    broadcastAll({ type: "search/indexProgress", filesScanned: searchProgress.filesScanned, filesIndexed: searchProgress.filesIndexed, chunksEmbedded: searchProgress.chunksEmbedded, errors: searchProgress.errors });
  }
  searchAbort = undefined;
  const indexPath = getIndexPath();
  if (indexPath && searchIndexer && searchProgress.filesIndexed > 0) {
    try { await searchIndexer.save(indexPath); } catch {  }
  }
}
async function walkWorkspace(root: string): Promise<string[]> {
  const include = [
    "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs",
    "**/*.py", "**/*.rs", "**/*.go", "**/*.java", "**/*.kt", "**/*.cs",
    "**/*.rb", "**/*.php", "**/*.swift", "**/*.c", "**/*.cpp", "**/*.h",
    "**/*.hpp", "**/*.md", "**/*.mdx", "**/*.txt", "**/*.json", "**/*.yaml", "**/*.yml",
    "**/*.toml", "**/*.html", "**/*.css", "**/*.scss", "**/*.sql",
  ];
  const exclude = [
    "**/node_modules/**", "**/.git/**", "**/dist/**", "**/out/**", "**/build/**",
    "**/.next/**", "**/.vscode/**", "**/coverage/**", "**/.cache/**",
    "**/target/**", "**/venv/**", "**/__pycache__/**", "**/*.min.js", "**/*.lock",
    "**/*.lockb", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock",
  ];
  const out: string[] = [];
  async function visit(dir: string) {
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        if (matchAny(rel + "/", exclude)) continue;
        await visit(full);
      } else if (ent.isFile()) {
        if (matchAny(rel, exclude)) continue;
        if (matchAny(rel, include)) out.push(rel);
      }
    }
  }
  await visit(root);
  return out;
}
function matchAny(p: string, patterns: string[]): boolean {
  return patterns.some((pat) => {
    let re = "^";
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (c === "*") {
        if (pat[i + 1] === "*") { re += ".*"; i++; if (pat[i + 1] === "/") i++; }
        else re += "[^/]*";
      } else if (c === "?") re += "[^/]";
      else if ("\\^$.|+()[]{}".includes(c)) re += "\\" + c;
      else re += c;
    }
    return new RegExp(re + "$").test(p);
  });
}
function broadcastAll(msg: HostMsg) {
  for (const s of [sidebarSession, ...fullscreenSessions.values()]) {
    for (const v of [s.view?.webview, s.panel?.webview].filter(Boolean) as vscode.Webview[]) {
      v.postMessage(msg);
    }
  }
}
function getIndexPath(): string | undefined {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) return undefined;
  const hash = createHash("sha1").update(ws).digest("hex").slice(0, 12);
  const dir = path.join(ctxRef.globalStorageUri.fsPath, "index");
  return path.join(dir, `${hash}.arcx`);
}
async function tryLoadIndex(): Promise<void> {
  const indexPath = getIndexPath();
  if (!indexPath) return;
  try {
    await fs.access(indexPath);
  } catch {
    return;
  }
  const cfg = vscode.workspace.getConfiguration();
  const backend = cfg.get<string>("arc.search.backend", "hash-based");
  const enabled = cfg.get<boolean>("arc.search.enabled", true);
  if (!enabled) return;
  let be: EmbeddingBackend;
  if (backend === "semantic") {
    const tier = (cfg.get<string>("arc.search.modelTier", "low") ?? "low") as "low" | "mid" | "high";
    const url = cfg.get<string>("arc.search.ollamaUrl", "http://127.0.0.1:11434") ?? "http://127.0.0.1:11434";
    be = new OllamaEmbeddingBackend(DEFAULT_EMBEDDING_MODELS[tier], { baseUrl: url });
  } else {
    be = new HashEmbeddingBackend(256);
  }
  try {
    searchIndexer = await Indexer.load(indexPath, be);
    searchProgress = { filesScanned: searchIndexer.getIndex().size(), filesIndexed: searchIndexer.getIndex().size(), chunksEmbedded: searchIndexer.getIndex().size(), errors: 0 };
  } catch {
    searchIndexer = undefined;
  }
}
function wireWebview(webview: vscode.Webview, session: Session) {
  webview.onDidReceiveMessage(async (raw: unknown) => {
    const msg = raw as WebviewMsg;
    try {
      switch (msg.type) {
        case "ready": {
          await initReady;
          webview.postMessage({
            type: "session/init",
            sessionId: session.id,
            chatId: chatHistory?.current(),
            models: registry?.list() ?? [],
            currentModelId: registry?.getCurrent()?.id ?? "",
            modes: modeRegistry ? modeRegistry.list().map((m) => ({ slug: m.slug, description: m.description })) : [],
            currentMode: session.agent?.getCurrentMode?.() ?? "code",
          });
          if (registry) webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" });
          if (registry) webview.postMessage({ type: "provider/list", providers: registry.listProviders() });
          if (mcp) {
            const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
            webview.postMessage({ type: "mcp/list", servers: list });
          }
          {
            const persisted = (chatHistory?.getMessages(session.id) ?? []) as ChatMessage[];
            const persistedSteps = chatHistory?.getSteps(session.id) ?? [];
            if (persisted.length) {
              session.messages = persisted;
              for (const m of persisted) webview.postMessage({ type: "session/message", message: m, sessionId: session.id });
            } else {
              for (const m of session.messages) webview.postMessage({ type: "session/message", message: m, sessionId: session.id });
            }
            if (persistedSteps.length) {
              session.steps = persistedSteps as ProcessStep[];
              webview.postMessage({ type: "session/steps", steps: persistedSteps, sessionId: session.id });
            } else {
              webview.postMessage({ type: "session/steps", steps: session.steps });
            }
          }
          webview.postMessage({ type: "session/steps", steps: session.steps });
          broadcastChatList(webview);
          pushContextStats(webview, session.id);
          {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const agent = await ensureAgent(session);
            if (agent) {
              const prefixes = await loadApprovalsMemory(root);
              for (const entry of prefixes) {
                agent.addCommandPrefix(entry.prefix);
              }
            }
          }
          break;
        }
        case "chat/send":
          if (chatHistory && !chatHistory.list().length) {
            const c = chatHistory.create();
            session.id = c.id;
            session.messages = [];
            session.steps = [];
            session.agent = undefined as unknown as Agent;
            session.agentReady = undefined;
            void ensureAgent(session);
            persist?.();
            void persistAsync?.();
            broadcastChatListAll();
          }
          if (chatHistory) {
            const nonSystem = (session.messages as ChatMessage[]).filter((m) => m.role !== "system");
            if (nonSystem.length === 0) {
              const chat = chatHistory.list().find((c) => c.id === session.id);
              if (chat && (chat.title.startsWith("Welcome") || chat.title.startsWith("New chat"))) {
                const method = vscode.workspace.getConfiguration().get<string>("arc.titleGeneration.method", "first-words");
                if (method === "ollama") {
                  generateTitleViaOllama(msg.text).then((title) => {
                    if (title) {
                      chatHistory.rename(session.id, title);
                      persist?.();
                      void persistAsync?.();
                      broadcastChatListAll();
                    }
                  });
                } else {
                  chatHistory.rename(session.id, msg.text.slice(0, 40).trim());
                  persist?.();
                  void persistAsync?.();
                  broadcastChatListAll();
                }
              }
            }
          }
          {
            const agent = await awaitAgent(session);
            if (agent) {
              const { text, images, descriptions } = await maybeDescribeImages(msg.text, msg.images);
              if (descriptions?.length) {
                const content = descriptions.map((d, i) => `Image ${i + 1}: ${d}`).join("\n\n");
                agent.setPendingToolChain("describe_image", { count: descriptions.length }, content, `Described ${descriptions.length} image${descriptions.length > 1 ? "s" : ""}`);
              }
              await agent.send(text, msg.attachments, images);
            }
          }
          break;
        case "chat/guidance":
          {
            const agent = await awaitAgent(session);
            if (agent) await agent.guidance(msg.text);
          }
          break;
        case "chat/stop":
          {
            const agent = await awaitAgent(session);
            if (agent) await agent.stop();
          }
          break;
        case "chat/continue":
          {
            const agent = await awaitAgent(session);
            if (agent) await agent.continue();
          }
          break;
        case "chat/answerClarification":
          {
            const agent = await awaitAgent(session);
            if (agent) {
              agent.answerClarification(msg.id, msg.answer);
              await agent.continue();
            }
          }
          break;
        case "chat/retract":
          {
            const agent = await awaitAgent(session);
            if (agent) await agent.retract(msg.turnId);
          }
          break;
        case "chat/revertToMessage":
          {
            const agent = await awaitAgent(session);
            if (agent) {
              const result = await agent.revertToMessage(msg.messageId, !!msg.restoreFiles, msg.content);
              if (result.reverted) {
                const msgs = agent.getMessages();
                const steps = agent.getSteps();
                const composerText = msg.loadToComposer ? msg.content : undefined;
                webview.postMessage({ type: "session/replaceState", messages: msgs, steps, loadComposer: composerText });
              } else {
                webview.postMessage({ type: "session/message", message: { id: `revert-${Date.now()}`, role: "system", content: "Could not find message to revert to.", ts: Date.now() }, sessionId: session.id });
              }
            }
          }
          break;
        case "chat/editMessage":
          {
            const agent = await awaitAgent(session);
            if (agent) {
              const messages = agent.getMessages();
              const content = msg.content ?? msg.messageId;
              let idx = messages.findIndex((m) => m.role === "user" && m.content.trim() === content.trim());
              if (idx < 0) idx = messages.findIndex((m) => m.role === "user" && m.content.includes(content.slice(0, 30)));
              if (idx >= 0) {
                const editTs = messages[idx].ts;
                messages[idx] = { ...messages[idx], content: msg.newContent, meta: { ...messages[idx].meta, editedOriginal: messages[idx].content } };
                messages.length = idx + 1;
                const keptSteps = agent.getSteps().filter((s) => (s.ts ?? 0) <= (editTs ?? 0));
                await agent.restore({ messages, steps: keptSteps, mode: agent.getCurrentMode(), todoItems: agent.getTodo() });
                webview.postMessage({ type: "session/replaceState", messages: agent.getMessages(), steps: agent.getSteps() });
                void agent.continue();
              }
            }
          }
          break;
        case "model/select":
          if (registry) { registry.setCurrent(msg.modelId); persist?.(); webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" }); }
          break;
        case "model/add":
          if (registry) { registry.upsertModel(msg.model); persist?.(); webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" }); }
          break;
        case "model/remove":
          if (registry) { registry.removeModel(msg.modelId); persist?.(); webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" }); }
          break;
        case "model/bindUpdate": {
          if (registry) {
            const m = registry.get(msg.modelId);
            if (m) {
              const updated: ModelDescriptor = {
                ...m,
                providers: m.providers.map((p) => p.id === msg.providerId
                  ? { ...p, remoteModel: msg.remoteModel?.trim() || undefined }
                  : p),
              };
              registry.upsertModel(updated);
              persist?.();
              webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" });
            }
          }
          break;
        }
        case "mode/select": {
          const agent = await ensureAgent(session);
          if (agent && modeRegistry) {
            agent.switchMode(msg.mode);
            const modeDef = modeRegistry.get(msg.mode);
            if (modeDef) {
              broadcast(session, { type: "session/message", message: { id: `mode-${Date.now()}`, role: "system", content: `Switched to **${msg.mode}** mode — ${modeDef.description}`, ts: Date.now() }, sessionId: session.id });
            }
          }
          break;
        }
        case "provider/add": {
          if (registry) {
            registry.upsertProvider({ ...msg.provider, enabled: msg.provider.enabled ?? true });
            if (msg.apiKey) await ctxRef.secrets.store(`${SECRET_PREFIX}${msg.provider.id}`, msg.apiKey);
            persist?.();
            webview.postMessage({ type: "provider/list", providers: registry.listProviders() });
          }
          break;
        }
        case "provider/remove":
          if (registry) {
            await ctxRef.secrets.delete(`${SECRET_PREFIX}${msg.providerId}`);
            registry.removeProvider(msg.providerId);
            persist?.();
            webview.postMessage({ type: "provider/list", providers: registry.listProviders() });
          }
          break;
        case "provider/toggle": {
          if (registry) {
            const p = registry.listProviders().find((x) => x.id === msg.providerId);
            if (p) { p.enabled = msg.enabled; registry.upsertProvider(p); persist?.(); }
            webview.postMessage({ type: "provider/list", providers: registry.listProviders() });
          }
          break;
        }
        case "config/get": {
          if (msg.key === "arc.search.fileCount") {
            webview.postMessage({ type: "config/get", value: searchProgress.filesIndexed, inReplyTo: msg.id });
            break;
          }
          if (msg.key === "arc.search.chunkCount") {
            webview.postMessage({ type: "config/get", value: searchProgress.chunksEmbedded, inReplyTo: msg.id });
            break;
          }
          const value = vscode.workspace.getConfiguration().get(msg.key);
          webview.postMessage({ type: "config/get", value, inReplyTo: msg.id });
          break;
        }
        case "config/set": {
          if (msg.key === "arc.model.multimodal.toggle") {
            const { modelId, enabled } = (msg.value as { modelId: string; enabled: boolean });
            const ids: string[] = vscode.workspace.getConfiguration().get<string[]>("arc.model.multimodalIds") ?? [];
            const set = new Set(ids);
            if (enabled) set.add(modelId); else set.delete(modelId);
            await vscode.workspace.getConfiguration().update("arc.model.multimodalIds", [...set], vscode.ConfigurationTarget.Global);
          } else {
            await vscode.workspace.getConfiguration().update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
          }
          break;
        }
        case "ui/attachSelection": {
          const ed = vscode.window.activeTextEditor;
          if (!ed) { webview.postMessage({ type: "error", message: "No active editor to attach." }); break; }
          const sel = ed.selection;
          const text = sel.isEmpty ? ed.document.lineAt(sel.active.line).text : ed.document.getText(sel);
          const uri = vscode.workspace.asRelativePath(ed.document.uri);
          const preview = sel.isEmpty ? `${uri}:${sel.active.line + 1}` : `${uri}:${sel.start.line + 1}-${sel.end.line + 1}`;
          webview.postMessage({ type: "session/attachment", uri, preview: `${preview}  ·  ${text.slice(0, 200)}` });
          break;
        }
        case "ui/showProblems":
          void vscode.commands.executeCommand("arc.toggleProblems");
          break;
        case "ui/openFullscreen":
          void (async () => {
            const wv = await openFullscreen();
            const action = (msg as any).show;
            if (wv && (action === "settings" || action === "search")) {
              await new Promise((r) => setTimeout(r, 800));
              wv.postMessage({ type: action === "settings" ? "ui/showSettings" : "ui/showSearch" } as HostMsg);
            }
          })();
          break;
        case "ui/openSettings":
          webview.postMessage({ type: "ui/showSettings" });
          break;
        case "ui/openFile": {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (root) {
            const fileUri = vscode.Uri.joinPath(root, msg.path);
            try { await vscode.window.showTextDocument(fileUri); } catch {  }
          }
          break;
        }
        case "ui/openPrompt":
          void vscode.commands.executeCommand("arc.managePrompts");
          break;
        case "ui/openSidebar":
          void vscode.commands.executeCommand("arc.openSidebar");
          break;
        case "ui/newTask":
          void vscode.commands.executeCommand("arc.newTask");
          break;
        case "chat/new": {
          await initReady;
          if (chatHistory) {
            const c = chatHistory.create();
            persist?.();
            void persistAsync?.();
            broadcastChatListAll();
            switchToChat(c.id, webview);
          }
          break;
        }
        case "chat/switch": {
          await initReady;
          if (chatHistory) {
            const c = chatHistory.switch(msg.chatId);
            persist?.();
            void persistAsync?.();
            broadcastChatListAll();
            if (c) switchToChat(c.id, webview);
          }
          break;
        }
        case "chat/rename": {
          await initReady;
          if (chatHistory) {
            chatHistory.rename(msg.chatId, msg.title);
            persist?.();
            void persistAsync?.();
            broadcastChatListAll();
          }
          break;
        }
        case "chat/delete": {
          await initReady;
          if (chatHistory) {
            chatHistory.remove(msg.chatId);
            chatSessions.delete(msg.chatId);
            chatTotals.delete(msg.chatId);
            persist?.();
            void persistAsync?.();
            broadcastChatListAll();
            if (!chatHistory.current()) {
              const first = chatHistory.list()[0];
              if (first) switchToChat(first.id, webview);
            }
          }
          break;
        }
        case "chat/compact": {
          void awaitAgent(sidebarSession).then((a) => a?.continue());
          break;
        }
        case "search/reindex": {
          void reindexWorkspace(webview);
          break;
        }
        case "mcp/list": {
          if (mcp) {
            const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
            webview.postMessage({ type: "mcp/list", servers: list });
          }
          break;
        }
        case "mcp/addServer": {
          if (mcp) {
            await mcp.addServer({ name: msg.name, enabled: true, transport: msg.transport });
            await persistMcpConfig(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
            const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
            webview.postMessage({ type: "mcp/list", servers: list });
          }
          break;
        }
        case "mcp/toggleServer": {
          if (mcp) {
            mcp.enableServer(msg.name, msg.enabled);
            await persistMcpConfig(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
            const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
            webview.postMessage({ type: "mcp/list", servers: list });
          }
          break;
        }
        case "mcp/removeServer": {
          if (mcp) {
            await mcp.removeServer(msg.name);
            await persistMcpConfig(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
            const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
            webview.postMessage({ type: "mcp/list", servers: list });
          }
          break;
        }
        case "mcp/marketplaceSearch": {
          try {
            const q = encodeURIComponent(msg.query ?? "");
            const url = `https://registry.modelcontextprotocol.io/v0.1/servers?version=latest&limit=50${q ? "&search=" + q : ""}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) { webview.postMessage({ type: "mcp/marketplaceResults", error: `HTTP ${res.status}` }); break; }
            const data = await res.json();
            const servers = (data.servers ?? []).sort((a: any, b: any) => {
              const sa = a._meta?.["io.modelcontextprotocol.registry/official"]?.status ?? "";
              const sb = b._meta?.["io.modelcontextprotocol.registry/official"]?.status ?? "";
              if (sa !== sb) return sa === "active" ? -1 : sb === "active" ? 1 : 0;
              const haPackagesA = a.server?.packages?.length > 0 ? 1 : 0;
              const haPackagesB = b.server?.packages?.length > 0 ? 1 : 0;
              if (haPackagesA !== haPackagesB) return haPackagesB - haPackagesA;
              const haRemotesA = a.server?.remotes?.length > 0 ? 1 : 0;
              const haRemotesB = b.server?.remotes?.length > 0 ? 1 : 0;
              if (haRemotesA !== haRemotesB) return haRemotesB - haRemotesA;
              return (a.server?.name ?? "").localeCompare(b.server?.name ?? "");
            });
            webview.postMessage({ type: "mcp/marketplaceResults", results: servers });
          } catch (e: any) { webview.postMessage({ type: "mcp/marketplaceResults", error: e.message || "Unknown error" }); }
          break;
        }
        case "mcp/testCall": {
          if (mcp) {
            const srvName = String(msg.server);
            const servers = mcp.listServers();
            const server = servers.find((s) => s.name === srvName);
            if (!server) {
              webview.postMessage({ type: "mcp/testResult", server: srvName, output: `Server '${srvName}' not found.` });
            } else {
              const info = `Server: ${server.name}
Transport: ${JSON.stringify(server.transport)}
Status: ${server.status}
Tools: ${server.tools?.length ?? 0}
Resources: ${server.resources?.length ?? 0}
Prompts: ${server.prompts?.length ?? 0}`;
              webview.postMessage({ type: "mcp/traffic", server: srvName, dir: "out", msg: "health check" });
              webview.postMessage({ type: "mcp/traffic", server: srvName, dir: "in", msg: `status=${server.status} tools=${server.tools?.length ?? 0}` });
              webview.postMessage({ type: "mcp/testResult", server: srvName, output: info });
            }
          }
          break;
        }
        case "memory/list": {
          try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const entries = await loadMemory(root);
            const memories = entries.map((e, i) => ({ index: i, category: e.category, content: e.content, createdAt: e.createdAt }));
            webview.postMessage({ type: "memory/list", memories });
          } catch {}
          break;
        }
        case "memory/delete": {
          try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            await deleteMemory(root, Number(msg.index));
            const entries = await loadMemory(root);
            const memories = entries.map((e, i) => ({ index: i, category: e.category, content: e.content, createdAt: e.createdAt }));
            webview.postMessage({ type: "memory/list", memories });
          } catch {}
          break;
        }
        case "hooks/list": {
          try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const hooksPath = path.join(root, ".arc", "hooks.json");
            const raw = await fs.readFile(hooksPath, "utf-8");
            const hooks = JSON.parse(raw);
            const list = Array.isArray(hooks) ? hooks : (hooks.hooks ?? Object.values(hooks).flat());
            webview.postMessage({ type: "hooks/list", hooks: list });
          } catch {
            webview.postMessage({ type: "hooks/list", hooks: [] });
          }
          break;
        }
        case "approval/response": {
          const p = pendingApprovals.get(msg.id);
          if (p) {
            pendingApprovals.delete(msg.id);
            if (msg.rememberPrefix) p.session.agent?.addCommandPrefix(msg.rememberPrefix);
            if (msg.rememberCommand) p.session.agent?.addSessionCommand(msg.rememberCommand);
            p.resolve(msg.allowed);
          }
        }
        break;
        case "approval/setPreset": {
          if (msg.preset === "readonly" || msg.preset === "safe-edit" || msg.preset === "dev" || msg.preset === "autonomous" || msg.preset === "full-trust") {
            approvalsConfig.preset = msg.preset as import("@arc/host").ApprovalPreset;
          } else {
            delete approvalsConfig.preset;
          }
          broadcastAll({ type: "session/message", message: { id: `preset-${Date.now()}`, role: "system", content: `Approval preset set to: ${msg.preset}`, ts: Date.now() } });
        }
        break;
        case "autoApprove/toggle": {
          const agent = await ensureAgent(session);
          if (agent) {
            const active = agent.toggleAutoApprove();
            broadcast(session, { type: "autoApproveState", active });
          }
          break;
        }
        case "chat/search": {
          if (chatHistory) {
            const results = chatHistory.search(msg.query);
            webview.postMessage({
              type: "chat/searchResults",
              results: results.map((r) => ({
                id: r.chat.id,
                title: r.chat.title,
                matches: r.matches.map((m) => m.text),
              })),
            });
          }
          break;
        }
        case "chat/resume": {
          const targetId = (msg as any).id as string | undefined;
          if (targetId && chatHistory) {
            const chat = chatHistory.switch(targetId);
            if (chat) {
              persist();
              const msgs = chatHistory.getMessages(targetId);
              const steps = chatHistory.getSteps(targetId);
              webview.postMessage({
                type: "session/init",
                sessionId: session.id,
                chatId: targetId,
                models: registry?.list() ?? [],
                currentModelId: registry?.getCurrent()?.id ?? "",
                modes: modeRegistry ? modeRegistry.list().map((m: any) => ({ slug: m.slug, description: m.description })) : [],
                currentMode: session.agent?.getCurrentMode?.() ?? "code",
              });
              for (const m of (msgs ?? []) as ChatMessage[]) {
                webview.postMessage({ type: "session/message", message: m, sessionId: session.id });
              }
              for (const s of (steps ?? []) as ProcessStep[]) {
                webview.postMessage({ type: "session/step", step: s, sessionId: session.id });
              }
            }
          }
          break;
        }
      }
    } catch (e) {
      log.appendLine(`[arc] message handler error: ${(e as Error)?.stack ?? e}`);
try { webview.postMessage({ type: "error", message: (e as Error).message }); } catch {  }
    }
  });
}
function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, mode: "sidebar" | "fullscreen"): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "styles.css"));
  const monoLogo = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "assets", "arc-logo-mono.svg"));
  const prideLogo = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "assets", "arc-logo-pride.svg"));
  const monoLogoText = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "assets", "arc-logo-mono-text.svg"));
  const prideLogoText = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "assets", "arc-logo-pride-text.svg"));
  const extVersion = ctxRef?.extension?.packageJSON?.version ?? "0.0.0";
  const isPride = new Date().getUTCMonth() === 5;
  const favicon = isPride ? prideLogo : monoLogo;
  const nonce = String(Math.random()).slice(2);
  return `<!doctype html>
<html lang="en" data-mode="${mode}">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};" />
  <link rel="icon" type="image/svg+xml" href="${favicon}" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="root" data-mode="${mode}" data-mono="${monoLogo}" data-pride="${prideLogo}" data-mono-text="${monoLogoText}" data-pride-text="${prideLogoText}" data-pride-active="${isPride}" data-version="${extVersion}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
async function generateTitleViaOllama(firstMessage: string): Promise<string | null> {
  try {
    const base = (vscode.workspace.getConfiguration().get<string>("arc.search.ollamaUrl", "http://127.0.0.1:11434")).replace(/\/$/, "");
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gemma3:1b",
        messages: [{
          role: "user",
          content: `Output ONLY a short title (3-8 words, Title Case). No bullets, no options, no explanation — just the title.\n\n${firstMessage}`,
        }],
        stream: false,
        options: { temperature: 0 },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json() as { message?: { content?: string } };
    const raw = j.message?.content?.trim() || "";
    if (!raw) return null;
    const boldMatch = raw.match(/\*\s+\*?\*?([^*\n]+)\*?\*?/);
    if (boldMatch) return boldMatch[1].replace(/\*+$/, "").trim() || null;
    const lineMatch = raw.match(/^([^\n*]+)/m);
    if (lineMatch && !/^here are/i.test(lineMatch[1])) {
      return lineMatch[1].trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}
async function hydrateMcp(mcp: McpAggregator, root: string) {
  const fs = await import("node:fs/promises");
  const pth = await import("node:path");
  const file = pth.join(getWorkspaceArcDir(root), "mcp.json");
  try {
    const raw = await fs.readFile(file, "utf-8");
    const j = JSON.parse(raw) as { mcpServers?: Record<string, { transport: import("@arc/host").McpTransport; enabled?: boolean }> };
    for (const [name, def] of Object.entries(j.mcpServers ?? {})) {
      try {
        await mcp.addServer({ name, enabled: def.enabled ?? true, transport: def.transport });
      } catch (e) {
        log.appendLine(`[arc] failed to start MCP server '${name}': ${(e as Error)?.message ?? e}`);
      }
    }
} catch {  }
}
async function persistMcpConfig(mcp: McpAggregator, root: string) {
  const fs = await import("node:fs/promises");
  const pth = await import("node:path");
  const file = pth.join(getWorkspaceArcDir(root), "mcp.json");
  const servers = mcp.listServers();
  const out = { mcpServers: Object.fromEntries(servers.map((s) => [s.name, { enabled: s.enabled, transport: s.transport }])) };
  await fs.mkdir(pth.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(out, null, 2), "utf-8");
}
function getAllWebviews(): vscode.Webview[] {
  const out: vscode.Webview[] = [];
  if (sidebarSession.view) out.push(sidebarSession.view.webview);
  if (sidebarSession.panel) out.push(sidebarSession.panel.webview);
  for (const [, s] of fullscreenSessions) {
    if (s.view) out.push(s.view.webview);
    if (s.panel) out.push(s.panel.webview);
  }
  return out;
}
export function deactivate() {
  if (sidebarSession.agent && sidebarSession.agent.getMessages()?.length) {
    void ctxRef?.globalState.update("arc.agentState", sidebarSession.agent.snapshot());
  }
  void mcp?.dispose();
  void browser?.close();
}
async function maybeDescribeImages(text: string, images?: string[]): Promise<{ text: string; images: string[] | undefined; descriptions?: string[] }> {
  if (!images?.length) return { text, images };
  const currentModel = registry?.getCurrent();
  if (!currentModel) return { text, images };
  const multimodalIds = vscode.workspace.getConfiguration().get<string[]>("arc.model.multimodalIds") ?? [];
  if (multimodalIds.includes(currentModel.id)) return { text, images };
  const describer = vscode.workspace.getConfiguration().get<string>("arc.image.describeModel") ?? "none";
  if (describer === "none") return { text, images: undefined };
  const descriptions: string[] = [];
  for (const dataUrl of images) {
    try {
      const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) continue;
      const desc = await callOllamaDescribe(describer, match[2], text);
      if (desc) descriptions.push(desc);
    } catch {}
  }
  if (!descriptions.length) return { text, images: undefined };
  return { text, images: undefined, descriptions };
}
async function callOllamaDescribe(model: string, base64data: string, _userPrompt: string): Promise<string | undefined> {
  const url = (vscode.workspace.getConfiguration().get<string>("arc.image.ollamaUrl") ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: "Describe this image in 2-3 sentences. Focus on what would be relevant for a coding assistant to know: UI elements, code screenshots, error messages, diagrams, etc.",
          images: [base64data],
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return undefined;
  const json = await res.json() as { message?: { content?: string } };
  return json.message?.content?.trim();
}
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  ModelRegistry, Agent, CheckpointStore, LspBridge, McpAggregator,
  makeVSCodeNotifier, setNotifier, notify, loadWorkspacePrompts, loadGlobalPrompts, mergePrecedence, render, injectRelevantRules,
  pickLogo, ChatHistory, createBrowser, getWorkspaceArcDir,
  type PrideMode,
  ModeRegistry, DEFAULT_APPROVALS, loadApprovalsMemory, saveApprovalPrefix,
  SkillRegistry,
  generateDependencyGraph, formatDepGraph,
  RuleRegistry, loadMemory, deleteMemory,
  type ChatSnapshot, type ChatMessage, type BrowserAdapter,
  type HostMsg, type WebviewMsg, type ModelDescriptor, type ProviderConfig, type ProcessStep, type ApprovalsConfig,
  Indexer, HashEmbeddingBackend, OllamaEmbeddingBackend, DEFAULT_EMBEDDING_MODELS,
  type IndexProgress, type EmbeddingBackend,
  IndexWatcher,
  FileContextTracker,
  completeSamplingRequest,
  type SamplingCreateMessageParams,
  listBackgroundProcesses,
  auditLogPath, verifyAuditLogFile,
} from "@arc/host";
import { PROVIDERS } from "@arc/host/catalog";
import { initDiscordRpcSpoof, reportAgentActivity, reportAgentIdle } from "./discord-rpc.js";
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
let ruleWatcherDispose: (() => void) | undefined;
let fileContextTracker: FileContextTracker;
let persist: () => void;
let persistAsync: () => Promise<void>;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const serverProcesses = new Map<string, ChildProcess>();
function debouncedPersist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persist?.();
    void persistAsync?.();
  }, 5000);
}
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
const DIFF_PREVIEW_SCHEME = "arc-diff-preview";
const diffPreviewContents = new Map<string, string>();
let browser: BrowserAdapter | undefined;
let browserPromise: Promise<BrowserAdapter> | undefined;
let browserIdleTimer: ReturnType<typeof setTimeout> | undefined;
const BROWSER_IDLE_MS = 5 * 60 * 1000;
let inlineCommentController: vscode.CommentController | undefined;
const inlineChatSessions = new Map<vscode.CommentThread, Session>();
const mcpSamplingAllowedServers = new Set<string>();
const inlineHeaderComments = new Map<vscode.CommentThread, InlineComment>();
const inlineChatModelChoice = new Map<vscode.CommentThread, ModelDescriptor>();
const inlineCommentThreadByComment = new WeakMap<vscode.Comment, vscode.CommentThread>();
class InlineComment implements vscode.Comment {
  constructor(
    public body: string | vscode.MarkdownString,
    public mode: vscode.CommentMode,
    public author: vscode.CommentAuthorInformation,
    public contextValue?: string,
  ) {}
}
function updateLastInlineComment(thread: vscode.CommentThread, body: string): void {
  const comments = thread.comments.slice(0, -1) as InlineComment[];
  const md = new vscode.MarkdownString(body);
  md.isTrusted = false;
  thread.comments = [...comments, new InlineComment(md, vscode.CommentMode.Preview, { name: "Arc" })];
}
function resetBrowserIdleTimer(): void {
  clearTimeout(browserIdleTimer);
  browserIdleTimer = setTimeout(() => {
    if (browser) {
      void browser.close().then(() => { browser = undefined; browserPromise = undefined; });
    }
  }, BROWSER_IDLE_MS);
}
function getBrowser(): Promise<BrowserAdapter> {
  resetBrowserIdleTimer();
  if (browser) return Promise.resolve(browser);
  if (!browserPromise) {
    browserPromise = createBrowser("chromium", true).then((b) => {
      browser = b;
      return b;
    });
  }
  return browserPromise;
}
let searchIndexer: Indexer | undefined;
let searchProgress: IndexProgress = { filesScanned: 0, filesIndexed: 0, chunksEmbedded: 0, errors: 0 };
let searchAbort: AbortController | undefined;
let indexWatcher: IndexWatcher | undefined;
let indexWatcherSaveTimer: ReturnType<typeof setTimeout> | undefined;
let autoReindexTimer: ReturnType<typeof setInterval> | undefined;
let approvalsConfig: ApprovalsConfig = { ...DEFAULT_APPROVALS };
let pendingAgentState: { messages: unknown[]; steps: unknown[]; mode: string; todoItems: unknown[] } | undefined;
function webviewResourceRoots(context: vscode.ExtensionContext): vscode.Uri[] {
  return [
    vscode.Uri.joinPath(context.extensionUri, "dist"),
    vscode.Uri.joinPath(context.extensionUri, "assets"),
  ];
}
export function activate(context: vscode.ExtensionContext) {
  ctxRef = context;
  log = vscode.window.createOutputChannel("Arc");
  context.subscriptions.push(log);
  modeRegistry = new ModeRegistry(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  skillRegistry = new SkillRegistry(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  ruleRegistry = new RuleRegistry(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  fileContextTracker = new FileContextTracker({ dbPath: path.join(getWorkspaceArcDir(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()), "context.db") });
  Promise.allSettled([
    modeRegistry.load(),
    skillRegistry.load().then(() => { skillRegistryReady = Promise.resolve(); }),
    ruleRegistry.load(),
    fileContextTracker.load(),
  ]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") {
        log.appendLine(`[arc] Registry load failed: ${(r.reason as Error)?.stack ?? r.reason}`);
      }
    }
    ruleWatcherDispose = ruleRegistry.watch((diff) => {
      const parts: string[] = [];
      if (diff.added.length) parts.push(`added: ${diff.added.join(", ")}`);
      if (diff.changed.length) parts.push(`changed: ${diff.changed.join(", ")}`);
      if (diff.removed.length) parts.push(`removed: ${diff.removed.join(", ")}`);
      const note = `[Rules updated] ${parts.join("; ")}`;
      log.appendLine(`[arc] ${note}`);
      for (const s of [sidebarSession, ...fullscreenSessions.values()]) {
        s.agent?.injectSystemNote?.(note);
      }
    });
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
  const prideMode: PrideMode = vscode.workspace.getConfiguration().get<PrideMode>("arc.appearance.prideLogo", "june") ?? "june";
  const logo = pickLogo(prideMode);
  inlineCommentController = vscode.comments.createCommentController("arc.inlineChat", "Arc Inline Chat");
  inlineCommentController.options = { prompt: "Describe the edit to make", placeHolder: "e.g. Extract this into a helper function" };
  context.subscriptions.push(inlineCommentController);
  void vscode.commands.executeCommand("setContext", "arc.isPrideMonth", logo.kind === "pride");
  const sidebarProvider: vscode.WebviewViewProvider = {
    async resolveWebviewView(webviewView: vscode.WebviewView) {
      try {
        sidebarSession.view = webviewView;
        webviewView.webview.options = {
          enableScripts: true,
          localResourceRoots: webviewResourceRoots(context),
        };
        webviewView.webview.html = getWebviewHtml(webviewView.webview, context.extensionUri, "sidebar");
        wireWebview(webviewView.webview, sidebarSession);
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
  vscode.commands.registerCommand("arc.auditLog.export", async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const src = auditLogPath(root);
    try {
      await fs.access(src);
    } catch {
      void vscode.window.showInformationMessage("No audit log has been recorded for this workspace yet.");
      return;
    }
    const dest = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`arc-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`),
      filters: { "Audit log": ["jsonl"] },
    });
    if (!dest) return;
    await fs.copyFile(src, dest.fsPath);
    void vscode.window.showInformationMessage(`Audit log exported to ${dest.fsPath}`);
  });
  vscode.commands.registerCommand("arc.auditLog.verify", async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { "Audit log": ["jsonl"] },
      openLabel: "Verify",
    });
    if (!picked?.length) return;
    const result = await verifyAuditLogFile(picked[0].fsPath);
    if (result.ok) {
      void vscode.window.showInformationMessage(`Audit log verified: ${result.entries} entries, hash chain intact.`);
    } else {
      void vscode.window.showErrorMessage(`Audit log verification FAILED at sequence ${result.brokenAtSeq}: ${result.reason}`);
    }
  });
  vscode.commands.registerCommand("arc.explainSelection", async () => {
    if (!ctxRef) return;
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.selection.isEmpty) return;
    const text = ed.document.getText(ed.selection);
    const uri = vscode.workspace.asRelativePath(ed.document.uri);
    const prompt = `Explain the following code from ${uri}:\n\n\`\`\`${ed.document.languageId}\n${text}\n\`\`\``;
    await sendToArc(prompt);
  });
  vscode.commands.registerCommand("arc.fixSelection", async (uri?: vscode.Uri, range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
    if (!ctxRef) return;
    const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
    if (!doc) return;
    const ed = vscode.window.activeTextEditor;
    const effectiveRange = range ?? (ed && !ed.selection.isEmpty ? new vscode.Range(ed.selection.start, ed.selection.end) : undefined);
    if (!effectiveRange) return;
    const lineRange = effectiveRange.isEmpty ? doc.lineAt(effectiveRange.start.line).range : effectiveRange;
    const text = doc.getText(lineRange);
    const relUri = vscode.workspace.asRelativePath(doc.uri);
    const diags = diagnostics ?? vscode.languages.getDiagnostics(doc.uri).filter((d) => !!lineRange.intersection(d.range));
    const diagText = diags.length
      ? `\n\nDiagnostics in range:\n${diags.map((d) => `- [${vscode.DiagnosticSeverity[d.severity]}] ${d.message} (line ${d.range.start.line + 1})`).join("\n")}`
      : "";
    const prompt = `Fix the following code from ${relUri}:\n\n\`\`\`${doc.languageId}\n${text}\n\`\`\`${diagText}`;
    await sendToArc(prompt);
  });
  vscode.commands.registerCommand("arc.inlineChat", async () => {
    if (!ctxRef || !inlineCommentController) return;
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const range = ed.selection.isEmpty
      ? new vscode.Range(ed.selection.active.line, 0, ed.selection.active.line, 0)
      : new vscode.Range(ed.selection.start, ed.selection.end);
    const thread = inlineCommentController.createCommentThread(ed.document.uri, range, []);
    thread.label = "Arc";
    thread.canReply = true;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.contextValue = "arcInlineThread";
    const currentModel = inlineChatModelChoice.get(thread) ?? registry?.getCurrent();
    const header = new InlineComment(
      new vscode.MarkdownString(""),
      vscode.CommentMode.Preview,
      { name: currentModel?.label ?? "Select a model" },
      "arcModelHeader",
    );
    inlineHeaderComments.set(thread, header);
    inlineCommentThreadByComment.set(header, thread);
    thread.comments = [header];
  });
  vscode.commands.registerCommand("arc.inlineChat.pickModel", async (comment: vscode.Comment) => {
    const thread = inlineCommentThreadByComment.get(comment);
    if (!thread || !registry) return;
    const modelList = registry.list();
    if (!modelList.length) {
      void vscode.window.showInformationMessage("No models configured yet. Add one in Arc settings.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      modelList.map((m) => ({ label: m.label, description: m.tier, model: m })),
      { title: "Switch model for this inline edit" },
    );
    if (!picked) return;
    inlineChatModelChoice.set(thread, picked.model);
    const session = inlineChatSessions.get(thread);
    if (session?.agent) session.agent.setModelOverride(picked.model);
    const header = new InlineComment(
      new vscode.MarkdownString(""),
      vscode.CommentMode.Preview,
      { name: picked.model.label },
      "arcModelHeader",
    );
    inlineHeaderComments.set(thread, header);
    inlineCommentThreadByComment.set(header, thread);
    thread.comments = [header, ...thread.comments.slice(1)];
  });
  vscode.commands.registerCommand("arc.inlineChat.submit", async (reply: vscode.CommentReply) => {
    const thread = reply.thread;
    const instruction = reply.text.trim();
    if (!instruction) return;
    const doc = await vscode.workspace.openTextDocument(thread.uri);
    const hasSelection = !thread.range.isEmpty;
    const selectedText = hasSelection ? doc.getText(thread.range) : "";
    const line = thread.range.start.line + 1;
    const uriLabel = vscode.workspace.asRelativePath(thread.uri);
    const userComment = new InlineComment(instruction, vscode.CommentMode.Preview, { name: "You" });
    const pendingComment = new InlineComment(new vscode.MarkdownString("_Arc is thinking..._"), vscode.CommentMode.Preview, { name: "Arc" });
    thread.comments = [...thread.comments, userComment, pendingComment];
    let session = inlineChatSessions.get(thread);
    if (!session) {
      session = { id: `inline-${Date.now()}-${Math.random().toString(36).slice(2)}`, agent: undefined as unknown as Agent, steps: [], messages: [] };
      inlineChatSessions.set(thread, session);
    }
    await initReady;
    const agent = await ensureAgent(session);
    if (!agent) {
      updateLastInlineComment(thread, "Arc is unavailable right now.");
      return;
    }
    const chosenModel = inlineChatModelChoice.get(thread);
    if (chosenModel) agent.setModelOverride(chosenModel);
    const codeContext = hasSelection
      ? `Selected code (lines ${thread.range.start.line + 1}-${thread.range.end.line + 1}):\n\`\`\`${doc.languageId}\n${selectedText}\n\`\`\``
      : (() => {
          const cursorLine = thread.range.start.line;
          const startLine = Math.max(0, cursorLine - 15);
          const endLine = Math.min(doc.lineCount - 1, cursorLine + 15);
          const windowText = doc.getText(new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length));
          return `Cursor at line ${line} (no selection). Surrounding code (lines ${startLine + 1}-${endLine + 1}), use file.read for more if needed:\n\`\`\`${doc.languageId}\n${windowText}\n\`\`\``;
        })();
    const prompt = `Inline edit request for ${uriLabel}.\n${codeContext}\n\nInstruction: ${instruction}\n\nEdit ${uriLabel} directly using file.edit to satisfy the instruction. The SEARCH block must match the file's on-disk content exactly (re-read the file with file.read first if unsure). Keep changes minimal and scoped to this request.`;
    try {
      await agent.send(prompt);
      const lastAssistant = [...session.messages].reverse().find((m) => (m as { role?: string }).role === "assistant" && (m as { content?: string }).content);
      const editedFiles = new Set<string>();
      for (const step of session.steps) {
        const s = step as { type?: string; toolName?: string; filePath?: string; args?: Record<string, unknown> };
        if (s.type === "tool" && (s.toolName === "file.edit" || s.toolName === "file.write")) {
          const p = s.filePath ?? (s.args?.path as string | undefined);
          if (p) editedFiles.add(p);
        }
      }
      const summaryParts: string[] = [];
      if (lastAssistant) summaryParts.push(String((lastAssistant as { content?: string }).content ?? ""));
      if (editedFiles.size) summaryParts.push(`\n**Edited:** ${[...editedFiles].join(", ")}`);
      updateLastInlineComment(thread, summaryParts.join("\n").trim() || "Done.");
    } catch (err) {
      updateLastInlineComment(thread, `Error: ${(err as Error).message}`);
    }
  });
  vscode.commands.registerCommand("arc.inlineChat.cancel", (thread: vscode.CommentThread) => {
    const session = inlineChatSessions.get(thread);
    if (session) {
      chatHistory?.remove(session.id);
      inlineChatSessions.delete(thread);
    }
    inlineHeaderComments.delete(thread);
    inlineChatModelChoice.delete(thread);
    thread.dispose();
  });
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider("*", {
      provideCodeActions(document, range, ctx) {
        const actions: vscode.CodeAction[] = [];
        if (!range.isEmpty) {
          const explain = new vscode.CodeAction("Explain with Arc", vscode.CodeActionKind.Empty);
          explain.command = { command: "arc.explainSelection", title: "Explain with Arc" };
          actions.push(explain);
        }
        if (ctx.diagnostics.length) {
          const fix = new vscode.CodeAction(`Fix with Arc: ${ctx.diagnostics[0].message}`.slice(0, 80), vscode.CodeActionKind.QuickFix);
          fix.command = { command: "arc.fixSelection", title: "Fix with Arc", arguments: [document.uri, range, [...ctx.diagnostics]] };
          fix.diagnostics = [...ctx.diagnostics];
          fix.isPreferred = true;
          actions.push(fix);
        }
        return actions;
      },
    }, { providedCodeActionKinds: [vscode.CodeActionKind.Empty, vscode.CodeActionKind.QuickFix] }),
  );
  void vscode.commands.executeCommand("setContext", "arc.showProblems", false);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_PREVIEW_SCHEME, {
      provideTextDocumentContent(uri: vscode.Uri): string {
        const id = new URLSearchParams(uri.query).get("id");
        if (!id) return "";
        return diffPreviewContents.get(id) ?? "";
      },
    }),
  );
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
    if (e.affectsConfiguration("arc.appearance.prideLogo")) {
      const prideMode: PrideMode = vscode.workspace.getConfiguration().get<PrideMode>("arc.appearance.prideLogo", "june") ?? "june";
      const logo = pickLogo(prideMode);
      void vscode.commands.executeCommand("setContext", "arc.isPrideMonth", logo.kind === "pride");
    }
    if (e.affectsConfiguration("arc")) persist();
    if (e.affectsConfiguration("arc.indexing.autoWatch") || e.affectsConfiguration("arc.search.enabled")) {
      startIndexWatcherIfEnabled();
    }
    if (e.affectsConfiguration("arc.search.autoReindex")) {
      scheduleAutoReindex();
    }
  }));
  store = new CheckpointStore({ dir: context.globalStorageUri.fsPath });
  lsp = new LspBridge(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  mcp = new McpAggregator();
  mcp.setPersistence(() => persistMcpConfig(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()));
  mcp.setRoots((vscode.workspace.workspaceFolders ?? []).map((f) => ({ uri: f.uri.toString(), name: f.name })));
  mcp.setSamplingHandler(async (serverName, params) => {
    if (!mcpSamplingAllowedServers.has(serverName)) {
      const pick = await vscode.window.showWarningMessage(
        `MCP server '${serverName}' wants to send a prompt to your configured model (sampling). Allow?`,
        { modal: true },
        "Allow Once", "Always Allow",
      );
      if (pick === "Always Allow") mcpSamplingAllowedServers.add(serverName);
      else if (pick !== "Allow Once") throw new Error("Sampling request denied by user.");
    }
    return completeSamplingRequest(registry, params as SamplingCreateMessageParams, { proxyUrl: resolveProxy("providerUrl") ?? resolveProxy("url") });
  });
  mcp.onChange(() => {
    const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
    for (const webview of getAllWebviews()) {
      webview.postMessage({ type: "mcp/list", servers: list });
    }
  });
  setNotifier(makeVSCodeNotifier());
  initDiscordRpcSpoof(context);
  const savedState = context.globalState.get<{ messages: unknown[]; steps: unknown[]; mode: string; todoItems: unknown[] }>("arc.agentState");
  pendingAgentState = savedState;
  const currentChat = chatHistory.ensure(chatHistory.current());
  sidebarSession.id = currentChat.id;
  chatSessions.set(currentChat.id, sidebarSession);
  persist();
  setTimeout(() => { void tryLoadIndex(); }, 2000);
  scheduleAutoReindex();
  initResolve?.();
  setTimeout(() => {
    void hydrateMcp(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()).catch((err) => {
      log.appendLine(`[arc] MCP hydration failed: ${(err as Error)?.stack ?? err}`);
    });
  }, 3000);
}
async function waitForSidebarView(timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!sidebarSession.view && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function sendToArc(prompt: string): Promise<void> {
  await vscode.commands.executeCommand("arc.openSidebar");
  await waitForSidebarView();
  await initReady;
  const agent = await ensureAgent(sidebarSession);
  if (!agent) return;
  await agent.send(prompt);
}
async function openFullscreen(): Promise<vscode.Webview | undefined> {
  if (!ctxRef) return;
  for (const [, s] of fullscreenSessions) {
    if (s.panel) { s.panel.reveal(); return s.panel.webview; }
  }
  const panel = vscode.window.createWebviewPanel("arc.fullscreen", "Arc", vscode.ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: webviewResourceRoots(ctxRef),
  });
  const prideMode: PrideMode = vscode.workspace.getConfiguration().get<PrideMode>("arc.appearance.prideLogo", "june") ?? "june";
  const logoFile = pickLogo(prideMode).file;
  panel.iconPath = vscode.Uri.file(ctxRef.asAbsolutePath(`assets/${logoFile}`));
  panel.webview.html = getWebviewHtml(panel.webview, ctxRef.extensionUri, "fullscreen");
  const mapKey = `fullscreen-${Date.now()}`;
  const chatId = chatHistory.ensure(chatHistory.current()).id;
  const session: Session = { id: chatId, panel, agent: undefined as unknown as Agent, steps: [], messages: [] };
  fullscreenSessions.set(mapKey, session);
  wireWebview(panel.webview, session);
  panel.onDidDispose(() => {
    fullscreenSessions.delete(mapKey);
    chatSessions.delete(chatId);
  });
  return panel.webview;
}
function openSettings() {
  if (!ctxRef) return;
  if (sidebarSession.view) {
    sidebarSession.view.webview.postMessage({ type: "ui/showSettings" });
    return;
  }
  for (const [, s] of fullscreenSessions) {
    if (s.panel) { s.panel.webview.postMessage({ type: "ui/showSettings" }); return; }
  }
  openFullscreen().then(() => {
    for (const [, s] of fullscreenSessions) {
      if (s.panel) { s.panel.webview.postMessage({ type: "ui/showSettings" }); return; }
    }
  });
}
function newTask() {
  sidebarSession.messages = [];
  sidebarSession.steps = [];
  if (sidebarSession.agent) {
    sidebarSession.agent = undefined as unknown as Agent;
    sidebarSession.agentReady = undefined;
  }
  if (sidebarSession.view) {
    sidebarSession.view.webview.postMessage({ type: "chat/current", chatId: sidebarSession.id });
    sidebarSession.view.webview.postMessage({
      type: "session/init",
      sessionId: sidebarSession.id,
      models: registry?.list() ?? [],
      currentModelId: registry?.getCurrent()?.id ?? "",
      reasoningEffort: vscode.workspace.getConfiguration().get<string>("arc.reasoning.effort", "high") ?? "high",
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
function resolveWorkspaceFileUri(filePath: string): vscode.Uri | undefined {
  if (!filePath) return undefined;
  if (path.isAbsolute(filePath)) return vscode.Uri.file(path.normalize(filePath));
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return undefined;
  return vscode.Uri.joinPath(root, filePath);
}
function buildBeforeContentFromHunks(hunks: { added: boolean; removed: boolean; value: string }[]): string {
  let before = "";
  for (const h of hunks) {
    if (h.added && !h.removed) continue;
    before += h.value ?? "";
  }
  return before;
}
function createDiffPreviewUri(filePath: string, content: string): vscode.Uri {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  diffPreviewContents.set(id, content);
  while (diffPreviewContents.size > 64) {
    const oldest = diffPreviewContents.keys().next().value as string | undefined;
    if (!oldest) break;
    diffPreviewContents.delete(oldest);
  }
  return vscode.Uri.from({
    scheme: DIFF_PREVIEW_SCHEME,
    path: `/${path.basename(filePath)}`,
    query: `id=${encodeURIComponent(id)}`,
  });
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
function resolveProxy(kind: "url" | "providerUrl" | "webUrl" | "shellUrl"): string | undefined {
  const cfg = vscode.workspace.getConfiguration();
  const fallback = cfg.get<string>("arc.proxy.url") || undefined;
  if (kind === "url") return fallback;
  const specific = cfg.get<string>(`arc.proxy.${kind}`) || undefined;
  return specific || fallback;
}
const buildSystemPrompt = async (mcpAggregator?: McpAggregator): Promise<string> => {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const globalParts = await loadGlobalPrompts();
  const wsParts = await loadWorkspacePrompts(root);
  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  const staticParts = [...globalParts, ...wsParts];
  const withRules = injectRelevantRules(staticParts, activeFile);
  const volatileParts = withRules.filter((p) => !staticParts.includes(p));
  const basePrompt = `You are Arc, an agentic coding assistant. Be concise. Be precise.

## Communication
- STRICTLY FORBIDDEN from starting messages with "Great", "Certainly", "Okay", "Sure". Drop articles, filler, hedging, and pleasantries. Fragments OK.
- Technical terms, code, API names, CLI commands, and error strings are always verbatim.
- No emojis, no em dashes. Lists flat — no nested bullets. No tool-call narration. No "I'll now…" or "Let me…" filler. Do not refer to tool names when speaking to the user.
- EXCEPTIONS (revert to full sentences): security warnings, destructive op confirmations, multi-step sequences where fragment order risks misread, compression creates ambiguity, user asks to clarify.
- Default to action: assume the user wants implementation, not analysis. Stay with the work until handled — don't stop at halfway.

## Reasoning effort
- Scale thinking to the stakes, not the token budget. Spend depth where a wrong choice is expensive or hard to reverse; spend almost none where it is cheap and obvious.
- Minimal thinking: reading a file, running a known command, a one-line edit, answering a lookup. Act immediately — do not deliberate over how to run \`ls\` or which flag \`git status\` needs.
- Deep thinking: architecture and interface design, concurrency and data-loss risks, security-sensitive code, ambiguous requirements, debugging a failure whose cause you cannot yet see. Slow down, weigh alternatives, state assumptions.
- Do not re-derive facts already established this session, and do not re-verify a result the tool already confirmed. Reuse what you know.
- Show, don't tell: never announce how hard you are thinking or that you are being concise — just deliver the result. Uncertainty is worth stating; meta-commentary about your own process is not.

## Rules
- Respect existing conventions, libraries, and patterns. Let the codebase teach you how to move.
- Make precise, surgical changes that fully address the request. Implement completely — don't describe undone code.
- Discover bugs caused by your changes — fix those. Skip unrelated pre-existing issues.
- Add abstraction only when it removes real complexity, reduces meaningful duplication, or matches a local pattern.
- Don't over-engineer: no features, refactors, error handling, or validation beyond what the request needs. Trust internal code; validate only at system boundaries. A bug fix does not need surrounding cleanup.
- If a request is ambiguous, ask before acting. Reserve questions for decisions the codebase cannot answer; pick a sensible default for the rest.
- Write diagnostic-as-code: no comments unless the WHY is non-obvious.
- Never revert changes you did not make. Work with unrelated changes in files you touch.
- Never use destructive commands (git reset --hard, git checkout --) unless explicitly asked.

## Tool efficiency
- Prefer dedicated tools over shell.run: file.grep over rg/grep, file.glob over ls/find, file.read over cat/head/tail, web.fetch over curl.
- Use file.read to view images — the image data is included inline so vision-capable models can see it directly.
- Use offset/limit on file.read to target just the lines you need.
- SEARCH/REPLACE block format for file.edit:\n\npath/to/file.ts\n<<<<<<< SEARCH\nexact lines (include enough context for uniqueness)\n=======\nreplacement lines\n>>>>>>> REPLACE
- After successful file.edit or file.write, do NOT re-read to verify — the tool errors on failure. Trust the result. LSP diagnostics run automatically.
- Launch independent Read/Glob calls in parallel. Batch tool calls in one response.
- Reflect on command output before proceeding.

## Shell
- shell.run for short-lived commands, shell.backgroundRun for long-running processes (builds, servers, watchers).
- Poll with shell.check; send stdin with shell.write.
- Chain commands (&& on Unix, ; on PowerShell) instead of separate shell.run calls. Suppress pagers (git --no-pager, append | cat).
- Commit or push only when explicitly asked. If on the default branch, branch first.

## Tools
file.read, file.edit, file.write, file.grep, file.glob, shell.run, shell.backgroundRun, shell.check, shell.write, web.fetch, web.search, lsp.problems, lsp.problemsFor, todo.write, browser.*, mcp.call, checkpoint.revert, checkpoint.list, subagent.spawn, handoff, clarification.askUser, skill.read, skill.use, mode.switch, memory.add, memory.list, memory.edit, memory.delete, rule.list, rule.read, rule.create

## Memory & Rules
- Use memory.add to persist key facts, decisions, and patterns the user establishes. Retrieve with memory.list before starting work.
- Use rule.read and rule.list to recall workspace conventions and constraints before making changes.
- Rules are source code, not prose — write them as actionable constraints the agent must follow.

## Workflow
1. Understand the task. Use file.grep and file.glob to locate relevant code. Read files with file.read (use offset/limit for large files).
2. Plan-first for complex work: spans multiple files, architectural decisions, ambiguous scope — pause and ask "Plan first?" via clarification.askUser. If approved, produce a todo list, wait for sign-off, then execute. Update the plan dynamically — add, remove, reorder items as you learn. Mark items done after verifying.
3. For straightforward tasks: proceed directly. Keep exactly one todo item in_progress. Fix diagnostics in the same turn after edits.
4. Delegate grunt work to subagents — they are cheap. For independent investigations, launch multiple in one turn.
5. Self-check before finishing: if your last paragraph is a plan, analysis, or list of what remains, you are not done. Do the work now.
6. Do not create markdown files for planning — use todo.write.

## Output
- Lead with the outcome: your first sentence after tool work should answer what happened.
- Report outcomes directly: success stated plainly, failure stated with what went wrong. No hedging, no praise, no summary if nothing changed.
- Match length to change size: trivial/single-file edit → 1-3 sentences, no headings; a few files → up to ~6 bullets; large/multi-file → 1-2 bullets per file. Never inline full files or before/after pairs — reference paths and symbols.
- Reference code as \`file_path:line_number\` — clickable in the UI.`;
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
  const merged = mergePrecedence([{ scope: "global", body: basePrompt + mcpBlock }, ...staticParts]);
  if (skillRegistryReady) await skillRegistryReady;
  const skillsSection = skillRegistry ? skillRegistry.titlesForSystemPrompt() : "";
  const staticPrompt = render(merged, {
    workspace: root,
    os: process.platform,
    date: new Date().toISOString().slice(0, 10),
  }) + skillsSection;
  const volatileRules = volatileParts.length
    ? "\n\n---\n\n" + render(mergePrecedence(volatileParts), { workspace: root, os: process.platform, date: new Date().toISOString().slice(0, 10) })
    : "";
  const envBlock = `\n\n---\n\n## Environment\nWorking dir: ${root} | OS: ${process.platform} | Date: ${new Date().toISOString().slice(0, 10)}`;
  return staticPrompt + envBlock + volatileRules;
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
    proxyUrl: resolveProxy("url"),
    proxyWeb: resolveProxy("webUrl"),
    proxyShell: resolveProxy("shellUrl"),
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
            const match = lines[li].match(regex);
            if (match && match.length) {
              results.push({
                file: vscode.workspace.asRelativePath(uri),
                line: li + 1,
                column: (match.index ?? 0) + 1,
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
      return hits.map((h: { file: string; start: number; end: number; score: number; text: string }) => ({ file: h.file, start: h.start, end: h.end, score: h.score, snippet: h.text }));
    },
    describeImage: (dataUrl: string) => describeToolImage(dataUrl, registry?.getCurrent?.()),
    executeNotebookCell: async (relPath: string, cellIndex: number) => {
      try {
        const uri = resolveWorkspaceFileUri(relPath);
        if (!uri) return { ok: false, output: `Could not resolve notebook path: ${relPath}` };
        const notebook = await vscode.workspace.openNotebookDocument(uri);
        if (cellIndex < 0 || cellIndex >= notebook.cellCount) {
          return { ok: false, output: `Cell index ${cellIndex} out of range (notebook has ${notebook.cellCount} cell(s)).` };
        }
        const target = notebook.cellAt(cellIndex);
        if (target.kind !== vscode.NotebookCellKind.Code) {
          return { ok: false, output: `Cell ${cellIndex} is not a code cell.` };
        }
        await vscode.commands.executeCommand("notebook.cell.execute", { ranges: [{ start: cellIndex, end: cellIndex + 1 }], document: uri });
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const cell = notebook.cellAt(cellIndex);
          if (cell.executionSummary?.success !== undefined) break;
          await new Promise((r) => setTimeout(r, 300));
        }
        const finalCell = notebook.cellAt(cellIndex);
        const parts: string[] = [];
        const images: string[] = [];
        for (const out of finalCell.outputs) {
          for (const item of out.items) {
            if (item.mime.startsWith("image/")) images.push(`data:${item.mime};base64,${Buffer.from(item.data).toString("base64")}`);
            else parts.push(Buffer.from(item.data).toString("utf-8"));
          }
        }
        const ok = finalCell.executionSummary?.success !== false;
        return { ok, output: parts.join("\n").trim() || (ok ? "(cell executed with no text output)" : "Cell execution failed."), images };
      } catch (e: unknown) {
        return { ok: false, output: `Failed to execute cell: ${(e as Error).message}` };
      }
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
      const lastStep = steps[steps.length - 1];
      if (lastStep?.type === "tool" && (lastStep.toolName === "file.edit" || lastStep.toolName === "file.write" || lastStep.toolName === "file.read")) {
        const toolStep = lastStep as { toolName: string; args?: Record<string, unknown>; filePath?: string };
        const path = toolStep.filePath ?? (toolStep.args as Record<string, unknown>)?.path as string | undefined;
        if (path) reportAgentActivity("edit", path);
      }
    },
    stepUpdate: (step) => {
      broadcast(session, { type: "session/stepUpdate", step, sessionId: sinkId });
    },
    turnStart: (turnId) => {
      broadcast(session, { type: "session/turnStart", turnId, sessionId: sinkId });
      reportAgentActivity("think");
    },
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
      debouncedPersist();
    },
    handoff: (fromModel, toModel, reason) => {
      notify("handoff", `${fromModel} → ${toModel}: ${reason}`);
      broadcast(session, { type: "session/handoff", fromModel, toModel, reason });
    },
    todo: (items) => broadcast(session, { type: "todo/update", items: items as { id: string; text: string; state: "pending" | "in_progress" | "done" | "skipped" }[] }),
    clarification: (id, question, options) => broadcast(session, { type: "session/clarification", id, question, options }),
    done: () => {
      notify("done", "Task complete");
      if (chatHistory) chatHistory.setMessages(session.id, session.agent.getMessages());
      clearTimeout(persistTimer);
      void persistAsync?.();
      broadcast(session, { type: "session/done" });
      reportAgentIdle();
    },
    guidance: (text) => broadcast(session, { type: "session/guidance", text }),
    error: (message) => {
      const code = classifyError(message);
      notify("error", message);
      broadcast(session, { type: "error", message, ...(code ? { code } : {}) });
    },
    compaction: (before, after, reason) => broadcast(session, { type: "session/compaction", before, after, reason }),
  };
  session.agent = new Agent(registry, store, sink, {
    systemPrompt,
    enabledTools: new Set([
      "file.read", "file.edit", "file.write", "file.grep", "file.glob",       "shell.run", "shell.backgroundRun", "shell.check", "shell.write", "shell.customRun", "shell.editCustomRun", "shell.runCustomRun",
      "test.run", "web.fetch", "web.search",
      "lsp.problems", "lsp.problemsFor",
      "todo.write",
      "browser.navigate", "browser.click", "browser.type", "browser.screenshot", "browser.evaluate", "browser.readDom", "browser.close", "browser.hover", "browser.scroll", "browser.waitFor",
      "browser.console", "browser.network", "browser.domSnapshot",
      "browser.drag", "browser.dialog", "browser.runCode", "browser.readPage",
      "browser.newTab", "browser.switchTab", "browser.closeTab", "browser.listTabs", "browser.intercept", "browser.unintercept",
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
      "notebook.read", "notebook.editCell", "notebook.addCell", "notebook.deleteCell", "notebook.execute",
    ]),
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
    mode: "code",
    modeRegistry,
    approvalsConfig,
    reasoningEffort: (vscode.workspace.getConfiguration().get<string>("arc.reasoning.effort", "high") ?? "high") as "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
    isMain: true,
    verifyMode: (vscode.workspace.getConfiguration().get<string>("arc.verify.mode", "default") ?? "default") as "none" | "default" | "custom",
    verifyMaxRetries: vscode.workspace.getConfiguration().get<number>("arc.verify.customMaxRetries", 3),
    proxyUrl: resolveProxy("url"),
    proxyProvider: resolveProxy("providerUrl"),
    toolContext,
    fileContextTracker,
    getBrowserTabs: async () => {
      if (!browser) return [];
      const r = await browser.listTabs();
      return r.tabs ?? [];
    },
    getBackgroundProcesses: () => listBackgroundProcesses(),
    restoreBrowserTabs: async (tabs) => {
      if (!tabs.length) return;
      const b = await getBrowser();
      for (const t of tabs) {
        await b.newTab(t.url);
      }
    },
    approveShell: async (description, meta) => {
      if (!session.view && !session.panel) {
        const choice = await vscode.window.showWarningMessage(description, { modal: true }, "Allow");
        return choice === "Allow";
      }
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
      const msg: any = { type: "approval/request", id, description, kind: "shell" };
      if (meta?.command) msg.command = meta.command;
      if (session.view) session.view.webview.postMessage(msg);
      if (session.panel) session.panel.webview.postMessage(msg);
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
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const prefixes = await loadApprovalsMemory(root);
  for (const entry of prefixes) {
    session.agent.addCommandPrefix(entry.prefix);
  }
  if (session === sidebarSession && pendingAgentState?.messages?.length) {
    session.agent.restore(pendingAgentState as any).catch(() => {});
    pendingAgentState = undefined;
    void ctxRef.globalState.update("arc.agentState", undefined);
  }
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
  for (const [, s] of fullscreenSessions) {
    s.agent = undefined as unknown as Agent;
    s.agentReady = undefined;
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
async function reindexWorkspace(webview?: vscode.Webview) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    webview?.postMessage({ type: "error", message: "No workspace folder to index." });
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
  startIndexWatcherIfEnabled();
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
function stopIndexWatcher(): void {
  indexWatcher?.stop();
  indexWatcher = undefined;
  clearTimeout(indexWatcherSaveTimer);
}
function stopAutoReindexSchedule(): void {
  clearInterval(autoReindexTimer);
  autoReindexTimer = undefined;
}
function scheduleAutoReindex(): void {
  stopAutoReindexSchedule();
  const cfg = vscode.workspace.getConfiguration();
  const mode = cfg.get<string>("arc.search.autoReindex", "off");
  if (mode !== "hourly" && mode !== "daily") return;
  const intervalMs = mode === "hourly" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  autoReindexTimer = setInterval(() => {
    if (!vscode.workspace.getConfiguration().get<boolean>("arc.search.enabled", true)) return;
    void reindexWorkspace();
  }, intervalMs);
}
function startIndexWatcherIfEnabled(): void {
  stopIndexWatcher();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root || !searchIndexer) return;
  const cfg = vscode.workspace.getConfiguration();
  const enabled = cfg.get<boolean>("arc.search.enabled", true);
  const autoWatch = cfg.get<boolean>("arc.indexing.autoWatch", true);
  if (!enabled || !autoWatch) return;
  indexWatcher = new IndexWatcher({
    root,
    indexer: searchIndexer,
    onUpdate: ({ updated, removed }) => {
      searchProgress.filesIndexed += updated.length;
      broadcastAll({ type: "search/indexUpdated", updated, removed });
      clearTimeout(indexWatcherSaveTimer);
      indexWatcherSaveTimer = setTimeout(() => {
        const indexPath = getIndexPath();
        if (indexPath && searchIndexer) void searchIndexer.save(indexPath).catch(() => {});
      }, 3000);
    },
  });
  indexWatcher.start();
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
    startIndexWatcherIfEnabled();
  } catch {
    searchIndexer = undefined;
  }
}
function wireWebview(webview: vscode.Webview, session: Session) {
  const sendProviders = () => {
    if (!registry) return;
    const providers = registry.listProviders();
    webview.postMessage({ type: "provider/list", providers });
    for (const p of providers) {
      const proc = serverProcesses.get(p.id);
      if (proc && !proc.killed) {
        webview.postMessage({ type: "provider/serverState", providerId: p.id, running: true, pid: proc.pid });
      }
    }
  };
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
            reasoningEffort: vscode.workspace.getConfiguration().get<string>("arc.reasoning.effort", "high") ?? "high",
          });
          if (registry) webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" });
          if (registry) sendProviders();
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
              const editId = msg.messageId;
              const editContent = msg.content ?? msg.messageId;
              let idx = messages.findIndex((m) => m.id === editId);
              if (idx < 0) idx = messages.findIndex((m) => m.role === "user" && m.content === editContent);
              if (idx >= 0) {
                const editTs = messages[idx].ts;
                messages[idx] = { ...messages[idx], content: msg.newContent, meta: { ...messages[idx].meta, editedOriginal: messages[idx].content } as ChatMessage["meta"] };
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
            if (msg.mode === "audit") {
              const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
              generateDependencyGraph(root).then((nodes) => {
                agent.addContextMessage(formatDepGraph(nodes, root));
              }).catch(() => {});
            }
            const modeDef = modeRegistry.get(msg.mode);
            if (modeDef) {
              broadcast(session, { type: "session/message", message: { id: `mode-${Date.now()}`, role: "system", content: `Switched to **${msg.mode}** mode — ${modeDef.description}`, ts: Date.now() }, sessionId: session.id });
            }
          }
          break;
        }
        case "mode/list": {
          if (modeRegistry) {
            const modes = modeRegistry.list().map((m) => ({ ...m, source: modeRegistry.sourceOf(m.slug) ?? "workspace" as const }));
            webview.postMessage({ type: "mode/list", modes });
          }
          break;
        }
        case "mode/save": {
          if (modeRegistry) {
            try {
              await modeRegistry.save(msg.mode, msg.scope ?? "workspace");
              const modes = modeRegistry.list().map((m) => ({ ...m, source: modeRegistry.sourceOf(m.slug) ?? "workspace" as const }));
              webview.postMessage({ type: "mode/list", modes });
            } catch (e) {
              webview.postMessage({ type: "error", message: `Failed to save mode: ${(e as Error).message}` });
            }
          }
          break;
        }
        case "mode/delete": {
          if (modeRegistry) {
            await modeRegistry.delete(msg.slug, msg.scope ?? "workspace");
            const modes = modeRegistry.list().map((m) => ({ ...m, source: modeRegistry.sourceOf(m.slug) ?? "workspace" as const }));
            webview.postMessage({ type: "mode/list", modes });
          }
          break;
        }
        case "provider/add": {
          if (registry) {
            registry.upsertProvider({ ...msg.provider, apiKey: msg.apiKey, enabled: msg.provider.enabled ?? true });
            if (msg.apiKey) await ctxRef.secrets.store(`${SECRET_PREFIX}${msg.provider.id}`, msg.apiKey);
            persist?.();
            sendProviders();
          }
          break;
        }
        case "provider/update": {
          if (registry) {
            const p = registry.listProviders().find((x) => x.id === msg.providerId);
            if (p) {
              if (msg.changes.label !== undefined) p.label = msg.changes.label;
              if (msg.changes.kind !== undefined) p.kind = msg.changes.kind;
              if (msg.changes.baseUrl !== undefined) p.baseUrl = msg.changes.baseUrl || undefined;
              if (msg.changes.startCommand !== undefined) p.startCommand = msg.changes.startCommand || undefined;
              if (msg.apiKey !== undefined) {
                if (msg.apiKey) { p.apiKey = msg.apiKey; await ctxRef.secrets.store(`${SECRET_PREFIX}${p.id}`, msg.apiKey); }
                else { p.apiKey = undefined; await ctxRef.secrets.delete(`${SECRET_PREFIX}${p.id}`); }
              }
              registry.upsertProvider(p);
              persist?.();
            }
            sendProviders();
          }
          break;
        }
        case "provider/remove":
          if (registry) {
            await ctxRef.secrets.delete(`${SECRET_PREFIX}${msg.providerId}`);
            registry.removeProvider(msg.providerId);
            persist?.();
            sendProviders();
          }
          break;
        case "provider/toggle": {
          if (registry) {
            const p = registry.listProviders().find((x) => x.id === msg.providerId);
            if (p) { p.enabled = msg.enabled; registry.upsertProvider(p); persist?.(); }
            sendProviders();
          }
          break;
        }
        case "provider/setupInternal": {
          if (!registry) break;
          const report = (phase: string, pct: number, error?: string) =>
            webview.postMessage({ type: "provider/internalSetupProgress", phase, pct, error });
          try {
            report("Preparing…", 5);
            const apiDir = path.join(os.homedir(), ".arc", "api");
            const repoUrl = "https://github.com/KHROTU/lucky-cat-api.git";
            const repoDir = apiDir;
            const repoExists = await fs.access(path.join(repoDir, "lc_server.py")).then(() => true).catch(() => false);
            if (!repoExists) {
               report("Downloading…", 10);
              await fs.mkdir(path.dirname(apiDir), { recursive: true });
              await new Promise<void>((resolve, reject) => {
                const proc = spawn("git", ["clone", repoUrl, apiDir], { stdio: "pipe" });
                let stderr = "";
                proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
                proc.on("close", (code) => {
                  if (code === 0) resolve();
                  else reject(new Error(stderr || `git clone failed with code ${code}`));
                });
                proc.on("error", reject);
              });
            }
            report("Installing…", 30);
            await new Promise<void>((resolve, reject) => {
              const proc = spawn("pip", ["install", "-r", "requirements.txt"], { cwd: repoDir, stdio: "pipe" });
              let stderr = "";
              proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
              proc.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(stderr || `pip install failed with code ${code}`));
              });
              proc.on("error", reject);
            });
            report("Starting…", 90);
            const providerId = "internal-" + Date.now().toString(36);
            const internalCmd = `python -m uvicorn lc_server:app --app-dir "${repoDir}" --host 127.0.0.1 --port 3737`;
            const serverProc = spawn("python", ["-m", "uvicorn", "lc_server:app", "--app-dir", repoDir, "--host", "127.0.0.1", "--port", "3737"], {
              cwd: repoDir,
              stdio: "ignore",
              detached: true,
            });
            serverProc.on("exit", () => { serverProcesses.delete(providerId); });
            serverProcesses.set(providerId, serverProc);
            serverProc.unref();
            report("Configuring…", 80);
            registry.upsertProvider({
              id: providerId,
              kind: "openai-compatible",
              label: "Internal",
              baseUrl: "http://127.0.0.1:3737/v1",
              startCommand: internalCmd,
              enabled: true,
            });
            const existingModels = registry.list();
            if (!existingModels.some((m) => m.id === "glm-5.2")) {
              registry.upsertModel({
                id: "glm-5.2",
                label: "GLM 5.2",
                tier: "heavy",
                contextWindow: 200000,
                costPer1mIn: 0,
                costPer1mOut: 0,
                providers: [{ id: providerId, kind: "openai-compatible", priority: 0, remoteModel: "glm-5.2" }],
              });
            }
            if (!existingModels.some((m) => m.id === "qwen3.5-397b-a17b")) {
              registry.upsertModel({
                id: "qwen3.5-397b-a17b",
                label: "Qwen3.5 397B A17B",
                tier: "heavy",
                contextWindow: 266000,
                costPer1mIn: 0,
                costPer1mOut: 0,
                providers: [{ id: providerId, kind: "openai-compatible", priority: 1, remoteModel: "qwen3.5-397b-a17b" }],
              });
            }
            persist?.();
            webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" });
            sendProviders();
            report("Done", 100);
          } catch (e) {
            report("Setup failed", 0, (e as Error).message);
          }
          break;
        }
        case "provider/startServer": {
          const p = registry?.listProviders().find((x) => x.id === msg.providerId);
          if (!p?.startCommand) break;
          const existing = serverProcesses.get(msg.providerId);
          if (existing && !existing.killed) {
            webview.postMessage({ type: "provider/serverState", providerId: msg.providerId, running: true, pid: existing.pid });
            break;
          }
          try {
            const proc = spawn(p.startCommand, [], { cwd: os.homedir(), stdio: "ignore", detached: true, shell: true });
            proc.on("exit", () => {
              serverProcesses.delete(msg.providerId);
              webview.postMessage({ type: "provider/serverState", providerId: msg.providerId, running: false });
            });
            serverProcesses.set(msg.providerId, proc);
            proc.unref();
            webview.postMessage({ type: "provider/serverState", providerId: msg.providerId, running: true, pid: proc.pid });
          } catch (e) {
            webview.postMessage({ type: "provider/serverState", providerId: msg.providerId, running: false });
          }
          break;
        }
        case "provider/stopServer": {
          const proc = serverProcesses.get(msg.providerId);
          if (proc && !proc.killed) {
            proc.kill();
            serverProcesses.delete(msg.providerId);
          }
          webview.postMessage({ type: "provider/serverState", providerId: msg.providerId, running: false });
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
        case "ui/attachFile": {
          const files = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: "Attach", filters: { "All files": ["*"] } });
          if (!files?.length) break;
          const uri = files[0];
          const rel = vscode.workspace.asRelativePath(uri);
          try {
            const raw = await vscode.workspace.fs.readFile(uri);
            const text = new TextDecoder().decode(raw).slice(0, 200).replace(/\n/g, "↵");
            webview.postMessage({ type: "session/attachment", uri: rel, preview: `${rel}  ·  ${text}` });
          } catch {
            webview.postMessage({ type: "session/attachment", uri: rel, preview: rel });
          }
          break;
        }
        case "ui/attachProblems": {
          const ed = vscode.window.activeTextEditor;
          if (!ed) { webview.postMessage({ type: "error", message: "No active editor." }); break; }
          const filePath = vscode.workspace.asRelativePath(ed.document.uri);
          const diags = await lsp.problemsFor(filePath);
          if (!diags.length) break;
          const text = diags.map((d) => `[${d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARNING" : d.severity.toUpperCase()}] ${d.message} (${filePath}:${d.line})`).join("\n");
          webview.postMessage({ type: "session/attachment", uri: `problems:${filePath}`, preview: `${diags.length} problem${diags.length === 1 ? "" : "s"} in ${filePath}  ·  ${text.slice(0, 200)}` });
          break;
        }
        case "ui/attachAllProblems": {
          const diags = await lsp.allProblems();
          if (!diags.length) break;
          const text = diags.map((d) => `[${d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARNING" : d.severity.toUpperCase()}] ${d.message} (${d.file}:${d.line})`).join("\n");
          webview.postMessage({ type: "session/attachment", uri: "problems:workspace", preview: `${diags.length} problem${diags.length === 1 ? "" : "s"} across workspace  ·  ${text.slice(0, 200)}` });
          break;
        }
        case "ui/attachFileProblems": {
          const files = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: "Check problems", filters: { "Source files": ["*"] } });
          if (!files?.length) break;
          const rel = vscode.workspace.asRelativePath(files[0]);
          const diags = await lsp.problemsFor(rel);
          if (!diags.length) break;
          const text = diags.map((d) => `[${d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARNING" : d.severity.toUpperCase()}] ${d.message} (${rel}:${d.line})`).join("\n");
          webview.postMessage({ type: "session/attachment", uri: `problems:${rel}`, preview: `${diags.length} problem${diags.length === 1 ? "" : "s"} in ${rel}  ·  ${text.slice(0, 200)}` });
          break;
        }
        case "ui/attachCurrentFile": {
          const ed = vscode.window.activeTextEditor;
          if (!ed) { webview.postMessage({ type: "error", message: "No active editor." }); break; }
          const rel = vscode.workspace.asRelativePath(ed.document.uri);
          const fullText = ed.document.getText();
          webview.postMessage({ type: "session/attachment", uri: rel, preview: `${rel} (${fullText.split("\n").length} lines)  ·  ${fullText.slice(0, 200).replace(/\n/g, "↵")}` });
          break;
        }
        case "ui/attachGitDiff": {
          try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const execPromise = (await import("node:child_process")).exec;
            const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
              execPromise("git diff", { cwd: root, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
                if (err) reject(err); else resolve({ stdout, stderr });
              });
            });
            if (!stdout.trim()) break;
            webview.postMessage({ type: "session/attachment", uri: "git:unstaged", preview: `git diff (unstaged)  ·  ${stdout.trim().slice(0, 200)}` });
          } catch (e) { webview.postMessage({ type: "error", message: `git diff failed: ${(e as Error).message}` }); }
          break;
        }
        case "ui/attachGitStaged": {
          try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const execPromise = (await import("node:child_process")).exec;
            const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
              execPromise("git diff --staged", { cwd: root, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
                if (err) reject(err); else resolve({ stdout, stderr });
              });
            });
            if (!stdout.trim()) break;
            webview.postMessage({ type: "session/attachment", uri: "git:staged", preview: `git diff --staged  ·  ${stdout.trim().slice(0, 200)}` });
          } catch (e) { webview.postMessage({ type: "error", message: `git diff --staged failed: ${(e as Error).message}` }); }
          break;
        }
        case "ui/attachChangedFiles": {
          try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const execPromise = (await import("node:child_process")).exec;
            const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
              execPromise("git diff --name-status", { cwd: root, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
                if (err) reject(err); else resolve({ stdout, stderr });
              });
            });
            if (!stdout.trim()) break;
            const files = stdout.trim().split("\n").length;
            webview.postMessage({ type: "session/attachment", uri: "git:changed", preview: `${files} changed file${files === 1 ? "" : "s"}  ·  ${stdout.trim().slice(0, 200)}` });
          } catch (e) { webview.postMessage({ type: "error", message: `git diff --name-status failed: ${(e as Error).message}` }); }
          break;
        }
        case "ui/attachPullRequest": {
          try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const execPromise = (await import("node:child_process")).exec;
            const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
              execPromise("gh pr view --json number,title,body,url,state,author,baseRefName,headRefName,additions,deletions,files", { cwd: root, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
                if (err) reject(err); else resolve({ stdout, stderr });
              });
            });
            const pr = JSON.parse(stdout);
            const summary = `#${pr.number} ${pr.title} (${pr.state}) by ${pr.author.login}\n${pr.headRefName} → ${pr.baseRefName}  |  +${pr.additions} -${pr.deletions} across ${pr.files?.length ?? "?"} files\n${pr.url}\n\n${pr.body ?? ""}`;
            webview.postMessage({ type: "session/attachment", uri: `pr:${pr.number}`, preview: summary.slice(0, 2000) });
          } catch (e) {
            const msg = (e as Error).message;
            if (msg.includes("not found") || msg.includes("ENOENT") || msg.includes("not recognized")) {
              webview.postMessage({ type: "error", message: "GitHub CLI (gh) not found. Install from https://cli.github.com" });
            } else if (msg.includes("no pull request")) {
              webview.postMessage({ type: "error", message: "No pull request found for current branch." });
            } else {
              webview.postMessage({ type: "error", message: `Failed to fetch PR: ${msg}` });
            }
          }
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
          const fileUri = resolveWorkspaceFileUri(msg.path);
          if (fileUri) {
            try { await vscode.window.showTextDocument(fileUri); } catch {  }
          }
          break;
        }
        case "ui/openFileDiff": {
          const fileUri = resolveWorkspaceFileUri(msg.path);
          if (!fileUri) break;
          try {
            const beforeContent = buildBeforeContentFromHunks(msg.hunks);
            const beforeUri = createDiffPreviewUri(msg.path, beforeContent);
            await vscode.commands.executeCommand("vscode.diff", beforeUri, fileUri, path.basename(msg.path));
          } catch {  }
          break;
        }
        case "diff/accept": {
          if (session.agent) session.agent.injectSystemNote(`User accepted the edit to ${msg.filePath}.`);
          break;
        }
        case "diff/reject": {
          const fileUri = resolveWorkspaceFileUri(msg.filePath);
          if (fileUri) {
            try {
              const beforeContent = buildBeforeContentFromHunks(msg.hunks);
              await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(beforeContent));
            } catch (e) {
              webview.postMessage({ type: "error", message: `Failed to revert ${msg.filePath}: ${(e as Error).message}` });
            }
          }
          if (session.agent) session.agent.injectSystemNote(`User rejected the edit to ${msg.filePath}. The file has been reverted to its previous content. Do not reapply this edit unless asked again.`);
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
            if (msg.rememberPrefix) {
              p.session.agent?.addCommandPrefix(msg.rememberPrefix);
              const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
              saveApprovalPrefix(root, msg.rememberPrefix);
            }
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
                reasoningEffort: vscode.workspace.getConfiguration().get<string>("arc.reasoning.effort", "high") ?? "high",
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
  const providerCatalog = JSON.stringify(PROVIDERS);
  const extVersion = ctxRef?.extension?.packageJSON?.version ?? "0.0.0";
  const prideMode: PrideMode = vscode.workspace.getConfiguration().get<PrideMode>("arc.appearance.prideLogo", "june") ?? "june";
  let isPride: boolean;
  if (prideMode === "never") isPride = false;
  else if (prideMode === "always") isPride = true;
  else isPride = new Date().getUTCMonth() === 5;
  const toolTree = vscode.workspace.getConfiguration().get<string>("arc.appearance.toolTree", "auto") ?? "auto";
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
  <div id="root" data-mode="${mode}" data-mono="${monoLogo}" data-pride="${prideLogo}" data-mono-text="${monoLogoText}" data-pride-active="${isPride}" data-tool-tree="${toolTree}" data-version="${extVersion}" data-catalog="${providerCatalog.replace(/"/g, '&quot;')}"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
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
export async function deactivate() {
  if (sidebarSession.agent && sidebarSession.agent.getMessages()?.length) {
    const snap = await sidebarSession.agent.snapshotWithBrowser();
    await ctxRef?.globalState.update("arc.agentState", snap);
  }
  stopIndexWatcher();
  ruleWatcherDispose?.();
  stopAutoReindexSchedule();
  void fileContextTracker?.save();
  void mcp?.dispose();
  void browser?.close();
}
async function describeToolImage(base64data: string, currentModel?: import("@arc/host").ModelDescriptor): Promise<string> {
  if (!base64data) return "";
  const config = vscode.workspace.getConfiguration();
  const multimodalIds = config.get<string[]>("arc.model.multimodalIds") ?? [];
  if (currentModel && multimodalIds.includes(currentModel.id)) return "";
  const describer = config.get<string>("arc.image.describeModel") ?? "none";
  if (describer === "none") return "";
  const match = base64data.match(/^(?:data:image\/\w+;base64,)?(.+)$/i);
  const raw = match?.[1] ?? base64data;
  const desc = await callOllamaDescribe(describer, raw, "Describe this image.");
  return desc ?? "";
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
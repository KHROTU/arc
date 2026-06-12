import * as vscode from "vscode";
import {
  ModelRegistry, Agent, CheckpointStore, LspBridge, McpAggregator,
  makeVSCodeNotifier, setNotifier, loadWorkspacePrompts, mergePrecedence, render,
  pickLogo, ChatHistory,
  type HostMsg, type WebviewMsg, type ModelDescriptor, type ProviderConfig, type ProcessStep,
} from "@arc/host";
const SECRET_PREFIX = "arc.apiKey.";
let log: vscode.OutputChannel;
let ctxRef: vscode.ExtensionContext;
let registry: ModelRegistry;
let store: CheckpointStore;
let lsp: LspBridge;
let mcp: McpAggregator;
let persist: () => void;
let chatHistory: ChatHistory;
type Session = { id: string; panel?: vscode.WebviewPanel; view?: vscode.WebviewView; agent: Agent; steps: ProcessStep[]; messages: import("@arc/host").ChatMessage[]; };
const sidebarSession: Session = { id: "sidebar", agent: undefined as unknown as Agent, steps: [], messages: [] };
const fullscreenSessions = new Map<string, Session>();
const chatSessions = new Map<string, Session>();
const chatTotals = new Map<string, { cost: number; promptTokens: number; completionTokens: number; window: number }>();
export function activate(context: vscode.ExtensionContext) {
  ctxRef = context;
  log = vscode.window.createOutputChannel("Arc");
  log.appendLine(`[arc] activate() — ${new Date().toISOString()}`);
  log.show(true);
  context.subscriptions.push(log);
  try {
    registerViewsAndCommands(context);
    log.appendLine(`[arc] phase 1 complete (view providers + 11 commands + pride context)`);
  } catch (err) {
    log.appendLine(`[arc] FATAL during phase 1: ${(err as Error)?.stack ?? err}`);
    void vscode.window.showErrorMessage(`Arc failed to activate: ${(err as Error)?.message ?? err}`);
    return;
  }
  void initializeAsync(context).catch((err) => {
    log.appendLine(`[arc] async init failed: ${(err as Error)?.stack ?? err}`);
  });
}
function registerViewsAndCommands(context: vscode.ExtensionContext) {
  const logo = pickLogo();
  void vscode.commands.executeCommand("setContext", "arc.isPrideMonth", logo.kind === "pride");
  log.appendLine(`[arc] logo: ${logo.kind} (${logo.file})`);
  const sidebarProvider: vscode.WebviewViewProvider = {
    async resolveWebviewView(webviewView: vscode.WebviewView) {
      try {
        sidebarSession.view = webviewView;
        webviewView.webview.options = {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.file(context.extensionPath)],
        };
        webviewView.webview.html = getWebviewHtml(webviewView.webview, context.extensionUri, "sidebar");
        if (!sidebarSession.agent) await createAgent(sidebarSession);
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
  vscode.commands.registerCommand("arc.openPlayground", () => {
    openPlayground();
  });
  vscode.commands.registerCommand("arc.newTask", () => {
    newTask();
  });
  vscode.commands.registerCommand("arc.stop", () => {
    void sidebarSession.agent?.stop();
  });
  vscode.commands.registerCommand("arc.continue", () => {
    void sidebarSession.agent?.continue();
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
  log.appendLine(`[arc] phase 2 start: hydrating registry + MCP + creating default agent`);
  registry = new ModelRegistry();
  const stored = context.globalState.get<{ models: ModelDescriptor[]; providers: ProviderConfig[]; currentModelId?: string }>("arc.registry", { models: [], providers: [] });
  for (const p of stored.providers) {
    if (!p.apiKey) p.apiKey = await context.secrets.get(`${SECRET_PREFIX}${p.id}`);
  }
  registry.load(stored);
  log.appendLine(`[arc] registry: ${registry.list().length} model(s), ${registry.listProviders().length} provider(s)`);
  chatHistory = new ChatHistory();
  const storedChats = context.globalState.get<{ chats: import("@arc/host").ChatMeta[]; currentId?: string }>("arc.chats", { chats: [] });
  chatHistory.load(storedChats);
  if (!chatHistory.current() && chatHistory.list().length === 0) {
    chatHistory.create("Welcome");
  }
  log.appendLine(`[arc] chat history: ${chatHistory.list().length} chat(s)`);
  persist = () => {
    const snapshot = {
      models: registry.list(),
      providers: registry.listProviders().map(({ apiKey, ...rest }) => rest),
      currentModelId: registry.getCurrent()?.id,
    };
    void context.globalState.update("arc.registry", snapshot);
    void context.globalState.update("arc.chats", { chats: chatHistory.list(), currentId: chatHistory.current() });
  };
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("arc")) persist();
  }));
  store = new CheckpointStore({ dir: context.globalStorageUri.fsPath });
  lsp = new LspBridge(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  mcp = new McpAggregator();
  void hydrateMcp(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  setNotifier(makeVSCodeNotifier());
  const currentChat = chatHistory.ensure();
  sidebarSession.id = currentChat.id;
  chatSessions.set(currentChat.id, sidebarSession);
  await createAgent(sidebarSession);
  persist();
  log.appendLine(`[arc] phase 2 complete: extension fully ready`);
}
function openFullscreen() {
  if (!ctxRef) return;
  const panel = vscode.window.createWebviewPanel("arc.fullscreen", "Arc", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(ctxRef.extensionPath)],
  });
  panel.iconPath = vscode.Uri.file(ctxRef.asAbsolutePath("assets/arc-logo-mono.png"));
  panel.webview.html = getWebviewHtml(panel.webview, ctxRef.extensionUri, "fullscreen");
  const session: Session = { id: `fullscreen-${Date.now()}`, panel, agent: undefined as unknown as Agent, steps: [], messages: [] };
  fullscreenSessions.set(session.id, session);
  createAgent(session).then(() => wireWebview(panel.webview, session));
  panel.onDidDispose(() => fullscreenSessions.delete(session.id));
}
function openSettings() {
  if (!ctxRef) return;
  const panel = vscode.window.createWebviewPanel("arc.settings", "Arc Settings", vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(ctxRef.extensionPath)],
  });
  panel.webview.html = getWebviewHtml(panel.webview, ctxRef.extensionUri, "settings");
  wireSettingsWebview(panel.webview);
}
function openPlayground() {
  if (!ctxRef) return;
  const panel = vscode.window.createWebviewPanel("arc.playground", "Arc Playground", vscode.ViewColumn.Beside, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(ctxRef.extensionPath)],
  });
  panel.webview.html = getWebviewHtml(panel.webview, ctxRef.extensionUri, "playground");
}
function newTask() {
  sidebarSession.messages = [];
  sidebarSession.steps = [];
  if (sidebarSession.agent) {
    void createAgent(sidebarSession);
  }
  if (sidebarSession.view) {
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
  const target = vscode.Uri.file(`${root}/.arc/prompt.md`);
  try {
    await vscode.workspace.fs.stat(target);
  } catch {
try { await vscode.workspace.fs.createDirectory(vscode.Uri.file(`${root}/.arc`)); } catch {  }
    await vscode.workspace.fs.writeFile(
      target,
      new TextEncoder().encode("# Arc workspace prompt\n\nOverride Arc's system prompt for this workspace.\n"),
    );
  }
  await vscode.window.showTextDocument(target);
}
const buildSystemPrompt = async (): Promise<string> => {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const parts = await loadWorkspacePrompts(root);
  const basePrompt = `You are Arc, an agentic coding assistant.\nWorking dir: ${root}\nOS: ${process.platform}\nDate: ${new Date().toISOString().slice(0, 10)}\n\n## Tools\n- file.read, file.edit (search/replace), file.write\n- shell.run (subject to allowlist/approval)\n- lsp.problems: snapshot of the Problems tab across the workspace.\n- lsp.problemsFor { path }: problems for one file.\n- todo.write: set a live plan. Keep exactly one item in_progress at a time. Mark items done only after the underlying work is verified (e.g. edit applied + diagnostics clean).\n- browser.* (if Playwright is installed)\n- mcp.call { server, tool, args }\n- subagent.spawn { name, instructions, tier? }: spawn a subagent on a different (typically cheaper) tier. The subagent CANNOT escalate, CANNOT ask the human directly.\n- handoff { reason, direction? }: hand the conversation to a heavier/lighter model.\n- clarification.askUser { question, options? }: ask the human a clarifying question with 2-4 options.\n\n## Workflow\n1. Read relevant files first.\n2. Set a todo plan before non-trivial work.\n3. Make minimal, targeted edits. After file.edit/file.write, Arc AUTOMATICALLY pulls diagnostics and injects them. If there are errors, fix them in the same turn.\n4. If a task is beyond your capability, call handoff with a clear reason.\n5. Subagents are cheap — delegate grunt work.`;
  const merged = mergePrecedence([{ scope: "global", body: basePrompt }, ...parts]);
  return render(merged, {
    workspace: root,
    os: process.platform,
    date: new Date().toISOString().slice(0, 10),
  });
};
async function createAgent(session: Session) {
  if (!registry || !store || !lsp || !mcp || !ctxRef) {
    log?.appendLine(`[arc] createAgent called before phase 2 complete — deferring`);
    return;
  }
  const systemPrompt = await buildSystemPrompt();
  const toolContext = {
    problems: () => lsp.allProblems(),
    problemsFor: (file: string) => lsp.problemsFor(file),
    summaryForFiles: (files: string[]) => lsp.summaryForFiles(files),
    mcp,
  };
  const sink: import("@arc/host").AgentEventSink = {
    message: (m) => {
      session.messages.push(m);
      broadcast(session, { type: "session/message", message: m });
    },
    assistantDelta: (id, text) => broadcast(session, { type: "session/assistantText", id, text }),
    steps: (steps) => {
      session.steps = steps;
      broadcast(session, { type: "session/steps", steps });
    },
    turnStart: (turnId) => broadcast(session, { type: "session/turnStart", turnId }),
    turnEnd: (turnId, ok, error) => broadcast(session, { type: "session/turnEnd", turnId, ok, ...(error ? { error } : {}) }),
    usage: (usage, perModel) => {
      const totals = chatTotals.get(session.id) ?? { cost: 0, promptTokens: 0, completionTokens: 0, window: 0 };
      totals.promptTokens = usage.prompt;
      totals.completionTokens = usage.completion;
      totals.cost += usage.cost;
      const model = registry?.getCurrent();
      if (model) totals.window = model.contextWindow;
      chatTotals.set(session.id, totals);
      if (chatHistory) chatHistory.bump(session.id, usage.cost);
      broadcast(session, { type: "session/usage", usage, perModel });
      for (const w of [session.view?.webview, session.panel?.webview].filter(Boolean) as vscode.Webview[]) {
        pushContextStats(w, session.id);
        broadcastChatList(w);
      }
      persist?.();
    },
    handoff: (fromModel, toModel, reason) => broadcast(session, { type: "session/handoff", fromModel, toModel, reason }),
    todo: (items) => broadcast(session, { type: "todo/update", items }),
    clarification: (id, question, options) => broadcast(session, { type: "session/clarification", id, question, options }),
    done: () => broadcast(session, { type: "session/done" }),
    error: (message) => broadcast(session, { type: "error", message }),
    compaction: (before, after, reason) => broadcast(session, { type: "session/compaction", before, after, reason }),
  };
  session.agent = new Agent(registry, store, sink, {
    systemPrompt,
    enabledTools: new Set([
      "file.read", "file.edit", "file.write", "shell.run",
      "lsp.problems", "lsp.problemsFor",
      "todo.write",
      "browser.navigate", "browser.click", "browser.type", "browser.screenshot", "browser.evaluate", "browser.readDom", "browser.close",
      "mcp.call",
      "subagent.spawn", "subagent.askParent", "handoff", "clarification.askUser",
    ]),
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
    isMain: true,
    toolContext,
    approveShell: async (description) => {
      const choice = await vscode.window.showWarningMessage(description, { modal: true }, "Allow", "Deny");
      return choice === "Allow";
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
  });
}
function broadcast(session: Session, msg: HostMsg) {
  if (session.view) session.view.webview.postMessage(msg);
  if (session.panel) session.panel.webview.postMessage(msg);
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
function switchToChat(chatId: string, webview: vscode.Webview) {
  webview.postMessage({ type: "chat/current", chatId });
  webview.postMessage({ type: "session/steps", steps: [] });
  if (sidebarSession) {
    sidebarSession.id = chatId;
    sidebarSession.messages = [];
    sidebarSession.steps = [];
    sidebarSession.agent = undefined as unknown as Agent;
  }
  chatTotals.set(chatId, { cost: 0, promptTokens: 0, completionTokens: 0, window: 0 });
  pushContextStats(webview, chatId);
}
function pushContextStats(webview: vscode.Webview, chatId: string) {
  const totals = chatTotals.get(chatId) ?? { cost: 0, promptTokens: 0, completionTokens: 0, window: 0 };
  const model = registry?.getCurrent();
  const window = model?.contextWindow ?? 0;
  const tokens = totals.promptTokens + totals.completionTokens;
  const usedPct = window > 0 ? Math.min(100, (tokens / window) * 100) : 0;
  webview.postMessage({ type: "context/stats", usedPct, tokens, window, cost: totals.cost });
}
function wireWebview(webview: vscode.Webview, session: Session) {
  webview.onDidReceiveMessage(async (raw: unknown) => {
    const msg = raw as WebviewMsg;
    try {
      switch (msg.type) {
        case "ready": {
          webview.postMessage({
            type: "session/init",
            sessionId: session.id,
            models: registry?.list() ?? [],
            currentModelId: registry?.getCurrent()?.id ?? "",
          });
          if (registry) webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" });
          if (registry) webview.postMessage({ type: "provider/list", providers: registry.listProviders() });
          for (const m of session.messages) webview.postMessage({ type: "session/message", message: m });
          webview.postMessage({ type: "session/steps", steps: session.steps });
          broadcastChatList(webview);
          pushContextStats(webview, session.id);
          break;
        }
        case "chat/send":
          await session.agent.send(msg.text, msg.attachments);
          break;
        case "chat/stop":
          await session.agent.stop();
          break;
        case "chat/continue":
          await session.agent.continue();
          break;
        case "chat/answerClarification":
          session.agent.answerClarification(msg.id, msg.answer);
          await session.agent.continue();
          break;
        case "chat/retract":
          await session.agent.retract(msg.turnId);
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
          const value = vscode.workspace.getConfiguration().get(msg.key);
          webview.postMessage({ type: "config/get", value, inReplyTo: msg.id });
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
          void vscode.commands.executeCommand("arc.openFullscreen");
          break;
        case "ui/openSettings":
          void vscode.commands.executeCommand("arc.openSettings");
          break;
        case "ui/openSidebar":
          void vscode.commands.executeCommand("arc.openSidebar");
          break;
        case "ui/newTask":
          void vscode.commands.executeCommand("arc.newTask");
          break;
        case "chat/new": {
          if (chatHistory) {
            const c = chatHistory.create();
            persist?.();
            broadcastChatList(webview);
            switchToChat(c.id, webview);
          }
          break;
        }
        case "chat/switch": {
          if (chatHistory) {
            const c = chatHistory.switch(msg.chatId);
            persist?.();
            broadcastChatList(webview);
            if (c) switchToChat(c.id, webview);
          }
          break;
        }
        case "chat/rename": {
          if (chatHistory) {
            chatHistory.rename(msg.chatId, msg.title);
            persist?.();
            broadcastChatList(webview);
          }
          break;
        }
        case "chat/delete": {
          if (chatHistory) {
            chatHistory.remove(msg.chatId);
            chatSessions.delete(msg.chatId);
            chatTotals.delete(msg.chatId);
            persist?.();
            broadcastChatList(webview);
            if (!chatHistory.current()) {
              const first = chatHistory.list()[0];
              if (first) switchToChat(first.id, webview);
            }
          }
          break;
        }
        case "chat/compact": {
          const session = sidebarSession;
          if (session?.agent) {
            void session.agent.continue();
          }
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
        case "mcp/removeServer": {
          if (mcp) {
            await mcp.removeServer(msg.name);
            await persistMcpConfig(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
            const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
            webview.postMessage({ type: "mcp/list", servers: list });
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
function wireSettingsWebview(webview: vscode.Webview) {
  webview.onDidReceiveMessage(async (raw: unknown) => {
    const msg = raw as WebviewMsg;
    try {
      switch (msg.type) {
        case "ready": {
          if (registry) {
              webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" });
            webview.postMessage({ type: "provider/list", providers: registry.listProviders() });
          }
          if (mcp) {
            const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
            webview.postMessage({ type: "mcp/list", servers: list });
          }
          break;
        }
        case "model/add": if (registry) { registry.upsertModel(msg.model); persist?.(); webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" }); } break;
        case "model/remove": if (registry) { registry.removeModel(msg.modelId); persist?.(); webview.postMessage({ type: "model/list", models: registry.list(), currentModelId: registry.getCurrent()?.id ?? "" }); } break;
        case "provider/add": {
          if (registry) {
            registry.upsertProvider({ ...msg.provider, enabled: msg.provider.enabled ?? true });
            if (msg.apiKey) await ctxRef.secrets.store(`${SECRET_PREFIX}${msg.provider.id}`, msg.apiKey);
            persist?.();
            webview.postMessage({ type: "provider/list", providers: registry.listProviders() });
          }
          break;
        }
        case "provider/remove": {
          if (registry) {
            await ctxRef.secrets.delete(`${SECRET_PREFIX}${msg.providerId}`);
            registry.removeProvider(msg.providerId);
            persist?.();
            webview.postMessage({ type: "provider/list", providers: registry.listProviders() });
          }
          break;
        }
        case "provider/toggle": {
          if (registry) {
            const p = registry.listProviders().find((x) => x.id === msg.providerId);
            if (p) { p.enabled = msg.enabled; registry.upsertProvider(p); persist?.(); }
            webview.postMessage({ type: "provider/list", providers: registry.listProviders() });
          }
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
        case "mcp/removeServer": {
          if (mcp) {
            await mcp.removeServer(msg.name);
            await persistMcpConfig(mcp, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
            const list = mcp.listServers().map((s) => ({ name: s.name, enabled: s.enabled, transport: s.transport.type, toolCount: s.tools.length }));
            webview.postMessage({ type: "mcp/list", servers: list });
          }
          break;
        }
        case "config/get": {
          const value = vscode.workspace.getConfiguration().get(msg.key);
          webview.postMessage({ type: "config/get", value, inReplyTo: msg.id });
          break;
        }
        case "ui/openPrompt":
          void vscode.commands.executeCommand("arc.managePrompts");
          break;
        case "ui/openSidebar":
          void vscode.commands.executeCommand("arc.openSidebar");
          break;
      }
    } catch (e) {
      log.appendLine(`[arc] settings message handler error: ${(e as Error)?.stack ?? e}`);
try { webview.postMessage({ type: "error", message: (e as Error).message }); } catch {  }
    }
  });
}
function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, mode: "sidebar" | "fullscreen" | "playground" | "settings"): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "styles.css"));
  const monoLogo = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "assets", "arc-logo-mono.svg"));
  const prideLogo = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "assets", "arc-logo-pride.svg"));
  const compressIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "assets", "compress.svg"));
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
  <div id="root" data-mode="${mode}" data-mono="${monoLogo}" data-pride="${prideLogo}" data-compress="${compressIcon}" data-pride-active="${isPride}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
async function hydrateMcp(mcp: McpAggregator, root: string) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const file = path.join(root, ".arc/mcp.json");
  try {
    const raw = await fs.readFile(file, "utf-8");
    const j = JSON.parse(raw) as { mcpServers?: Record<string, { transport: import("@arc/host").McpTransport; enabled?: boolean }> };
    for (const [name, def] of Object.entries(j.mcpServers ?? {})) {
      try {
        if (def.enabled ?? true) {
          await mcp.addServer({ name, enabled: true, transport: def.transport });
        }
      } catch (e) {
        log.appendLine(`[arc] failed to start MCP server '${name}': ${(e as Error)?.message ?? e}`);
      }
    }
} catch {  }
}
async function persistMcpConfig(mcp: McpAggregator, root: string) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const file = path.join(root, ".arc/mcp.json");
  const servers = mcp.listServers();
  const out = { mcpServers: Object.fromEntries(servers.map((s) => [s.name, { enabled: s.enabled, transport: s.transport }])) };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(out, null, 2), "utf-8");
}
export function deactivate() {}
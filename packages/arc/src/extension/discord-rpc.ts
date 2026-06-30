import * as vscode from "vscode";
const MIN_DISPLAY_MS = 3000;
const ARC_SCHEME = "arc-agent";
let enabled = false;
let textProvider: vscode.Disposable | undefined;
let currentFile: string | undefined;
let lastActivity: "edit" | "think" = "edit";
let lastEditTime = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
let prevEditor: vscode.TextEditor | undefined;
export function initDiscordRpcSpof(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration();
  enabled = cfg.get<boolean>("arc.discord.spoofRpc", false);
  if (enabled) register(context);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("arc.discord.spoofRpc")) {
        enabled = vscode.workspace.getConfiguration().get<boolean>("arc.discord.spoofRpc", false);
      }
    }),
  );
}
function register(context: vscode.ExtensionContext): void {
  if (textProvider) return;
  textProvider = vscode.workspace.registerTextDocumentContentProvider(ARC_SCHEME, {
    provideTextDocumentContent(uri: vscode.Uri): string {
      const rel = decodeURIComponent(uri.path).replace(/^\//, "").replace(/\\/g, "/");
      return `# ${rel}\n\nArc agent is working with this file.`;
    },
  });
  context.subscriptions.push(textProvider);
}
export function reportAgentActivity(type: "edit" | "think", filePath?: string): void {
  if (!enabled || !textProvider) return;
  if (type === "edit" && filePath) {
    lastActivity = "edit";
    lastEditTime = Date.now();
    if (currentFile !== filePath) {
      currentFile = filePath;
      showFile(filePath);
    }
  } else if (type === "think") {
    lastActivity = "think";
    const elapsed = Date.now() - lastEditTime;
    if (elapsed < MIN_DISPLAY_MS) {
      if (cooldownTimer) clearTimeout(cooldownTimer);
      cooldownTimer = setTimeout(() => showFile(currentFile), MIN_DISPLAY_MS - elapsed);
    } else {
      showFile(currentFile);
    }
  }
}
export function reportAgentIdle(): void {
  if (!enabled) return;
  lastActivity = "think";
  currentFile = undefined;
  showFile(undefined);
}
async function showFile(filePath?: string): Promise<void> {
  const rel = filePath ? filePath.replace(/\\/g, "/") : "idle";
  const uri = vscode.Uri.from({ scheme: ARC_SCHEME, path: `/${rel}` });
  try {
    if (prevEditor && prevEditor.document.uri.toString() !== uri.toString()) {
      await prevEditor.hide();
      prevEditor = undefined;
    }
    if (!prevEditor) {
      const doc = await vscode.workspace.openTextDocument(uri);
      prevEditor = await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
      });
    }
  } catch {
  }
}
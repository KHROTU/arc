import * as vscode from "vscode";
export interface Notifier {
  notify(kind: "done" | "awaiting" | "handoff" | "error", message: string): void;
}
export function setNotifier(_n: Notifier) {}
export function makeVSCodeNotifier(): Notifier {
  return {
    notify(kind, message) {
      const cfg = vscode.workspace.getConfiguration("arc.notifications");
      if (cfg.get("enabled") === false) return;
      void vscode.window.showInformationMessage(`Arc — ${labelFor(kind)}: ${message}`, { modal: false }, "Open Arc").then((a) => {
        if (a === "Open Arc") {
          void vscode.commands.executeCommand("arc.openSidebar");
        }
      });
    },
  };
}
function labelFor(kind: string): string {
  switch (kind) {
    case "done": return "Task complete";
    case "awaiting": return "Awaiting your input";
    case "handoff": return "Handoff occurred";
    case "error": return "Error";
    default: return kind;
  }
}
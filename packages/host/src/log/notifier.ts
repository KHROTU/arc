import * as vscode from "vscode";
import { spawn } from "node:child_process";
export interface Notifier {
  notify(kind: "done" | "awaiting" | "handoff" | "error", message: string): void;
}
let _notifier: Notifier | undefined;
export function setNotifier(n: Notifier): void {
  _notifier = n;
}
export function notify(kind: "done" | "awaiting" | "handoff" | "error", message: string): void {
  _notifier?.notify(kind, message);
}
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ");
}
function escapePsXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function showNative(title: string, body: string): void {
  const { platform } = process;
  if (platform === "darwin") {
    spawn("osascript", ["-e", `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`], { stdio: "ignore", shell: false });
  } else if (platform === "linux") {
    spawn("notify-send", [title, body, "--icon=dialog-information", "--urgency=normal"], { stdio: "ignore", shell: false });
  } else if (platform === "win32") {
    const ps = [
      "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null",
      `$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)`,
      `$t.GetElementsByTagName('text').Item(0).InnerText='${escapePsXml(title)}'`,
      `$t.GetElementsByTagName('text').Item(1).InnerText='${escapePsXml(body)}'`,
      `$n=[Windows.UI.Notifications.ToastNotification]::new($t)`,
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.VisualStudio.Code').Show($n)`,
    ].join("\n");
    const encoded = Buffer.from(ps, "utf-16le").toString("base64");
    spawn("powershell", ["-NoProfile", "-EncodedCommand", encoded], { stdio: "ignore", shell: false });
  }
}
export function makeVSCodeNotifier(): Notifier {
  return {
    notify(kind, message) {
      const cfg = vscode.workspace.getConfiguration("arc.notifications");
      if (cfg.get("enabled") === false) return;
      const label = `${kindLabels[kind] || kind}`;
      showNative(label, message);
    },
  };
}
const kindLabels: Record<string, string> = {
  done: "Arc — Task complete",
  awaiting: "Arc — Awaiting input",
  handoff: "Arc — Handoff occurred",
  error: "Arc — Error",
};
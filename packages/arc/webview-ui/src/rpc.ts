import type { HostMsg, WebviewMsg } from "@arc/host/protocol";
export type HostEvent = HostMsg;
export type WebviewRequest = WebviewMsg;
export type Listener = (e: HostEvent) => void;
export interface RpcClient {
  send(msg: WebviewRequest): void;
  on(listener: Listener): () => void;
  request<T = unknown>(key: string): Promise<T | undefined>;
}
declare function acquireVsCodeApi(): {
  postMessage: (m: unknown) => void;
  getState: () => unknown;
  setState: (s: unknown) => void;
};
const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
export function createClient(): RpcClient {
  const listeners = new Set<Listener>();
  const pending = new Map<string, (v: unknown) => void>();
  window.addEventListener("message", (ev: MessageEvent) => {
    const msg = ev.data as HostEvent;
    if (msg && (msg as { type?: string }).type === "config/get" && (msg as { inReplyTo?: string }).inReplyTo) {
      const cb = pending.get((msg as { inReplyTo: string }).inReplyTo);
      if (cb) {
        cb((msg as { value: unknown }).value);
        pending.delete((msg as { inReplyTo: string }).inReplyTo);
        return;
      }
    }
    for (const l of listeners) l(msg);
  });
  const client: RpcClient = {
    send(msg) {
      if (vscode) vscode.postMessage(msg);
      else console.debug("[arc] send", msg);
    },
    on(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    request<T>(key: string): Promise<T | undefined> {
      const id = `req-${Math.random().toString(36).slice(2, 10)}`;
      return new Promise((resolve) => {
        pending.set(id, (v) => resolve(v as T));
        if (vscode) vscode.postMessage({ type: "config/get", key, id });
        else resolve(undefined);
      });
    },
  };
  (window as unknown as { __ARC_ATTACH?: () => void }).__ARC_ATTACH = () => {
    vscode?.postMessage({ type: "ui/attachSelection" });
  };
  return client;
}
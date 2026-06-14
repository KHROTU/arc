import { spawn, ChildProcessByStdio } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as readline from "node:readline";
import { EventEmitter } from "node:events";
export type McpTransport =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };
export interface McpServerConfig {
  name: string;
  enabled: boolean;
  transport: McpTransport;
}
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}
type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
export interface McpServerNotification {
  server: string;
  method: string;
  params?: unknown;
}
export type McpClientStatus = "idle" | "starting" | "ready" | "reconnecting" | "stopped" | "error";
export interface McpClientOptions {
  reconnectInitialMs?: number;
  reconnectMaxMs?: number;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
}
export class McpClient extends EventEmitter {
  private id = 0;
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private proc?: ChildProcessByStdio<Writable, Readable, Readable>;
  private httpAbort?: AbortController;
  private httpEndpoint?: string;
  private httpSessionId?: string;
  private httpReady = false;
  private status: McpClientStatus = "idle";
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private healthTimer?: NodeJS.Timeout;
  private healthInflight: number | string | undefined;
  private shouldRun = false;
  private opts: Required<McpClientOptions>;
  constructor(public config: McpServerConfig, options: McpClientOptions = {}) {
    super();
    this.opts = {
      reconnectInitialMs: options.reconnectInitialMs ?? 1_000,
      reconnectMaxMs: options.reconnectMaxMs ?? 30_000,
      healthIntervalMs: options.healthIntervalMs ?? 60_000,
      healthTimeoutMs: options.healthTimeoutMs ?? 10_000,
    };
  }
  getServerName(): string {
    return this.config.name;
  }
  getStatus(): McpClientStatus {
    return this.status;
  }
  private setStatus(next: McpClientStatus) {
    if (this.status === next) return;
    this.status = next;
    this.emit("status", next);
  }
  async start() {
    this.shouldRun = true;
    this.setStatus("starting");
    if (this.config.transport.type === "stdio") {
      await this.startStdio();
    } else {
      await this.startHttp();
    }
    try {
      await this.send({ method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arc", version: "0.1.0" } } });
      this.sendNotification("notifications/initialized");
      this.setStatus("ready");
      this.scheduleHealth();
    } catch (e) {
      this.setStatus("error");
      throw e;
    }
  }
  async stop() {
    this.shouldRun = false;
    this.clearReconnect();
    this.clearHealth();
    if (this.healthInflight !== undefined) {
      this.pending.delete(this.healthInflight);
      this.healthInflight = undefined;
    }
    this.proc?.kill();
    this.httpAbort?.abort();
    this.proc = undefined;
    this.httpAbort = undefined;
    this.httpEndpoint = undefined;
    this.httpSessionId = undefined;
    this.httpReady = false;
    this.setStatus("stopped");
    const reason = "client stopped";
    for (const [id, p] of this.pending) {
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
  async listTools(): Promise<{ name: string; description?: string; inputSchema?: Record<string, unknown> }[]> {
    const r = await this.send({ method: "tools/list" });
    const tools = (r as { tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] })?.tools ?? [];
    return tools;
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const r = await this.send({ method: "tools/call", params: { name, arguments: args } });
    return (r as { content?: unknown }).content ?? r;
  }
  async listResources(): Promise<{ uri: string; name?: string; description?: string; mimeType?: string }[]> {
    const r = await this.send({ method: "resources/list" });
    return (r as { resources?: { uri: string; name?: string; description?: string; mimeType?: string }[] })?.resources ?? [];
  }
  async readResource(uri: string): Promise<unknown> {
    const r = await this.send({ method: "resources/read", params: { uri } });
    return (r as { contents?: unknown }).contents ?? r;
  }
  async listPrompts(): Promise<{ name: string; description?: string; arguments?: { name: string; description?: string; required?: boolean }[] }[]> {
    const r = await this.send({ method: "prompts/list" });
    return (r as { prompts?: { name: string; description?: string; arguments?: { name: string; description?: string; required?: boolean }[] }[] })?.prompts ?? [];
  }
  async getPrompt(name: string, args?: Record<string, unknown>): Promise<unknown> {
    const r = await this.send({ method: "prompts/get", params: { name, ...(args ? { arguments: args } : {}) } });
    return r;
  }
  private async send(req: Omit<JsonRpcRequest, "jsonrpc" | "id"> & { id?: number | string }): Promise<unknown> {
    const id = req.id ?? ++this.id;
    const full: JsonRpcRequest = { jsonrpc: "2.0", id, method: req.method, params: req.params };
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request '${req.method}' timed out`));
        }
      }, 60_000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
    if (this.config.transport.type === "stdio") {
      if (!this.proc) {
        this.pending.delete(id);
        throw new Error("MCP stdio process is not running");
      }
      this.proc.stdin.write(JSON.stringify(full) + "\n");
    } else {
      if (!this.httpReady || !this.httpEndpoint) {
        this.pending.delete(id);
        throw new Error("MCP HTTP transport is not connected");
      }
      this.sendHttp(full).catch((e) => {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          p.reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    }
    return promise;
  }
  private async sendHttp(req: JsonRpcRequest): Promise<void> {
    if (!this.httpEndpoint) throw new Error("MCP HTTP endpoint not set");
    if (this.config.transport.type !== "http") throw new Error("MCP transport is not HTTP");
    const endpoint = this.httpEndpoint;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.config.transport.headers,
    };
    if (this.httpSessionId) headers["mcp-session-id"] = this.httpSessionId;
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
      signal: this.httpAbort?.signal,
    });
    if (!res.ok) {
      throw new Error(`MCP HTTP error ${res.status}: ${await res.text()}`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) {
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.httpSessionId = sid;
      await this.consumeSseResponse(res.body, req.id);
      return;
    }
    const json = (await res.json()) as JsonRpcResponse;
    if (json.error) throw new Error(json.error.message);
    const p = this.pending.get(req.id);
    if (p) {
      this.pending.delete(req.id);
      p.resolve(json.result);
    }
  }
  private async consumeSseResponse(stream: ReadableStream<Uint8Array> | null, expectedId: number | string): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = parseSseBlock(block);
        if (!parsed) continue;
        for (const data of parsed) {
          const msg = safeJsonParse(data);
          if (!msg) continue;
          if ("id" in msg && msg.id !== undefined && msg.id !== null) {
            const id = msg.id as number | string;
            if (id === expectedId) {
              const r = msg as JsonRpcResponse;
              const p = this.pending.get(id);
              if (p) {
                this.pending.delete(id);
                if (r.error) p.reject(new Error(r.error.message));
                else p.resolve(r.result);
              }
            } else {
              this.handleMessage(msg as JsonRpcResponse);
            }
          } else {
            this.handleMessage(msg);
          }
        }
      }
    }
  }
  private sendNotification(method: string, params?: unknown) {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    if (this.config.transport.type === "stdio") {
      this.proc?.stdin.write(JSON.stringify(msg) + "\n");
    } else if (this.httpReady && this.httpEndpoint && this.config.transport.type === "http") {
      const endpoint = this.httpEndpoint;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...this.config.transport.headers,
      };
      if (this.httpSessionId) headers["mcp-session-id"] = this.httpSessionId;
      void fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(msg),
        signal: this.httpAbort?.signal,
      }).then(async (res) => {
        try { await res.body?.cancel(); } catch {}
      }).catch(() => {});
    }
  }
  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification) {
    if (!("id" in msg) || msg.id === undefined || msg.id === null) {
      const notif = msg as JsonRpcNotification;
      this.emit("notification", { server: this.config.name, method: notif.method, params: notif.params } satisfies McpServerNotification);
      return;
    }
    const r = msg as JsonRpcResponse;
    const p = this.pending.get(r.id as number | string);
    if (!p) return;
    this.pending.delete(r.id as number | string);
    if (r.error) p.reject(new Error(r.error.message));
    else p.resolve(r.result);
  }
  private async startStdio() {
    const t = this.config.transport;
    if (t.type !== "stdio") return;
    this.proc = spawn(t.command, t.args ?? [], { env: { ...process.env, ...t.env }, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessByStdio<Writable, Readable, Readable>;
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        this.handleMessage(msg);
} catch {  }
    });
    this.proc.stderr.on("data", (_d: Buffer) => {
    });
    const failAll = (reason: string) => {
      for (const [id, p] of this.pending) { p.reject(new Error(reason)); this.pending.delete(id); }
      this.proc = undefined;
      this.emit("exit", { code: -1, reason });
    };
    this.proc.on("error", (err) => {
      failAll(`MCP process error: ${err.message}`);
      if (this.shouldRun) this.scheduleReconnect();
    });
    this.proc.on("exit", (code) => {
      const reason = code !== 0 ? `MCP process exited with code ${code}` : "MCP process exited";
      failAll(reason);
      if (this.shouldRun) this.scheduleReconnect();
    });
  }
  private async startHttp() {
    const t = this.config.transport;
    if (t.type !== "http") return;
    this.httpAbort = new AbortController();
    const url = new URL(t.url);
    const headers: Record<string, string> = {
      accept: "text/event-stream, application/json",
      ...t.headers,
    };
    let res: Response;
    try {
      res = await fetch(url, { method: "GET", headers, signal: this.httpAbort.signal });
    } catch (e) {
      if (this.shouldRun) this.scheduleReconnect();
      throw new Error(`Failed to open MCP SSE stream: ${(e as Error).message}`);
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.httpSessionId = sid;
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !res.body || !ct.includes("text/event-stream")) {
      res.body?.cancel();
      this.httpEndpoint = t.url;
      this.httpReady = true;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = async (): Promise<void> => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseSseBlock(block);
          if (!parsed) continue;
          for (const data of parsed) {
            const text = data;
            if (text.startsWith("http")) {
              this.httpEndpoint = text.trim();
              this.httpReady = true;
              continue;
            }
            const msg = safeJsonParse(text);
            if (!msg) continue;
            this.handleMessage(msg);
          }
        }
      }
    };
    consume().catch((e) => {
      this.httpReady = false;
      this.httpEndpoint = undefined;
      this.emit("exit", { code: -1, reason: (e as Error).message });
      if (this.shouldRun) this.scheduleReconnect();
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for MCP endpoint event")), 15_000);
      const check = () => {
        if (this.httpReady) { clearTimeout(timer); resolve(); }
        else if (!this.shouldRun) { clearTimeout(timer); reject(new Error("stopped")); }
        else setTimeout(check, 25);
      };
      check();
    });
  }
  private scheduleReconnect() {
    if (!this.shouldRun) return;
    if (this.reconnectTimer) return;
    this.setStatus("reconnecting");
    const delay = Math.min(this.opts.reconnectMaxMs, this.opts.reconnectInitialMs * 2 ** Math.min(this.reconnectAttempts, 6));
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      if (!this.shouldRun) return;
      this.httpAbort?.abort();
      this.httpAbort = undefined;
      this.proc?.kill();
      this.proc = undefined;
      this.httpEndpoint = undefined;
      this.httpReady = false;
      try {
        await this.start();
      } catch {
      }
    }, delay);
  }
  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempts = 0;
  }
  private scheduleHealth() {
    this.clearHealth();
    if (this.opts.healthIntervalMs <= 0) return;
    this.healthTimer = setInterval(() => {
      void this.ping();
    }, this.opts.healthIntervalMs);
  }
  private clearHealth() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
  }
  async ping(): Promise<boolean> {
    if (this.status !== "ready") return false;
    if (this.healthInflight !== undefined) return false;
    const id = ++this.id;
    this.healthInflight = id;
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), this.opts.healthTimeoutMs));
    try {
      const result = await Promise.race([
        this.send({ id, method: "ping" }),
        timeout,
      ]);
      this.healthInflight = undefined;
      if (result === "timeout") {
        this.emit("unhealthy", { reason: "timeout" });
        return false;
      }
      return true;
    } catch {
      this.healthInflight = undefined;
      this.emit("unhealthy", { reason: "error" });
      return false;
    }
  }
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
function safeJsonParse(s: string): JsonRpcResponse | JsonRpcNotification | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function parseSseBlock(block: string): string[] | null {
  const out: string[] = [];
  const lines = block.split("\n");
  let cur = "";
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") {
      cur = cur ? cur + "\n" + value : value;
    } else if (field === "event") {
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : null;
}
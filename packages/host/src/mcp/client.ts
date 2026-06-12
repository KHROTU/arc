import { spawn, ChildProcessByStdio } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as readline from "node:readline";
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
export class McpClient {
  private id = 0;
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private proc?: ChildProcessByStdio<Writable, Readable, Readable>;
  private httpAbort?: AbortController;
  constructor(public config: McpServerConfig) {}
  async start() {
    if (this.config.transport.type === "stdio") {
      await this.startStdio();
    } else {
      await this.startHttp();
    }
    await this.send({ method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "arc", version: "0.1.0" } } });
  }
  async stop() {
    this.proc?.kill();
    this.httpAbort?.abort();
    this.proc = undefined;
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
  private async send(req: Omit<JsonRpcRequest, "jsonrpc" | "id"> & { id?: number | string }): Promise<unknown> {
    const id = req.id ?? ++this.id;
    const full: JsonRpcRequest = { jsonrpc: "2.0", id, method: req.method, params: req.params };
    if (this.config.transport.type === "stdio") {
      this.proc!.stdin.write(JSON.stringify(full) + "\n");
    } else {
      const res = await fetch(this.config.transport.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.config.transport.headers },
        body: JSON.stringify(full),
      });
      if (!res.ok) throw new Error(`MCP HTTP error ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as JsonRpcResponse;
      if (json.error) throw new Error(json.error.message);
      this.handleMessage(json);
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
  private handleMessage(msg: JsonRpcResponse) {
    if (msg.id === undefined || msg.id === null) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  }
  private async startStdio() {
    const t = this.config.transport;
    if (t.type !== "stdio") return;
    this.proc = spawn(t.command, t.args ?? [], { env: { ...process.env, ...t.env }, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessByStdio<Writable, Readable, Readable>;
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        this.handleMessage(msg);
} catch {  }
    });
  }
  private async startHttp() {
  }
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
import { McpClient, type McpServerConfig, type McpTransport, type McpClientStatus, type McpServerNotification } from "./client.js";
export interface McpTool {
  server: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
export interface McpResource {
  server: string;
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}
export interface McpPrompt {
  server: string;
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}
export interface McpServerInfo {
  name: string;
  enabled: boolean;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  transport: McpTransport;
  status: McpClientStatus;
}
interface ServerEntry {
  config: McpServerConfig;
  client?: McpClient;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}
export type McpListener = () => void;
export type McpPersistence = () => void | Promise<void>;
export class McpAggregator {
  private servers = new Map<string, ServerEntry>();
  private listeners = new Set<McpListener>();
  private persist?: McpPersistence;
  private resolveServer(name: string): ServerEntry | undefined {
    const direct = this.servers.get(name);
    if (direct) return direct;
    const lower = name.toLowerCase();
    for (const [key, entry] of this.servers) {
      if (key.toLowerCase() === lower) return entry;
      if (key.toLowerCase().endsWith("/" + lower) || key.toLowerCase().endsWith("_" + lower)) return entry;
    }
    return undefined;
  }
  setPersistence(fn: McpPersistence) {
    this.persist = fn;
  }
  private async persistNow() {
    try {
      await this.persist?.();
    } catch {
    }
  }
  async addServer(config: McpServerConfig) {
    const existing = this.servers.get(config.name);
    if (existing) {
      await existing.client?.stop();
      this.servers.delete(config.name);
    }
    const entry: ServerEntry = { config, tools: [], resources: [], prompts: [] };
    this.servers.set(config.name, entry);
    if (config.enabled) {
      try {
        await this.startServer(entry);
      } catch {
        entry.config.enabled = false;
      }
    }
    this.notify();
    await this.persistNow();
  }
  async removeServer(name: string) {
    const s = this.servers.get(name);
    if (!s) return;
    await s.client?.stop();
    this.servers.delete(name);
    this.notify();
    await this.persistNow();
  }
  async enableServer(name: string, enabled: boolean) {
    const s = this.servers.get(name);
    if (!s) return;
    if (enabled && !s.client) {
      s.config.enabled = true;
      await this.startServer(s);
    } else if (!enabled && s.client) {
      await s.client.stop();
      s.client = undefined;
      s.tools = [];
      s.resources = [];
      s.prompts = [];
      s.config.enabled = false;
    } else {
      s.config.enabled = enabled;
    }
    this.notify();
    await this.persistNow();
  }
  listServers(): McpServerInfo[] {
    return [...this.servers.values()].map((s) => ({
      name: s.config.name,
      enabled: s.config.enabled,
      tools: s.tools,
      resources: s.resources,
      prompts: s.prompts,
      transport: s.config.transport,
      status: s.client?.getStatus() ?? "idle",
    }));
  }
  listTools(): McpTool[] {
    const out: McpTool[] = [];
    for (const s of this.servers.values()) {
      if (s.config.enabled) out.push(...s.tools);
    }
    return out;
  }
  listResources(): McpResource[] {
    const out: McpResource[] = [];
    for (const s of this.servers.values()) {
      if (s.config.enabled) out.push(...s.resources);
    }
    return out;
  }
  listPrompts(): McpPrompt[] {
    const out: McpPrompt[] = [];
    for (const s of this.servers.values()) {
      if (s.config.enabled) out.push(...s.prompts);
    }
    return out;
  }
  async call(server: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: unknown }> {
    const s = this.resolveServer(server);
    if (!s) return { ok: false, output: `Unknown MCP server '${server}'` };
    if (!s.config.enabled) return { ok: false, output: `MCP server '${server}' is disabled.` };
    if (!s.client) return { ok: false, output: `MCP server '${server}' is not started.` };
    try {
      const out = await s.client.callTool(tool, args);
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }
  async readResource(server: string, uri: string): Promise<{ ok: boolean; output: unknown }> {
    const s = this.resolveServer(server);
    if (!s) return { ok: false, output: `Unknown MCP server '${server}'` };
    if (!s.client) return { ok: false, output: `MCP server '${server}' is not started.` };
    try {
      const out = await s.client.readResource(uri);
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }
  async getPrompt(server: string, name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; output: unknown }> {
    const s = this.resolveServer(server);
    if (!s) return { ok: false, output: `Unknown MCP server '${server}'` };
    if (!s.client) return { ok: false, output: `MCP server '${server}' is not started.` };
    try {
      const out = await s.client.getPrompt(name, args);
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }
  onChange(fn: McpListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onNotification(fn: (n: McpServerNotification) => void): () => void {
    const wrap = (n: McpServerNotification) => fn(n);
    for (const s of this.servers.values()) s.client?.on("notification", wrap);
    return () => {
      for (const s of this.servers.values()) s.client?.off("notification", wrap);
    };
  }
  private notify() {
    for (const l of this.listeners) l();
  }
  private async startServer(entry: ServerEntry) {
    const client = new McpClient(entry.config);
    client.on("notification", (n) => {
      void this.handleNotification(entry, n);
    });
    client.on("status", () => this.notify());
    client.on("unhealthy", () => this.notify());
    client.on("exit", () => this.notify());
    await client.start();
    entry.client = client;
    await new Promise((r) => setTimeout(r, 1500));
    await this.refreshEntry(entry);
    await new Promise((r) => setTimeout(r, 3000));
    await this.refreshEntry(entry);
  }
  private async refreshEntry(entry: ServerEntry) {
    if (!entry.client) return;
    try {
      entry.tools = (await entry.client.listTools()).map((t) => ({ ...t, server: entry.config.name }));
    } catch {
      entry.tools = [];
    }
    try {
      entry.resources = (await entry.client.listResources()).map((r) => ({ ...r, server: entry.config.name }));
    } catch {
      entry.resources = [];
    }
    try {
      entry.prompts = (await entry.client.listPrompts()).map((p) => ({ ...p, server: entry.config.name }));
    } catch {
      entry.prompts = [];
    }
  }
  private async handleNotification(entry: ServerEntry, n: McpServerNotification): Promise<void> {
    if (n.method === "notifications/tools/list_changed") {
      await this.refreshEntry(entry);
      this.notify();
    } else if (n.method === "notifications/resources/list_changed") {
      await this.refreshEntry(entry);
      this.notify();
    } else if (n.method === "notifications/prompts/list_changed") {
      await this.refreshEntry(entry);
      this.notify();
    }
  }
  async dispose() {
    for (const s of this.servers.values()) await s.client?.stop();
    this.servers.clear();
  }
}
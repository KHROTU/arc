import { McpClient, type McpServerConfig } from "./client.js";
export interface McpTool {
  server: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
export class McpAggregator {
  private servers = new Map<string, { config: McpServerConfig; client: McpClient; tools: McpTool[] }>();
  private listeners = new Set<() => void>();
  async addServer(config: McpServerConfig) {
    const client = new McpClient(config);
    await client.start();
    const tools = (await client.listTools()).map((t) => ({ ...t, server: config.name }));
    this.servers.set(config.name, { config, client, tools });
    this.notify();
  }
  async removeServer(name: string) {
    const s = this.servers.get(name);
    if (!s) return;
    await s.client.stop();
    this.servers.delete(name);
    this.notify();
  }
  listServers(): { name: string; enabled: boolean; tools: McpTool[]; transport: McpServerConfig["transport"] }[] {
    return [...this.servers.values()].map((s) => ({
      name: s.config.name,
      enabled: s.config.enabled,
      tools: s.tools,
      transport: s.config.transport,
    }));
  }
  listTools(): McpTool[] {
    const out: McpTool[] = [];
    for (const s of this.servers.values()) out.push(...s.tools);
    return out;
  }
  async call(server: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: unknown }> {
    const s = this.servers.get(server);
    if (!s) return { ok: false, output: `Unknown MCP server '${server}'` };
    try {
      const out = await s.client.callTool(tool, args);
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, output: (e as Error).message };
    }
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() {
    for (const l of this.listeners) l();
  }
  async dispose() {
    for (const s of this.servers.values()) await s.client.stop();
    this.servers.clear();
  }
}
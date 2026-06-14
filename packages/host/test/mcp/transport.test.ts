import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import { McpClient } from "../../src/mcp/client";
import type { AddressInfo } from "node:net";
import type { McpServerNotification } from "../../src/mcp/client";
interface FakeMcpServer {
  url: string;
  close: () => Promise<void>;
  push: (event: string, data: string) => void;
  closeStream: () => void;
  toolList: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
  resourceList: { uri: string; name?: string; description?: string; mimeType?: string }[];
  promptList: { name: string; description?: string; arguments?: { name: string; description?: string; required?: boolean }[] }[];
  callLog: { name: string; args: Record<string, unknown> }[];
  readResourceLog: string[];
  getPromptLog: { name: string; args?: Record<string, unknown> }[];
  pending: Map<string, http.ServerResponse>;
}
function startFakeMcp(opts: { onInitialize?: () => void; sendEndpointAfterInit?: boolean } = {}): Promise<FakeMcpServer> {
  const toolList = [
    { name: "echo", description: "Echoes input", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  ];
  const resourceList = [
    { uri: "file://hello.txt", name: "hello", mimeType: "text/plain" },
  ];
  const promptList = [
    { name: "greet", description: "Greet someone", arguments: [{ name: "who", required: true }] },
  ];
  const state: FakeMcpServer = {
    url: "",
    close: async () => {},
    push: () => {},
    closeStream: () => {},
    toolList,
    resourceList,
    promptList,
    callLog: [],
    readResourceLog: [],
    getPromptLog: [],
    pending: new Map(),
  };
  return new Promise<FakeMcpServer>((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.method === "GET" && req.headers.accept?.includes("text/event-stream")) {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          if (opts.sendEndpointAfterInit !== false) {
            const port = (server.address() as AddressInfo).port;
            res.write(`event: endpoint\ndata: http://127.0.0.1:${port}/msg\n\n`);
          }
          state.push = (event, data) => {
            res.write(`event: ${event}\ndata: ${data}\n\n`);
          };
          state.closeStream = () => {
            res.end();
          };
          req.on("close", () => {
            state.pending.clear();
          });
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (c: Buffer) => (body += c.toString()));
          req.on("end", () => {
            const reqJson = JSON.parse(body);
            const id = reqJson.id;
            const method = reqJson.method;
            let result: unknown = null;
            if (method === "initialize") {
              result = { protocolVersion: "2024-11-05", capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "fake", version: "0.0.1" } };
              opts.onInitialize?.();
            } else if (method === "notifications/initialized") {
              res.writeHead(202).end();
              return;
            } else if (method === "tools/list") {
              result = { tools: state.toolList };
            } else if (method === "resources/list") {
              result = { resources: state.resourceList };
            } else if (method === "prompts/list") {
              result = { prompts: state.promptList };
            } else if (method === "tools/call") {
              const args = reqJson.params?.arguments ?? {};
              state.callLog.push({ name: reqJson.params.name, args });
              result = { content: [{ type: "text", text: `called ${reqJson.params.name} with ${JSON.stringify(args)}` }] };
            } else if (method === "resources/read") {
              state.readResourceLog.push(reqJson.params.uri);
              result = { contents: [{ uri: reqJson.params.uri, text: `content of ${reqJson.params.uri}` }] };
            } else if (method === "prompts/get") {
              state.getPromptLog.push({ name: reqJson.params.name, args: reqJson.params.arguments });
              result = { messages: [{ role: "user", content: { type: "text", text: `Hello, ${reqJson.params.arguments?.who ?? "world"}` } }] };
            } else if (method === "ping") {
              result = {};
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
          });
          return;
        }
        res.writeHead(404).end();
      } catch (e) {
        res.writeHead(500).end((e as Error).message);
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      state.url = `http://127.0.0.1:${port}/sse`;
      state.close = async () => {
        await new Promise<void>((r) => server.close(() => r()));
      };
      resolve(state);
    });
  });
}
describe("McpClient HTTP/SSE transport", () => {
  let state: FakeMcpServer;
  let client: McpClient;
  beforeEach(async () => {
    state = await startFakeMcp();
    client = new McpClient(
      { name: "fake", enabled: true, transport: { type: "http", url: state.url } },
      { reconnectInitialMs: 100_000, reconnectMaxMs: 100_000, healthIntervalMs: 0 },
    );
  });
  afterEach(async () => {
    await client.stop();
    await state.close();
  });
  it("connects, initializes, and lists tools via SSE", async () => {
    await client.start();
    expect(client.getStatus()).toBe("ready");
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["echo"]);
  });
  it("calls a tool and returns the response", async () => {
    await client.start();
    const result = await client.callTool("echo", { text: "hi" });
    expect(state.callLog).toEqual([{ name: "echo", args: { text: "hi" } }]);
    const arr = Array.isArray(result) ? (result as { type: string; text: string }[]) : ((result as { content?: { type: string; text: string }[] }).content ?? []);
    expect(arr[0].text).toContain("echo");
    expect(arr[0].text).toContain("hi");
  });
  it("lists resources and reads a resource", async () => {
    await client.start();
    const resources = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(["file://hello.txt"]);
    const result = await client.readResource("file://hello.txt");
    const arr = Array.isArray(result) ? (result as { uri: string; text: string }[]) : ((result as { contents?: { uri: string; text: string }[] }).contents ?? []);
    expect(arr[0].text).toContain("file://hello.txt");
  });
  it("lists prompts and gets a prompt with arguments", async () => {
    await client.start();
    const prompts = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["greet"]);
    const r = await client.getPrompt("greet", { who: "world" });
    const messages = (r as { messages: { role: string; content: { type: string; text: string } }[] }).messages;
    expect(messages[0].content.text).toBe("Hello, world");
  });
  it("emits notification events when the server pushes them", async () => {
    const received: McpServerNotification[] = [];
    client.on("notification", (n) => received.push(n));
    await client.start();
    state.push("message", JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(received.map((n) => n.method)).toContain("notifications/tools/list_changed");
  });
  it("supports health-check pings", async () => {
    await client.start();
    const ok = await client.ping();
    expect(ok).toBe(true);
  });
});
describe("McpClient HTTP/SSE reconnection", () => {
  it("schedules reconnect when the stream is closed by the server", async () => {
    let state = await startFakeMcp();
    const client = new McpClient(
      { name: "fake", enabled: true, transport: { type: "http", url: state.url } },
      { reconnectInitialMs: 50, reconnectMaxMs: 100, healthIntervalMs: 0 },
    );
    await client.start();
    expect(client.getStatus()).toBe("ready");
    state.closeStream();
    await new Promise((r) => setTimeout(r, 300));
    expect(["reconnecting", "ready", "starting"]).toContain(client.getStatus());
    await client.stop();
    await state.close();
  });
});
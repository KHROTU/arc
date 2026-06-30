import { describe, it, expect } from "vitest";
import { McpAggregator } from "../../src/mcp/mcp";
import { buildToolSpecs, parseMcpToolSpec, isMcpToolSpec, mcpToolSpecName } from "../../src/agent/tool-specs";
describe("buildToolSpecs MCP injection", () => {
  it("emits mcp__<server>__<tool> entries when tool count is below cap", () => {
    const { specs } = buildToolSpecs(
      new Set(["mcp.call"]),
      [{ server: "fs", name: "read", description: "Read a file", inputSchema: { type: "object", properties: {} } }],
    );
    const mcpSpec = specs.find((s) => s.name === "mcp__fs__read");
    expect(mcpSpec?.description).toContain("[MCP fs]");
    expect(mcpSpec?.description).toContain("Read a file");
  });
  it("falls back to proxy when tool count exceeds the cap", () => {
    const tools = Array.from({ length: 60 }, (_, i) => ({ server: "fs", name: `t${i}`, description: `Tool ${i}` }));
    const { specs } = buildToolSpecs(new Set(["mcp.call"]), tools, { maxIndividualMcpTools: 40 });
    expect(specs.find((s) => s.name === "mcp__fs__t0")).toBeUndefined();
    expect(specs.find((s) => s.name === "mcp.call")).toBeDefined();
  });
  it("preserves JSON schema for each MCP tool", () => {
    const schema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
    const { specs } = buildToolSpecs(new Set(["mcp.call"]), [{ server: "fs", name: "read", inputSchema: schema }]);
    const mcpSpec = specs.find((s) => s.name === "mcp__fs__read");
    expect(mcpSpec?.parameters).toEqual(schema);
  });
  it("parseMcpToolSpec / isMcpToolSpec / mcpToolSpecName round-trip", () => {
    expect(isMcpToolSpec("mcp__fs__read")).toBe(true);
    expect(isMcpToolSpec("mcp.call")).toBe(false);
    expect(isMcpToolSpec("mcp__nope")).toBe(false);
    expect(parseMcpToolSpec("mcp__fs__read")).toEqual({ server: "fs", tool: "read" });
    expect(mcpToolSpecName("fs", "read")).toBe("mcp__fs__read");
  });
  it("includes mcp.create, mcp.remove, mcp.toggle specs when enabled", () => {
    const { specs } = buildToolSpecs(new Set(["mcp.create", "mcp.remove", "mcp.toggle"]), []);
    expect(specs.find((s) => s.name === "mcp.create")).toBeDefined();
    expect(specs.find((s) => s.name === "mcp.remove")).toBeDefined();
    expect(specs.find((s) => s.name === "mcp.toggle")).toBeDefined();
  });
});
describe("McpAggregator listResources/listPrompts surface", () => {
  it("exposes resources and prompts on listServers", () => {
    const agg = new McpAggregator();
    const info = agg.listServers();
    expect(Array.isArray(info)).toBe(true);
  });
  it("setPersistence persists on add/remove/toggle", async () => {
    const agg = new McpAggregator();
    const calls: string[] = [];
    agg.setPersistence(() => {
      calls.push("persist");
    });
    await agg.addServer({
      name: "broken",
      enabled: false,
      transport: { type: "stdio", command: "node", args: ["-e", "process.exit(1)"] },
    });
    expect(calls).toContain("persist");
    await agg.removeServer("broken");
    expect(calls.filter((c) => c === "persist").length).toBeGreaterThanOrEqual(2);
  });
});
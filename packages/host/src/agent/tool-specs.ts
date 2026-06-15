import type { ToolSpec } from "../providers/transport.js";
type JsonSchema = Record<string, unknown>;
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const str = (description: string): JsonSchema => ({ type: "string", description });
const num = (description: string): JsonSchema => ({ type: "number", description });
const bool = (description: string): JsonSchema => ({ type: "boolean", description });
const enumStr = (values: string[], description: string): JsonSchema => ({ type: "string", enum: values, description });
export const TOOL_PARAM_SPECS: Record<string, { description: string; parameters: JsonSchema }> = {
  "file.read": {
    description: "Read a file from the workspace.",
    parameters: obj({
      path: str("Workspace-relative file path."),
      offset: num("Optional 1-based start line. Defaults to 1."),
      limit: num("Optional max lines to return. Defaults to the entire file."),
    }, ["path"]),
  },
  "file.edit": {
    description: "Apply an edit to an existing file. PREFER the SEARCH/REPLACE block format in `search` over plain text — it expresses intent unambiguously and survives whitespace drift:\n\npath/to/file.ts\n<<<<<<< SEARCH\nexact text to find (include enough surrounding lines to be unique)\n=======\nreplacement text\n>>>>>>> REPLACE\n\nFall back to plain `search` + `replace` strings only for trivial one-line tweaks. If you must pass plain text, include enough surrounding lines to make the match unique.",
    parameters: obj({
      path: str("Workspace-relative file path."),
      search: str("SEARCH/REPLACE block (preferred) or exact text to find. For SEARCH/REPLACE: include a header line, then '<<<<<<< SEARCH' / search content / '=======' / replace content / '>>>>>>> REPLACE'."),
      replace: str("Replacement text. Ignored when `search` is a SEARCH/REPLACE block (the block's REPLACE section is used)."),
      replaceAll: bool("Replace every occurrence instead of the first."),
      runAfter: str("Optional shell command to run after the edit (e.g. 'pnpm build')."),
    }),
  },
  "file.write": {
    description: "Create a new file or overwrite an existing one.",
    parameters: obj({
      path: str("Workspace-relative file path."),
      content: str("Full file contents."),
      runAfter: str("Optional shell command to run after writing (e.g. 'pnpm test')."),
    }),
  },
  "file.grep": {
    description: "Search the workspace for a regex pattern using ripgrep.",
    parameters: obj({
      pattern: str("The regex pattern to search for in file contents."),
      include: str("Optional file pattern filter (e.g. '*.ts', '*.{ts,tsx}')."),
    }, ["pattern"]),
  },
  "file.glob": {
    description: "Find files matching a glob pattern.",
    parameters: obj({
      pattern: str("Glob pattern (e.g. '**/*.ts', 'src/**/*.tsx')."),
    }, ["pattern"]),
  },
  "shell.run": {
    description: "Run a shell command in the workspace (subject to approval).",
    parameters: obj({
      command: str("The command line to run."),
      cwd: str("Optional working directory (defaults to the workspace root)."),
      timeout: str("Optional timeout in seconds. Use -1 for no limit (default)."),
    }),
  },
  "shell.backgroundRun": {
    description: "Launch a long-running shell process in the background.",
    parameters: obj({
      command: str("The command line to run."),
      cwd: str("Optional working directory (defaults to the workspace root)."),
    }, ["command"]),
  },
  "shell.check": {
    description: "Poll output and status of a background process.",
    parameters: obj({
      id: str("The background process id returned by shell.backgroundRun."),
    }, ["id"]),
  },
  "shell.write": {
    description: "Send input to a running background process.",
    parameters: obj({
      id: str("The background process id."),
      input: str("The input to send (e.g. y/n confirmation, arrow keys)."),
    }, ["id", "input"]),
  },
  "shell.customRun": {
    description: "Define a named series of shell commands and persist them as a skill. Use for repeatable workflows like build-test-lint cycles.",
    parameters: obj({
      name: str("A short, descriptive name for this custom run (e.g. 'full-check')."),
      commands: { type: "array", items: { type: "string" }, description: "Ordered list of shell commands to run." },
      overwrite: bool("Set true to replace an existing run with the same name."),
    }, ["name", "commands"]),
  },
  "shell.editCustomRun": {
    description: "Update a previously-defined custom run by its id.",
    parameters: obj({
      id: str("The custom run id (returned when it was created)."),
      commands: { type: "array", items: { type: "string" }, description: "New ordered list of shell commands." },
      name: str("Optional new name for the run."),
    }, ["id"]),
  },
  "shell.runCustomRun": {
    description: "Execute a previously-defined custom run by its id. Runs each command sequentially and reports per-command results.",
    parameters: obj({
      id: str("The custom run id to execute."),
      cwd: str("Optional working directory (defaults to workspace root)."),
    }, ["id"]),
  },
  "lsp.problems": {
    description: "Get ALL current LSP problems across the workspace.",
    parameters: obj({}),
  },
  "lsp.problemsFor": {
    description: "Get LSP problems for a single file.",
    parameters: obj({ path: str("Workspace-relative file path.") }, ["path"]),
  },
  "todo.write": {
    description: "Set the live to-do plan. Keep exactly one item in_progress at a time.",
    parameters: obj({
      items: {
        type: "array",
        description: "The full to-do list (replaces the previous one).",
        items: obj({
          id: str("Stable id for the item."),
          text: str("What the step does."),
          state: enumStr(["pending", "in_progress", "done", "skipped"], "Item state."),
        }, ["id", "text", "state"]),
      },
    }, ["items"]),
  },
  "browser.navigate": {
    description: "Navigate the browser to a URL.",
    parameters: obj({ url: str("Absolute URL.") }, ["url"]),
  },
  "browser.click": {
    description: "Click an element by selector.",
    parameters: obj({ selector: str("CSS selector.") }, ["selector"]),
  },
  "browser.type": {
    description: "Type text into an element.",
    parameters: obj({ selector: str("CSS selector."), text: str("Text to type.") }, ["selector", "text"]),
  },
  "browser.screenshot": {
    description: "Capture a screenshot of the current page.",
    parameters: obj({ path: str("Optional output path.") }),
  },
  "browser.evaluate": {
    description: "Evaluate JavaScript in the page.",
    parameters: obj({ script: str("JavaScript source to run.") }, ["script"]),
  },
  "browser.readDom": {
    description: "Read the page's accessibility tree.",
    parameters: obj({}),
  },
  "browser.close": {
    description: "Close the browser.",
    parameters: obj({}),
  },
  "webfetch": {
    description: "Fetch raw text content from a web URL.",
    parameters: obj({
      url: str("Full URL to fetch."),
    }, ["url"]),
  },
  "file.semanticSearch": {
    description: "Semantic search across the workspace via the local embedding index.",
    parameters: obj({
      query: str("Natural-language query."),
      k: num("Optional max results (default 10)."),
    }, ["query"]),
  },
  "mcp.call": {
    description: "Call a tool exposed by a connected MCP server.",
    parameters: obj({
      server: str("MCP server name."),
      tool: str("Tool name on that server."),
      args: { type: "object", description: "Arguments for the tool.", additionalProperties: true },
    }, ["server", "tool"]),
  },
  "mcp.create": {
    description: "Define and register a new MCP server during the session. For stdio servers, provide command + args. For HTTP/SSE servers, provide url.",
    parameters: obj({
      name: str("Unique name for the new server."),
      enabled: bool("Start the server immediately. Defaults to true."),
      transport: {
        type: "object",
        description: "Transport definition.",
        properties: {
          type: enumStr(["stdio", "http"], "Transport type."),
          command: str("stdio: command to spawn."),
          args: { type: "array", items: { type: "string" }, description: "stdio: command arguments." },
          env: { type: "object", additionalProperties: { type: "string" }, description: "stdio: extra env vars." },
          url: str("http: SSE endpoint URL."),
          headers: { type: "object", additionalProperties: { type: "string" }, description: "http: extra headers." },
        },
        required: ["type"],
      },
    }, ["name", "transport"]),
  },
  "mcp.remove": {
    description: "Remove a previously registered MCP server and stop its process.",
    parameters: obj({
      name: str("Name of the server to remove."),
    }, ["name"]),
  },
  "mcp.toggle": {
    description: "Enable or disable a registered MCP server without removing it.",
    parameters: obj({
      name: str("Name of the server."),
      enabled: bool("True to enable, false to disable."),
    }, ["name", "enabled"]),
  },
  "mcp.resources/list": {
    description: "List resources exposed by a connected MCP server.",
    parameters: obj({
      server: str("MCP server name."),
    }, ["server"]),
  },
  "mcp.resources/read": {
    description: "Read a resource URI from a connected MCP server.",
    parameters: obj({
      server: str("MCP server name."),
      uri: str("Resource URI."),
    }, ["server", "uri"]),
  },
  "mcp.prompts/list": {
    description: "List prompt templates exposed by a connected MCP server.",
    parameters: obj({
      server: str("MCP server name."),
    }, ["server"]),
  },
  "mcp.prompts/get": {
    description: "Fetch a prompt template from a connected MCP server, optionally with arguments.",
    parameters: obj({
      server: str("MCP server name."),
      name: str("Prompt template name."),
      args: { type: "object", description: "Optional template arguments.", additionalProperties: true },
    }, ["server", "name"]),
  },
  "checkpoint.revert": {
    description: "Revert files modified during a turn. Args: { index } (1=most recent) or { turnId } (exact UUID). Use checkpoint.list first to find available turns.",
    parameters: obj({
      index: num("1-based index of the checkpoint to revert to (1 is most recent). Use this OR turnId — not both."),
      turnId: str("Exact turn UUID from checkpoint.list. Use this OR index — not both."),
    }),
  },
  "checkpoint.list": {
    description: "List all available checkpoint snapshots for the current workspace. Returns turn IDs, timestamps, and affected files — most recent first.",
    parameters: obj({}),
  },
  "subagent.spawn": {
    description: "Spawn one or more subagents on a (typically cheaper) tier to do delegated grunt work. Use 'batch' to launch parallel subagents.",
    parameters: obj({
      name: str("Short subagent name (ignored if batch is set)."),
      instructions: str("What the subagent should do (ignored if batch is set)."),
      tier: enumStr(["free", "light", "default", "heavy"], "Optional tier to run on."),
      modelId: str("Optional explicit model id."),
      rules: obj({
        blockedCommands: { type: "array", items: { type: "string" }, description: "Commands the subagent may not run without parent approval." },
        requireApproval: bool("If true, ALL shell commands require parent approval."),
      }),
      batch: {
        type: "array",
        description: "Launch multiple subagents in parallel. Each item has name, instructions, tier, modelId, rules.",
        items: obj({
          name: str("Short subagent name."),
          instructions: str("What the subagent should do."),
          tier: enumStr(["free", "light", "default", "heavy"], "Optional tier to run on."),
          modelId: str("Optional explicit model id."),
          rules: obj({
            blockedCommands: { type: "array", items: { type: "string" }, description: "Commands the subagent may not run without parent approval." },
            requireApproval: bool("If true, ALL shell commands require parent approval."),
          }),
        }, ["name", "instructions"]),
      },
    }, ["name", "instructions"]),
  },
  "subagent.askParent": {
    description: "Ask the parent agent a clarifying question (subagents only).",
    parameters: obj({
      question: str("The question."),
      options: { type: "array", items: { type: "string" }, description: "Optional answer choices." },
    }, ["question"]),
  },
  "handoff": {
    description: "Hand the conversation to a heavier or lighter model.",
    parameters: obj({
      reason: str("Why the handoff is needed."),
      direction: enumStr(["escalate", "de-escalate"], "escalate to a heavier model or de-escalate to a lighter one."),
    }, ["reason"]),
  },
  "clarification.askUser": {
    description: "Ask the human a clarifying question with 2-4 options.",
    parameters: obj({
      question: str("The question to ask."),
      options: { type: "array", items: { type: "string" }, description: "2-4 answer choices." },
    }, ["question"]),
  },
};
export function buildToolSpecs(
  enabled: Iterable<string>,
  mcpTools?: { server: string; name: string; description?: string; inputSchema?: Record<string, unknown> }[],
  opts?: { maxIndividualMcpTools?: number },
): ToolSpec[] {
  const specs: ToolSpec[] = [];
  for (const name of enabled) {
    const def = TOOL_PARAM_SPECS[name];
    if (!def) continue;
    specs.push({ name, description: def.description, parameters: def.parameters });
  }
  const mcpEnabled = new Set(enabled);
  const tools = mcpTools ?? [];
  const maxIndividual = opts?.maxIndividualMcpTools ?? 40;
  if (tools.length > 0 && tools.length <= maxIndividual) {
    for (const t of tools) {
      const specName = mcpToolSpecName(t.server, t.name);
      if (!VALID_SPEC_NAME.test(specName)) continue;
      if (mcpEnabled.has("mcp.call") || mcpEnabled.has(specName)) {
        specs.push({
          name: specName,
          description: `[MCP ${t.server}] ${t.description ?? t.name}`,
          parameters: t.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
        });
      }
    }
  }
  return specs;
}
const MCP_TOOL_SEP = "__";
const VALID_SPEC_NAME = /^[a-zA-Z0-9_-]+$/;
export function mcpToolSpecName(server: string, tool: string): string {
  return `mcp${MCP_TOOL_SEP}${server}${MCP_TOOL_SEP}${tool}`;
}
export function isMcpToolSpec(name: string): boolean {
  return name.startsWith("mcp__") && name.indexOf("__", 5) > 5;
}
export function parseMcpToolSpec(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith("mcp__")) return undefined;
  const rest = name.slice(5);
  const idx = rest.indexOf("__");
  if (idx <= 0) return undefined;
  return { server: rest.slice(0, idx), tool: rest.slice(idx + 2) };
}
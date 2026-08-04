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
    }, ["path"]),
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
  "test.run": {
    description: "Run tests in the workspace. Auto-detects vitest, jest, mocha, pytest, or go test. Use scope to narrow: 'workspace' (all), 'file' (single file), 'failed' (re-run failures).",
    parameters: obj({
      scope: enumStr(["workspace", "file", "nearest", "failed"], "Test scope to run. Defaults to 'workspace'."),
      path: str("Optional file path to test when scope is 'file'."),
    }),
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
    description: "Set the live to-do plan. Keep exactly one item in_progress at a time. Tasks can have nested children for substeps.",
    parameters: obj({
      items: {
        type: "array",
        description: "The full to-do list (replaces the previous one).",
        items: obj({
          id: str("Stable id for the item."),
          text: str("What the step does."),
          state: enumStr(["pending", "in_progress", "done", "skipped", "blocked", "failed"], "Item state."),
          children: {
            type: "array",
            description: "Optional sub-steps for this item.",
            items: obj({
              id: str("Stable id for the sub-step."),
              text: str("What the sub-step does."),
              state: enumStr(["pending", "in_progress", "done", "skipped", "blocked", "failed"], "Sub-step state."),
            }, ["id", "text", "state"]),
          },
        }, ["id", "text", "state"]),
      },
    }, ["items"]),
  },
  "browser.navigate": {
    description: "Navigate the browser to a URL.",
    parameters: obj({ url: str("Absolute URL."), tabId: str("Optional tab id to target (defaults to the active tab).") }, ["url"]),
  },
  "browser.click": {
    description: "Click an element by selector.",
    parameters: obj({ selector: str("CSS selector."), tabId: str("Optional tab id to target (defaults to the active tab).") }, ["selector"]),
  },
  "browser.type": {
    description: "Type text into an element.",
    parameters: obj({ selector: str("CSS selector."), text: str("Text to type."), tabId: str("Optional tab id to target (defaults to the active tab).") }, ["selector", "text"]),
  },
  "browser.screenshot": {
    description: "Capture a screenshot of the current page.",
    parameters: obj({ path: str("Optional output path."), tabId: str("Optional tab id to target (defaults to the active tab).") }),
  },
  "browser.evaluate": {
    description: "Evaluate JavaScript in the page.",
    parameters: obj({ script: str("JavaScript source to run."), tabId: str("Optional tab id to target (defaults to the active tab).") }, ["script"]),
  },
  "browser.readDom": {
    description: "Read the page's accessibility tree.",
    parameters: obj({ tabId: str("Optional tab id to target (defaults to the active tab).") }),
  },
  "browser.close": {
    description: "Close the browser.",
    parameters: obj({}),
  },
  "browser.newTab": {
    description: "Open a new browser tab, optionally navigating to a URL. The new tab becomes active.",
    parameters: obj({ url: str("Optional URL to navigate the new tab to.") }),
  },
  "browser.switchTab": {
    description: "Switch the active tab used by browser tools that omit tabId.",
    parameters: obj({ tabId: str("The tab id to make active (see browser.listTabs).") }, ["tabId"]),
  },
  "browser.closeTab": {
    description: "Close a browser tab by id.",
    parameters: obj({ tabId: str("The tab id to close.") }, ["tabId"]),
  },
  "browser.listTabs": {
    description: "List all open browser tabs with their ids, URLs, and which one is active.",
    parameters: obj({}),
  },
  "browser.intercept": {
    description: "Intercept network requests matching a URL glob pattern (e.g. '**/api/**'), to mock a response or block the request entirely. Applies to all tabs.",
    parameters: obj({
      pattern: str("URL glob pattern to match, e.g. '**/api/users' or '**/*.png'."),
      status: num("HTTP status code to respond with when mocking (default 200)."),
      body: str("Response body to return when mocking."),
      contentType: str("Content-Type header for the mocked response (default application/json)."),
      block: bool("If true, aborts matching requests instead of returning a mocked response."),
    }, ["pattern"]),
  },
  "browser.unintercept": {
    description: "Stop intercepting requests matching a previously registered pattern.",
    parameters: obj({ pattern: str("The exact pattern previously passed to browser.intercept.") }, ["pattern"]),
  },
  "web.fetch": {
    description: "Fetch raw text content from a web URL.",
    parameters: obj({
      url: str("Full URL to fetch."),
    }, ["url"]),
  },
  "web.search": {
    description: "Search the web using DuckDuckGo and return the top results.",
    parameters: obj({
      query: str("Search query string."),
      count: num("Maximum number of results to return (default 10, max 20)."),
    }, ["query"]),
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
  "session.exportTrace": {
    description: "Export the session execution timeline as markdown and JSON. Shows all model calls, tool invocations, handoffs, compactions, approvals, and subagent spawns with timing and usage data.",
    parameters: obj({}),
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
  "checkpoint.compare": {
    description: "Compare two checkpoints and show which files changed between them. Args: { indexA, indexB } (1-based indices from checkpoint.list) or { turnIdA, turnIdB } (exact UUIDs).",
    parameters: obj({
      indexA: num("1-based index of the first checkpoint."),
      indexB: num("1-based index of the second checkpoint."),
      turnIdA: str("Exact turn UUID of the first checkpoint."),
      turnIdB: str("Exact turn UUID of the second checkpoint."),
    }),
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
  "mode.switch": {
    description: "Switch the active agent mode at runtime. Use to transition between plan, code, ask, and debug modes as the task evolves.",
    parameters: obj({
      slug: str("The mode slug to switch to (plan, code, ask, debug, or a user-defined mode)."),
    }, ["slug"]),
  },
  "skill.read": {
    description: "Read a skill's full instructions by name. Skills provide specialized workflows, tool integrations, and domain expertise.",
    parameters: obj({
      name: str("The skill name to read (as listed in the Available Skills section of the system prompt)."),
    }, ["name"]),
  },
  "skill.use": {
    description: "Load a skill's full instructions and enumerate its available scripts, references, and assets. Use this over skill.read when you need to know what bundled resources (scripts, references, assets) the skill provides.",
    parameters: obj({
      name: str("The skill name to load."),
    }, ["name"]),
  },
  "memory.list": {
    description: "List stored memories from MEMORY.md.",
    parameters: obj({ limit: num("Max entries to return (default 20).") }),
  },
  "memory.edit": {
    description: "Edit a memory by its index from memory.list.",
    parameters: obj({
      index: num("Memory index to edit."),
      content: str("New content for the memory."),
    }, ["index", "content"]),
  },
  "memory.delete": {
    description: "Delete a memory by its index from memory.list.",
    parameters: obj({
      index: num("Memory index to delete."),
    }, ["index"]),
  },
  "memory.add": {
    description: "Persist a durable fact, preference, or gotcha to MEMORY.md.",
    parameters: obj({
      category: str("Category: preferences, architecture, or gotchas."),
      content: str("The memory content to store."),
    }, ["category", "content"]),
  },
  "rule.list": {
    description: "List all available rules with their glob patterns and descriptions.",
    parameters: obj({}, []),
  },
  "rule.read": {
    description: "Read a rule's full body by name.",
    parameters: obj({ name: str("Rule name to read.") }, ["name"]),
  },
  "rule.create": {
    description: "Create a workspace-scoped rule under ~/.arc/workspaces/<workspace>/rules/.",
    parameters: obj({
      name: str("Rule name (filename without .md)."),
      glob: str("File glob pattern to match (e.g. *.ts)."),
      description: str("What this rule governs."),
      body: str("Markdown body with the rule instructions."),
    }, ["name", "glob", "description", "body"]),
  },
  "git.diffStaged": {
    description: "Show the staged diff (git diff --cached). Optionally scope to a single file with `path`.",
    parameters: obj({ path: str("Optional workspace-relative file path to scope the diff to.") }),
  },
  "git.diffUnstaged": {
    description: "Show the unstaged diff (git diff). Optionally scope to a single file with `path`.",
    parameters: obj({ path: str("Optional workspace-relative file path to scope the diff to.") }),
  },
  "git.changedFiles": {
    description: "List all changed files in the working tree with their status (staged vs unstaged).",
    parameters: obj({}),
  },
  "git.branchDiff": {
    description: "Show the diff between the current branch and its merge base with a target branch (defaults to 'main'). Falls back to 'master' if merge-base fails.",
    parameters: obj({ base: str("Optional target branch to diff against. Defaults to 'main'.") }),
  },
  "git.commitMessage": {
    description: "Supply a diff to compose a conventional commit message, or call without arguments to fetch the current staged diff.",
    parameters: obj({ diff: str("Optional diff text to base the commit message on.") }),
  },
  "browser.hover": {
    description: "Hover over an element matching a CSS selector.",
    parameters: obj({ selector: str("CSS selector of the element to hover.") }, ["selector"]),
  },
  "browser.scroll": {
    description: "Scroll the page by pixel offset or to an element matching a CSS selector.",
    parameters: obj({
      pixels: num("Pixel offset to scroll (positive = down, negative = up). Defaults to 300."),
      selector: str("Optional CSS selector to scroll into view."),
      tabId: str("Optional tab id to target (defaults to the active tab)."),
    }),
  },
  "browser.waitFor": {
    description: "Wait for a selector to appear, a URL to match, or a load state before proceeding.",
    parameters: obj({
      selector: str("CSS selector to wait for."),
      url: str("URL pattern to wait for."),
      state: str("Load state: networkidle, load, or domcontentloaded. Defaults to networkidle."),
      tabId: str("Optional tab id to target (defaults to the active tab)."),
    }),
  },
  "browser.console": {
    description: "Read the browser's console log (last 50 entries, log/warn/error).",
    parameters: obj({ tabId: str("Optional tab id to target (defaults to the active tab).") }),
  },
  "browser.network": {
    description: "Read the browser's network request log (last 50 entries with method, status, URL, timing).",
    parameters: obj({ tabId: str("Optional tab id to target (defaults to the active tab).") }),
  },
  "browser.domSnapshot": {
    description: "Get a combined snapshot of the browser's current state including console messages and network requests.",
    parameters: obj({ tabId: str("Optional tab id to target (defaults to the active tab).") }),
  },
  "browser.drag": {
    description: "Drag an element onto another element.",
    parameters: obj({
      from: str("CSS selector of the element to drag."),
      to: str("CSS selector of the drop target."),
      tabId: str("Optional tab id to target (defaults to the active tab)."),
    }, ["from", "to"]),
  },
  "browser.dialog": {
    description: "Set how the next browser dialog (alert/confirm/prompt) is handled.",
    parameters: obj({
      accept: bool("True to accept the dialog (default), false to dismiss it."),
      promptText: str("Text to enter when the dialog is a prompt."),
    }),
  },
  "browser.runCode": {
    description: "Run a Playwright code snippet against the page. The code receives the `page` object.",
    parameters: obj({
      code: str("JavaScript/Playwright snippet to run."),
      tabId: str("Optional tab id to target (defaults to the active tab)."),
    }, ["code"]),
  },
  "browser.readPage": {
    description: "Read the plain text content of the current page.",
    parameters: obj({ tabId: str("Optional tab id to target (defaults to the active tab).") }),
  },
  "notebook.read": {
    description: "Read a Jupyter notebook (.ipynb). Without cellIndex, lists every cell (index, type, source preview, whether it has output). With cellIndex, returns that cell's full source and (for code cells) its text/image output.",
    parameters: obj({
      path: str("Workspace-relative path to the .ipynb file."),
      cellIndex: num("Optional 0-based cell index to read in full."),
    }, ["path"]),
  },
  "notebook.editCell": {
    description: "Replace the source of a cell in a Jupyter notebook by index.",
    parameters: obj({
      path: str("Workspace-relative path to the .ipynb file."),
      cellIndex: num("0-based index of the cell to edit."),
      source: str("New source text for the cell."),
    }, ["path", "cellIndex", "source"]),
  },
  "notebook.addCell": {
    description: "Insert a new cell into a Jupyter notebook at the given index. Existing cells shift down.",
    parameters: obj({
      path: str("Workspace-relative path to the .ipynb file."),
      index: num("0-based index to insert the new cell at."),
      cellType: enumStr(["code", "markdown", "raw"], "Type of the new cell."),
      source: str("Source text for the new cell."),
    }, ["path", "index", "cellType", "source"]),
  },
  "notebook.deleteCell": {
    description: "Delete a cell from a Jupyter notebook by index.",
    parameters: obj({
      path: str("Workspace-relative path to the .ipynb file."),
      cellIndex: num("0-based index of the cell to delete."),
    }, ["path", "cellIndex"]),
  },
  "notebook.execute": {
    description: "Execute a code cell using the workspace's active Jupyter kernel and return its text/image output.",
    parameters: obj({
      path: str("Workspace-relative path to the .ipynb file."),
      cellIndex: num("0-based index of the code cell to execute."),
    }, ["path", "cellIndex"]),
  },
};
export function buildToolSpecs(
  enabled: Iterable<string>,
  mcpTools?: { server: string; name: string; description?: string; inputSchema?: Record<string, unknown> }[],
  opts?: { maxIndividualMcpTools?: number },
): { specs: ToolSpec[]; mcpReverse: Map<string, { server: string; tool: string }> } {
  const specs: ToolSpec[] = [];
  const mcpReverse: Map<string, { server: string; tool: string }> = new Map();
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
        mcpReverse.set(specName, { server: t.server, tool: t.name });
        specs.push({
          name: specName,
          description: `[MCP ${t.server}] ${t.description ?? t.name}`,
          parameters: t.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
        });
      }
    }
  }
  return { specs, mcpReverse };
}
const MCP_TOOL_SEP = "__";
const VALID_SPEC_NAME = /^[a-zA-Z0-9_-]+$/;
function safeServerName(server: string): string {
  return server.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
export function mcpToolSpecName(server: string, tool: string): string {
  return `mcp${MCP_TOOL_SEP}${safeServerName(server)}${MCP_TOOL_SEP}${tool}`;
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
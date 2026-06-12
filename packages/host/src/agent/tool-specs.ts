import type { ToolSpec } from "../providers/transport.js";
type JsonSchema = Record<string, unknown>;
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const str = (description: string): JsonSchema => ({ type: "string", description });
const bool = (description: string): JsonSchema => ({ type: "boolean", description });
const enumStr = (values: string[], description: string): JsonSchema => ({ type: "string", enum: values, description });
export const TOOL_PARAM_SPECS: Record<string, { description: string; parameters: JsonSchema }> = {
  "file.read": {
    description: "Read a file from the workspace.",
    parameters: obj({ path: str("Workspace-relative file path.") }, ["path"]),
  },
  "file.edit": {
    description: "Apply a search/replace edit to an existing file.",
    parameters: obj({
      path: str("Workspace-relative file path."),
      search: str("Exact text to find."),
      replace: str("Replacement text."),
      replaceAll: bool("Replace every occurrence instead of the first."),
    }, ["path", "search", "replace"]),
  },
  "file.write": {
    description: "Create a new file or overwrite an existing one.",
    parameters: obj({
      path: str("Workspace-relative file path."),
      content: str("Full file contents."),
    }, ["path", "content"]),
  },
  "shell.run": {
    description: "Run a shell command in the workspace (subject to approval).",
    parameters: obj({
      command: str("The command line to run."),
      cwd: str("Optional working directory (defaults to the workspace root)."),
    }, ["command"]),
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
  "mcp.call": {
    description: "Call a tool exposed by a connected MCP server.",
    parameters: obj({
      server: str("MCP server name."),
      tool: str("Tool name on that server."),
      args: { type: "object", description: "Arguments for the tool.", additionalProperties: true },
    }, ["server", "tool"]),
  },
  "subagent.spawn": {
    description: "Spawn a subagent on a (typically cheaper) tier to do delegated grunt work.",
    parameters: obj({
      name: str("Short subagent name."),
      instructions: str("What the subagent should do."),
      tier: enumStr(["free", "light", "default", "heavy"], "Optional tier to run on."),
      modelId: str("Optional explicit model id."),
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
export function buildToolSpecs(enabled: Iterable<string>): ToolSpec[] {
  const specs: ToolSpec[] = [];
  for (const name of enabled) {
    const def = TOOL_PARAM_SPECS[name];
    if (!def) continue;
    specs.push({ name, description: def.description, parameters: def.parameters });
  }
  return specs;
}
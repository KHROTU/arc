# TODO

## Tier 1: Foundation

[x] **Consolidate settings into fullscreen chat modal and fix startup UX** — Four related issues: (1) Remove the separate `SettingsView.tsx` webview panel entirely — settings (models, providers, MCP) should render as a large modal overlay on top of the fullscreen chat, triggered via the settings gear icon. (2) Settings changes currently require closing and reopening the fullscreen chat because `createAgent` snapshots config at panel creation time — make settings changes hot-reload the active agent's tool context and model registry without a panel restart. (3) Extension activation (`initializeAsync`) is async and slow — the fullscreen chat can open before registry/chat history finishes loading, showing no models, no chats, and no tools. Add a loading gate that defers the `openFullscreen` command until initialization completes, or show a spinner until ready. (4) Polish the sidebar chat: rework the top bar layout (logo, model selector, new-chat button), refine the onboarding/welcome text copy, tighten spacing, and bring it visually in line with the fullscreen view.
[x] **Add dedicated in-webview approval UI for commands and destructive actions** — Currently shell approvals and destructive-action confirmations use `vscode.window.showWarningMessage` (a native OS modal). Replace with a custom in-webview prompt styled consistently with the Arc chat UI (inline card with command preview, Allow/Deny buttons, keyboard shortcuts). This covers shell.run, shell.backgroundRun, file.write overwrites, git destructive operations, and batch edits. Surface reason, command text, and allowlist controls inline. (Needed before subagent approval routing — establishes the approval UI pattern.)
[x] **Wire browser adapter into tool context** — All 7 browser tools (navigate, click, type, screenshot, evaluate, readDom, close) are registered in `enabledTools` but `createAgent` never passes a `browser` adapter to `toolContext`. Every browser call returns `"Browser not available."`. Initialize Playwright's Chromium in the extension host, manage lifecycle (start on first use or activation, close on deactivation), and pass the adapter through the tool context so the agent can actually drive a browser.
[x] **Add tool call support to Ollama transport** (`packages/host/src/providers/ollama.ts`) — The Ollama transport currently sends messages as `{ role, content }` only, with no tool definitions or tool call response parsing. Wire the existing `tool-specs.ts` JSON Schema definitions through the Ollama `/api/chat` request and parse `message.tool_calls` in the stream response.
[x] **MCP foundation cleanup** — Three small MCP fixes that establish a clean MCP baseline: (1) Implement `mcp/toggleServer`: the `WebviewMsg` union already defines `mcp/toggleServer` (protocol.ts L112) but no handler exists. Add `toggleServer()`/`enableServer()` on `McpAggregator`, add the webview handler, filter `listTools()` by `enabled`, and add the UI toggle. (2) Deduplicate MCP UI: `McpPanel.tsx` and `SettingsView.tsx` have ~85% identical MCP server list/add/remove UI — consolidate into a single shared component. (3) Handle duplicate `addServer` gracefully: calling `addServer()` with an existing server name silently overwrites the old entry without calling `stop()`, leaking the child process. Check for existing and either reject or cleanly stop-and-replace.

## Tier 2: Features & Integration

[x] **Implement interactive clarification rich cards** — Enhance the UI of the `clarification.askUser` prompt with descriptions, defaults, custom answers, and keyboard shortcuts for handling complex model queries. (Builds on the in-webview approval UI pattern established in Tier 1.)
[x] **Stream subagent process via existing UI** — Hook the subagent execution output into the existing streaming transcript UI so the user can watch subagent work in real-time rather than waiting blindly.
[x] **Support parallel subagent spawning** — Extend the `subagent.spawn` tool with a `batch` parameter so the initiating model can launch multiple subagents in one turn, collecting results before proceeding.
[x] **Add subagent run rules and command approval routing** — Add configuration options for subagents (command block lists) and implement logic to pause execution and route questionable commands back to the initiating parent agent for approval. (Depends on in-webview approval UI from Tier 1, and parallel subagent spawning from this tier.)
[x] **Add collapsible chat list sidebar in fullscreen view** — Add a toggle button in the fullscreen top bar to collapse/expand the chat list panel. Evaluate removing the sidebar webview entirely in favor of fullscreen-only chat, with the activity bar button launching directly into fullscreen mode. Consider alternative entry points (command palette, status bar toggle) for discoverability. (Depends on settings consolidation from Tier 1 — should not be tackled until the sidebar/fullscreen relationship is settled.)

## Tier 3: MCP Protocol

[x] **Implement MCP SSE/HTTP streaming transport** — `startHttp()` is an empty stub. The MCP 2024-11-05 spec mandates that HTTP transport uses Server-Sent Events: the client opens a GET with `Accept: text/event-stream`, receives an `endpoint` event containing the POST URL, then sends JSON-RPC to that endpoint. Implement SSE-based HTTP transport in `McpClient`. (Depends on MCP foundation cleanup from Tier 1 — the client class must be stable first.)
[x] **Inject MCP tool schemas into LLM tool definitions** — Currently the LLM sees only a single `mcp.call` proxy tool with `additionalProperties: true` args — it cannot see individual MCP tool schemas. Modify `buildToolSpecs()` (or add a separate pass) to dynamically register each MCP tool with its `inputSchema` as a distinct LLM tool (e.g. `mcp.<server>.<tool>`), falling back to the proxy pattern for servers with too many tools.
[x] **Implement `mcp.create` tool** — Create a tool definition that allows the agent to dynamically define and register its own MCP servers during a session, including process lifecycle management and tool discovery. (Depends on MCP lifecycle robustness — toggleServer, graceful addServer, SSE transport.)
[x] **Handle MCP server notifications** — `handleMessage()` drops all messages without an `id` (JSON-RPC notifications). MCP servers can send `notifications/tools/list_changed`, `notifications/resources/list_changed`, `notifications/resources/updated`, etc. Add handling for `tools/list_changed` at minimum — call `listTools()` to re-discover tools when the notification arrives. (Depends on MCP transport being solid from this tier.)
[x] **Add MCP server health monitoring and reconnection** — Add health checks (periodic ping), reconnection with backoff, and surface server status changes to the UI. (Depends on the `exit`/`error` handlers already in place, plus MCP notifications.)
[x] **Implement MCP resources and prompts** — The MCP spec defines `resources/list`, `resources/read`, `prompts/list`, `prompts/get`. None are implemented. Add these as agent tools or auto-injected context. (Depends on full MCP protocol support from this tier.)

## Tier 4: Core Architecture

[x] **Implement syntax-aware diff/apply** — Replace the current string-matching edit pipeline with a parser that understands SEARCH/REPLACE diff blocks without line numbers. This preserves surrounding whitespace and indentation better than the current exact/trim/fuzzy matchers. Target format:

  ```diff
  file.py
  <<<<<<< SEARCH
  def calculate_total(price, tax):
      return price + tax
  =======
  def calculate_total(price, tax, discount=0):
      return (price - discount) + tax
  >>>>>>> REPLACE
  ```

[x] **Implement parallel tool execution** — Modify the agent dispatcher to handle multiple concurrent tool calls emitted in a single turn, executing them asynchronously, handling partial failures, and collecting all results before proceeding to the next reasoning step.
[x] **Implement AI-powered context summarization** — The compaction trigger system (`CompactionTracker` with EWMA) and fixed truncation are already in place. Replace the stub `summarizeInProcess()` with a real LLM call that produces meaningful summaries of the truncated middle context, preserving key decisions, file paths, and error context.
[x] **Implement real-time tool output streaming** — Modify long-running tools (especially `shell.run` and `shell.backgroundRun`) to emit partial output events over the transport layer, and update the UI to render streaming chunks continuously without layout thrashing or scroll-anchoring conflicts. (Depends on parallel tool execution from Tier 4 for the event dispatch model.)
[x] **Implement semantic search via local embedding models** — Build an indexing pipeline that downloads and manages local ML models (nomic-embed-text for low-end, qwen3-embedding for mid(qwen3-embedding:0.6b)/high-end(qwen3-embedding:8b)). This requires generating embeddings for the entire codebase, maintaining a local vector database, and keeping the index synced with live file changes.

---

**Model assignments:** DeepSeek V4 Pro (Tier 1, $0.18) → MiniMax-M3 (Tiers 2-3, $0.22) → Qwen3.7 Max (Tiers 4-5, $0.72). Cheapest model for straightforward wiring, stepping up through protocol work, reserving the most capable model for architecture and advanced features.

# Arc

> [!WARNING]
> **This extension is in alpha testing.** Features, APIs, and configuration formats may change without notice. Expect bugs, incomplete functionality, and breaking changes between updates. Do not rely on Arc for production workflows.

[arc-demo.webm](https://github.com/user-attachments/assets/fa8d9d15-870f-49e2-b1ea-4ed57678483f)

Agentic coding extension for VS Code. Tiered model registry with multi-provider failover, conversation handoff, subagent delegation, MCP protocol support, browser automation, syntax-aware diff/apply, semantic code search, token-accurate context compaction, and checkpointing that scales with touched files, not repo size.

## Getting the extension

Install from VSIX:

```bash
# The VSIX is at the repo root:
code --install-extension packages/arc/arc-0.0.2.vsix
```

Or install from source (see [Run / dev](#run--dev) below).

## What it does

Pick a model, give it a task, let it work. It reads your files, runs shell commands, edits code, and checks LSP diagnostics as it goes. A few things that matter:

**Models** — Add any model from the catalog or bring your own. Each model belongs to a tier (free, light, default, heavy) and can be backed by multiple providers. If one provider goes down or rate-limits, Arc falls over to the next. The agent can also hand itself off to a heavier model mid-task and hand back when it's done. Subagents run on cheaper tiers so you're not burning the good model on file reads.

**File editing** — Search/replace with fuzzy matching that tolerates whitespace drift, blank-line collapse, and indentation differences. Also parses `<<<<<<< SEARCH` / `>>>>>>> REPLACE` diff blocks so the model can send multi-file patches without line numbers. Files get snapshotted before edits so you can retract any turn and undo everything.

**Semantic search** — Optionally index your workspace and search it with natural language. Two backends: a hash-based one that works offline with no model, and an Ollama one (nomic-embed-text:v1.5, qwen3-embedding:0.6b or 8b). The index skips node_modules, .git, dist, and lock files by default.

**Shell** — Shell commands go through an approval gate. You can set it to allowlist (whitelist specific commands), always ask, or never ask. Long-running commands stream output as it arrives instead of waiting until they finish.

**Browser** — Uses Playwright with Chromium. The agent can navigate, click, type, screenshot, evaluate JS, and read the DOM.

**MCP** — Talks to Model Context Protocol servers over stdio or SSE/HTTP. Each server's tools show up in the model's tool list directly. You can add servers from the settings modal or let the agent register them at runtime. Includes resource and prompt endpoints.

**Subagents** — The agent can fork off subagents onto cheaper tiers for grunt work (reading files, running tests, grepping). Multiple subagents can run in parallel. Subagents ask the parent before running shell commands and can be configured with per-subagent command blocklists.

**Context** — Uses real token counts from the provider, not a guess. A percentage bar in the top-right shows how much of the model's window you're using. When it gets close, Arc compacts the middle of the conversation by asking the model to summarize it (preserving decisions, file paths, and errors), so the agent doesn't lose track of what it was doing.

**Checkpoints** — Every file-edit turn snapshots only the files Arc touched. No full-repo copies. Retract a message and every edit from that turn rolls back.

**UI** — Sidebar or full-screen. Settings live in a modal. Approvals show up inline in the chat, not as OS dialogs. Custom system prompts auto-load from `AGENTS.md`, `CLAUDE.md`, and `.arc/instructions.md`.

## Run / dev

```bash
pnpm install
pnpm build:ext         # builds host + webview
# In VS Code: open this folder, press F5 (Run Arc Extension).
```

The repo's `.vscode/launch.json` is preconfigured to launch the Extension Development Host with `--extensionDevelopmentPath=${workspaceFolder}/packages/arc` after running the `build:ext` task.

## Package

```bash
pnpm package   # produces packages/arc/arc-0.0.2.vsix
```

## Layout

```filetree
packages/arc/              The extension (the thing vsce packages)
  package.json             Contribution points, commands, view container
  arc-0.0.2.vsix           Pre-built VSIX
  src/extension/           Extension entry point, activation, RPC wiring
  webview-ui/src/          React UI (sidebar, fullscreen, settings)
    components/            ArcChat, Composer, SettingsView, AgentProcess, etc.
  esbuild.config.mjs       Dual build (node CJS extension + browser IIFE webview)
packages/host/             Agent, tools, routing, MCP, providers, compaction, checkpoints
  src/agent/               Agent loop, tool execution, subagents, tool specs
  src/routing/             Model registry, tier-based handoff, provider failover
  src/providers/           Anthropic, OpenAI-compatible, Ollama transports
  src/mcp/                 MCP client (stdio + SSE), aggregator
  src/edit/                File read/edit/write, SEARCH/REPLACE block parser
  src/search/              Embedding backend, vector index, indexer, file watcher
  src/compaction/          Token estimation, model-aware compaction, LLM summarization
  src/checkpoint/          Content-addressed snapshot store with restore
  src/lsp/                 VS Code diagnostics bridge
  src/protocol/            Message types, process step types, transport interfaces
scripts/                   remove-comments.mjs, remove-blank-lines.mjs
playground/                Self-contained workspace for tool self-testing
```

## License

Apache-2.0. See `LICENSE`, `NOTICE`, and `THIRD_PARTY.md`.

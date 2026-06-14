# Arc (Alpha)

Agentic coding extension for VS Code. Built on a tiered model registry with multi-provider failover, full conversation handoff, subagent delegation, MCP, browser automation, and Kilo-style checkpoints that don't slow you down on big repos. Delivered through a quiet interface designed to minimize noise during agent runs.

## Features

- Sidebar chat + full-screen chat (width-native layout).
- Tiered model routing: `free | light | default | heavy`. Subagents can run on a different tier than the orchestrator. Main chat can hand off to a heavier model and hand back when done.
- Multi-provider per model: OpenRouter, OpenAI, Anthropic, Google, Groq, Ollama, vscode-lm, custom OpenAI-compatible. Failover + load-balance.
- MCP client (stdio + HTTP/SSE), Playwright-based browser automation (chromium + firefox).
- LSP diagnostics (workspace-wide or per-file problems snapshot).
- Checkpoints: content-addressed store that only snapshots files Arc actually touched. Retract a message → revert every edit back to that point. Scales with touched files, not repo size.
- Smart context compaction using the model's observed average thinking+response length.
- Custom system prompts with rules-file auto-loading (`AGENTS.md`, `CLAUDE.md`, `.arc/instructions.md`).
- Native completion notifications (toggleable).

## Run / dev

```bash
pnpm install
pnpm build:ext         # builds host + webview
# In VS Code: open this folder, press F5 (Run Arc Extension).
```

The repo's `.vscode/launch.json` is preconfigured to launch the Extension Development Host with `--extensionDevelopmentPath=${workspaceFolder}/packages/arc` after running the `build:ext` task.

## Package

```bash
pnpm package   # produces packages/arc/dist/arc-*.vsix
```

## Layout

```filetree
packages/arc/         The extension (the thing vsce packages)
  package.json        Contribution points, commands, view container
  src/extension/      Extension entry point, activation, RPC wiring
  webview-ui/src/     React UI (sidebar, fullscreen, settings)
    components/       AgentProcess, ArcChat, Composer, SettingsView, etc.
  esbuild.config.mjs  Dual build (node CJS extension + browser IIFE webview)
packages/host/        Agent, tools, routing, MCP, providers, compaction, checkpoints
  src/agent/          Agent loop, tool execution, subagents
  src/routing/        Model registry, tier-based handoff, provider failover
  src/providers/      Anthropic, OpenAI-compatible, Ollama transports
  src/mcp/            MCP client (stdio), aggregator
  src/edit/           File read/edit/write with fuzzy matching and diff engine
  src/compaction/     Model-aware context window tracking + summarization
  src/checkpoint/     Content-addressed snapshot store with restore
  src/lsp/            VS Code diagnostics bridge
  src/protocol/       Message types, process step types, transport interfaces
scripts/              remove-comments.mjs, remove-blank-lines.mjs
playground/           Self-contained workspace for tool self-testing
```

## License

Apache-2.0. See `LICENSE`, `NOTICE`, and `THIRD_PARTY.md`.

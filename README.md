# Arc

Agentic coding extension for VS Code. Built on a tiered model registry with multi-provider failover, full conversation handoff, subagent delegation, MCP, browser automation, and Kilo-style checkpoints that don't slow you down on big repos.

## Features
- Sidebar chat + full-screen chat (width-native layout).
- Tiered model routing: `free | light | default | heavy`. Subagents can run on a different tier than the orchestrator. Main chat can hand off to a heavier model and hand back when done.
- Multi-provider per model: OpenRouter, OpenAI, Anthropic, Google, Groq, Ollama, vscode-lm, custom OpenAI-compatible. Failover + load-balance.
- MCP client (stdio + HTTP/SSE), Playwright-based browser automation (chromium + firefox).
- LSP-grounded tools (diagnostics, hover, definition, references, symbols, code actions).
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

```
packages/arc/         The extension (the thing vsce packages)
  package.json        Contribution points, commands, view container
  src/host/           All host-side code (agent, routing, edit, mcp, ...)
  webview-ui/         Sidebar + full-screen React UIs (see components/AgentProcess.tsx)
  esbuild.config.mjs  Dual build (node CJS + browser IIFE)
scripts/              One-off node helpers (problems dump, cleanup)
DECISIONS.md          Decision log
DESIGN.md             Visual identity brief
PROGRESS.md           Milestone tracker
BLOCKERS.md           Anything not fully solved
```

## License
Apache-2.0. See `LICENSE`, `NOTICE`, and `THIRD_PARTY.md`.

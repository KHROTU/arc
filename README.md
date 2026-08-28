<p align="center"><img src="https://raw.githubusercontent.com/KHROTU/arc/main/packages/arc/assets/arc-logo-mono-text.png" alt="Arc" /></p>

**A lightweight, provider-agnostic agentic harness for VS Code.**

Arc is built for speed and precision. It combines a sophisticated multi-model orchestration layer with a deep toolset, including browser automation, MCP support, subagents, and semantic search, all within a sub-1MB footprint.

> [!NOTE]
> **Limited Time Offer:** For a limited time, Arc is offering free access to the GLM 5.2 model for all users with some caveats (responses may be slower and connectivity may be less reliable). See Settings > Providers inside the extension for more details.
> **Early Alpha:** Arc is evolving rapidly. We are actively refining APIs and features; expect frequent updates as we move toward a stable 1.0.

[arc-demo.webm](https://github.com/user-attachments/assets/fa8d9d15-870f-49e2-b1ea-4ed57678483f)

## Efficiency

| Extension | VSIX Size (as of August 28th, 2026) |
| :--- | :--- |
| **Arc** | **0.22 MB** |
| Cline | 19.17 MB |
| BLACKBOXAI Agent | 20.15 MB |
| Roo Code | 30.11 MB |
| Continue | 111.48 MB |
| Kilo Code | 115.77 MB |

Arc aims to provide a top-of-the-line agentic experience with a minimal footprint. By optimizing our dependency tree and focusing on native VS Code APIs, we keep the extension fast and portable.

## Features

### Specialties

- **Tiered model registry** (free/light/default/heavy). Start a chat with a default model, and watch it start subagents using free models for simple tasks, or hand off the entire chat to a heavy model for difficult tasks.
- **Auto Mode (Beta)**. Auto mode automatically routes prompts to the cheapest model that can handle the task. Relying on an in-house fine-tuned model, Auto mode makes sub-10ms decisions at 0.757 AUC based on internal testing. Crucially, Auto mode isn't limited to a specific set of models, and instead adapts to your configuration.
- **Provider-agnostic model aliases.** One model alias can be backed by multiple providers — 262+ built-ins plus BYOK — with automatic failover, weighted load balancing, and transparent switching when a provider is down, out of credits, or flaky.

### Tools

- **File Operations:** Read, write, edit, grep, glob, and semantic search.
- **Shell Execution:** Run commands (standard or background), manage processes, write to shells, configure custom execution commands, and wait without polling for a fixed delay, a specific time, a background process to finish, or a condition to become true.
- **Subagents & Handoff:** Spawn child agents, query parent agents, and hand off control between instances, with per-file locking to prevent concurrent edit conflicts.
- **Model Context Protocol:** Register, toggle, and remove MCP servers; call custom tools, resources, and prompts with MCP sampling and roots capabilities.
- **Git Integration:** View staged/unstaged diffs, inspect branch differences, list changed files, and generate commit messages.
- **Playwright Integration:** Navigate, click, drag, type, hover, scroll, evaluate scripts, run raw Playwright code, capture screenshots, read page content, read DOM/console/network activity, handle dialogs, manage multiple tabs, intercept network requests, and wait for specific page states.
- **Editor Integration:** Open inline chat at the cursor (Ctrl+L), right-click editor context actions ("Explain with Arc", "Fix with Arc"), and stream real-time diffs.
- **Prompt Polishing:** Optionally polish prompts before sending, allowing grammar/spelling-only fixes or full rewriting.
- **LSP Integration:** Check workspace diagnostics and identify file-specific problems.
- **Testing & Session Management:** Run automatically detected test suites, manage custom skills, track session history/traces, and update task progress.
- **Web Capabilities:** Fetch web page content and search the web.
- **Checkpoint Management:** List, compare, and revert to previous session checkpoints.
- **Memory & Rules:** Read, list, create, and modify persistent memories and behavioral rules. Per-workspace agent notes are stored in global `~/.arc` storage and injected into the system prompt of future sessions, so the next agent picks up where the last one left off.
- **Notebook Support:** Read, write, and execute Jupyter notebook cells with workspace kernel integration.
- **User Clarification:** Ask clarifying questions.

### Design

- **Secret scanning at write time.** Every `file.edit` and `file.write` runs through a pre-write hook that scans for AWS keys, GitHub tokens, OpenAI/Anthropic API keys, private key PEM blocks, and hardcoded secrets. You can add custom regex patterns and commands. The scan runs before the file hits disk, so secrets never touch the filesystem.
- **Content-addressed checkpoints.** Snapshots only store the files you changed. Each file is hashed with SHA-256 and stored as `blobs/<prefix>/<hash>`, so identical states across turns share the same blob. Restoring writes blobs back, deletes newer metadata, and garbage-collects unreferenced blobs.
- **Reversible context compression.** Oversized tool outputs are content-aware compressed (JSON rows, logs, text) before entering history — originals are stored locally by content hash and restored on demand with `context.retrieve`, so nothing is lost.
- **Subagent tier delegation.** Subagents spawn one tier below the parent by default (e.g., default->light, light->free) so cheap models handle grunt work. The handoff process follows a fixed pattern both ways (escalate default->heavy, de-escalate heavy->default), and the agent preserves the to-do plan across handoffs so the new model picks up where the last left off. You can also pin subagents to a specific model or tier per invocation.
- **Prompt caching.** System prompts and conversation prefixes are structured with `cache_control` breakpoints to maximize Anthropic and OpenAI cache hits, reducing cost and latency for long-running sessions.
- **EMA-tracked compaction.** The engine maintains an exponential moving average of prompt and completion tokens per model. When estimated usage crosses the model's usable window (total minus a max-output reserve), it sends the conversation midsection to an LLM summarizer, replaces it with a single system message, and keeps the system prompt plus the last six messages intact. The safety margin is configurable per workspace.
- **Full agent resume.** Snapshots preserve browser tabs, MCP connections, and background processes. Sessions survive VS Code restarts with graceful degradation for missing resources.
- **Mode write-globs.** Each mode can declare a fail-closed glob that restricts which workspace file paths the agent may modify. Generated Arc configuration and state stay under `~/.arc` rather than a repository-local `.arc` directory.
- **Authenticated audit log.** Session traces use an HMAC-SHA-256 chain whose head is anchored in VS Code SecretStorage. Run `arc audit verify` to detect malformed, truncated, rolled-back, or modified logs.
- **Encrypted chat history.** Chat history is stored in Arc's own encrypted, compact ARCX binary format by default, providing better storage efficiency and security than JSON or SQLite.
- **Protected config writes.** Writes to config files (`.arc/`, `.vscode/`, `.cursor/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `.arcrules*`) always require explicit user approval, even with auto-approve enabled.
- **Per-session usage caps.** `web.search`, `subagent.spawn`, and `mcp.call` support configurable per-session caps via `ARC_MAX_WEB_SEARCHES_PER_SESSION`, `ARC_MAX_SUBAGENTS_PER_SESSION`, and `ARC_MAX_MCP_CALLS_PER_SESSION`.
- **Post-edit verification loop.** After each edit, lint and typecheck are automatically run via the LSP, and the agent autonomously fixes up to N times.
- **OS sandboxing for shell commands.** Shell execution supports `sandbox-exec` on macOS and `bwrap` on Linux. A selected but unavailable sandbox fails closed; Windows currently requires the `off` profile until a native process sandbox is available.
- **Dual-backend semantic search.** The indexing engine supports two backends: hash-based and semantic. The index uses a custom `ARCX` format for fast loading and saving. Incremental re-indexing keeps the index in sync without rebuilding.
- **Granular proxy fallback.** You can set a proxy per category—provider API calls, web tools, or shell commands—with a global fallback.
- **Custom modes UI.** Create and edit `.toml` mode definitions, update the default modes, and configure model binding from the settings panel, without touching config files.

## Featuren't

- **TUI/CLI/Remote access?** We believe agents are tools, not replacements. Working with agents and being responsible for quality is the most accountable way to use them while staying in the same window as your code editor. (Using any of the three methods mentioned makes it harder to track what changed; alternatively, doing so requires you to constantly switch between apps, which defeats the purpose of boosting productivity.)
- **Model routing/Cloud features?** We broke.
- **Slash commands/@-commands?** You're using a GUI. Use the buttons. If you prefer terminal-style inputs, go try OpenCode; it's really cool.
- **Autocomplete?** Inline LLM suggestions tend to be sluggish and (usually) mediocre. You’ll get faster and better results by writing the code yourself or by using and reviewing the work of agents.

## Getting Started

### Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=khrotu.arc-code) or directly via the VS Code CLI:

```bash
code --install-extension packages/arc/arc-code-0.6.2.vsix
```

### Development

To run Arc from source:

1. Clone the repository.
2. Run `pnpm install` and `pnpm build:ext`.
3. Press `F5` or `Run > Start Debugging` in VS Code to launch the Extension Development Host.

## License

Apache-2.0. See `LICENSE` for details.

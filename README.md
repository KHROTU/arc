<p align="center"><img src="packages/arc/assets/arc-logo-mono.png" alt="Arc" /></p>

**A high-performance, lightweight agentic coding assistant for VS Code.**

Arc is built for speed and precision. It combines a sophisticated multi-model orchestration layer with a deep toolset, including browser automation, MCP support, subagents, and semantic search, all within a sub-1MB footprint.

> [!NOTE]  
> **Early Alpha:** Arc is evolving rapidly. We are actively refining APIs and features; expect frequent updates as we move toward a stable 1.0.

[arc-demo.webm](https://github.com/user-attachments/assets/fa8d9d15-870f-49e2-b1ea-4ed57678483f)

## Core Principles

- **Model power scales with need.** Arc uses a tiered model registry to delegate sub-tasks to efficient models while reserving "heavy" models for complex reasoning.
- **Resource efficiency is the core.** We believe your tools shouldn't compete with your code for resources. Arc is designed to be zero-bloat, requiring no external runtimes or heavy binaries.
- **Context scales with precision.** Token-accurate tracking and LLM-powered summarization ensure your conversation stays focused, even as your project grows.

## Features

### Intelligent Routing & Context

- **Tiered Registry:** Map models to tiers (`free`, `light`, `default`, `heavy`). Subagents automatically scale up or down based on task complexity.
- **Provider Resilience:** 21+ built-in providers, including OpenAI, Anthropic, Google, OpenRouter, DeepSeek, xAI, Groq, Mistral, MiniMax, Kimi, Z.ai, Ollama, and morem with multi-provider failover, weighted load balancing, and bring-your-own-key support.
- **Subagent System:** Spawn parallel subagents that inherit tiered routing. Subagents work in isolated contexts for codebase exploration, research, and independent task execution.
- **Adaptive Compaction:** Calculates model-specific averages for thinking and response tokens to trigger precision summarization, maximizing usable context space.
- **Content-Addressed Checkpoints:** Snapshots only the specific files modified, enabling instant reverts and message retractions without repository-wide performance overhead.

### The Agentic Toolbelt

- **Precision Editing:** Syntax-aware `SEARCH/REPLACE` diffing that respects your codebase's indentation, style, and formatting.
- **MCP Ecosystem:** Add stdio and HTTP/SSE Model Context Protocol servers, or ask the agent to do so at runtime. Tools, resources, and prompt templates are automatically discovered and exposed to agents.
- **Local Semantic Search:** Fast, local embedding indices for finding code by intent, not just keywords. Dual backend (hash-based or Ollama) with incremental re-indexing.
- **Unified Shell:** Streamed terminal execution with parallel tool calling, background process support, and a granular approval system.
- **Browser Automation:** Built-in Playwright integration to navigate, interact with, and debug web applications directly from the chat. Includes console/network capture and advanced actions (hover, scroll, wait conditions).

### Mode & Skills Subsystem

- **Role-Based Modes:** Four built-in modes (**Plan**, **Code**, **Ask**, **Debug**) with distinct personas, tool access, and per-mode write restrictions. Supports dynamic runtime mode switching.
- **Custom Modes:** Drop a `.toml` file into your configuration directory to override or create modes with custom toolsets and file write restrictions.
- **Dynamic Skills:** Extend agent capabilities using `SKILL.md` files with YAML frontmatter. Arc automatically enumerates accompanying scripts or references and injects them into the system prompt on demand.

### Permissions, Security & Sandbox

- **Granular Approvals:** A matrix-based security layer allowing you to set fine-grained permissions (`auto` vs `ask`) across read, write, shell, browser, and MCP tools.
- **Session-Scoped Security:** Remembers approved commands or command prefixes until the window closes, paired with a one-click global override shield.
- **Lifecycle Hooks:** Execute custom actions across lifecycle events (e.g., pre/post tool execution, session start) via a robust JSON-decision protocol.
- **OS Sandboxing:** Optional shell sandboxing via `sandbox-exec` (macOS), `bwrap` (Linux), or WSB (Windows).

### Memory & Vision Support

- **Durable Memory:** Persistent fact-tracking across workspaces (`MEMORY.md`) with full runtime CRUD capabilities via the agent.
- **Multimodal & Fallback Vision:** Native support for vision-capable models. For text-only models, Arc gracefully routes images through a local/cloud vision model to generate text descriptions inline.

## Architecture & Efficiency

Arc aims to provide a top-of-the-line agentic experience with a minimal footprint. By optimizing our dependency tree and focusing on native VS Code APIs, we keep the extension fast and portable.

| Extension | VSIX Size (as of June 28th, 2026) |
| :--- | :--- |
| **Arc** | **0.24 MB** |
| Cline | 7.98 MB |
| BLACKBOXAI Agent | 20.15 MB |
| Roo Code | 30.11 MB |
| Kilo Code | 101.40 MB |
| Continue | 111.48 MB |

## Featuren't

- **TUI/CLI/Remote access?** We believe agents are tools, not replacements. Working with agents and being responsible for the quality is the most accountable way to use them, while staying in the same window where your code editor already is (basically, if you use any of the three methods in the title it's harder to know what changed, or if you do you need to constantly switch between apps which defeats the purpose of boosting productivity)
- **Model routing/Cloud features?** We broke.
- **Slash commands/@-commands?** You're using a GUI. Use the buttons. If you prefer terminal-style inputs, go try OpenCode, it's really cool.
- **Autocomplete?** Inline LLM suggestions tend to be sluggish and (usually) mediocre. You’ll get faster and better results by writing the code yourself or by using and reviewing the work of agents.

## Getting Started

### Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=khrotu.arc-code) or directly via the VS Code CLI:

```bash
code --install-extension packages/arc/arc-code-0.4.7.vsix
```

### Development

To run Arc from source:

1. Clone the repository.
2. Run `pnpm install` and `pnpm build:ext`.
3. Press `F5` in VS Code to launch the Extension Development Host.

## Project Structure

Arc is split into two main packages:

- `packages/arc`: The VS Code extension, UI components (React), and RPC wiring.
- `packages/host`: The core engine—agent loops, model routing, MCP clients, and file editing logic.

## License

Apache-2.0. See `LICENSE` for details.

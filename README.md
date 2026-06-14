# Arc

**A high-performance, lightweight agentic coding assistant for VS Code.**

Arc is built for speed and precision. It combines a sophisticated multi-model orchestration layer with a deep toolset - including browser automation, MCP support, and semantic search - all within a self-contained, 1MB footprint.

> [!NOTE]  
> **Early Alpha:** Arc is evolving rapidly. We are actively refining APIs and features; expect frequent updates as we move toward a stable 1.0.

[arc-demo.webm](https://github.com/user-attachments/assets/fa8d9d15-870f-49e2-b1ea-4ed57678483f)

## Core Principles

- Model power scales with need. Arc uses a tiered model registry to delegate sub-tasks to efficient models while reserving "heavy" models for complex reasoning.
- Reasource efficiency is the core. We believe your tools shouldn't compete with your code for resources. Arc is designed to be zero-bloat, requiring no external runtimes or heavy binaries.
- Context scales with precision. Token-accurate tracking and AI-powered summarization ensure your conversation stays focused, even as your project grows.

## Features

### Intelligent Routing

- **Tiered Registry:** Map models to tiers (`free`, `light`, `default`, `heavy`). Subagents automatically scale based on the task complexity.
- **Provider Resilience:** Native support for OpenRouter, Anthropic, OpenAI, Google, Ollama, and more. Arc supports multi-provider failover and load balancing to ensure uptime.
- **Seamless Handoff:** Continuity is preserved across model tiers, allowing the orchestrator to delegate work and resume context without friction.

### The Agentic Toolbelt

- **Precision Editing:** Syntax-aware `SEARCH/REPLACE` diffing that respects your codebase's indentation and style.
- **Local Semantic Search:** Fast, local embedding indices (including Ollama-powered backends) for finding code by meaning, not just keywords.
- **Unified Shell:** Streamed terminal execution with a robust approval system and support for long-running background processes.
- **Browser Automation:** Built-in Playwright integration to navigate, interact with, and debug web applications directly from the chat.
- **MCP Ready:** Full Model Context Protocol support. Inject tools, resources, and prompts from any server, or let the agent wire one up at runtime.

### Advanced Context Management

- **Adaptive Compaction:** Rather than using fixed context percentages, Arc calculates model-specific averages for thinking and response tokens to trigger summarization precisely, maximizing usable space with minimal disruption.
- **Parallel Execution:** Independent tool calls run concurrently, significantly reducing the "wait time" during complex agentic loops.
- **Content-Addressed Checkpoints:** Arc snapshots only the specific files it modifies, enabling speedy reverts and message retractions without the performance overhead or lag typical of large-scale repositories.

## Architecture & Efficiency

Arc aims to provide a top-of-the-line agentic experience with a minimal footprint. By optimizing our dependency tree and focusing on native VS Code APIs, we keep the extension fast and portable.

| Extension | VSIX Size (as of June 14th, 2026) |
| :--- | :--- |
| **Arc** | **0.69 MB** |
| Cline | 9.93 MB |
| Roo Code | 29.40 MB |
| Kilo Code | 74.91 MB |
| Continue | 107.8 MB |

## Getting Started

### Installation

Install the VSIX directly via the VS Code CLI:

```bash
code --install-extension packages/arc/arc-0.0.2-alpha.2.vsix
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

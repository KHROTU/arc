# Arc WISHLIST.md

## 1. Gap-Fillers: What Competitors Have That Arc Doesn't

| # | Feature | Who Has It | Priority | Notes |
|---|---------|-----------|----------|-------|
| G-10 | **Inline chat (Ctrl+L / Cmd+L)** | Copilot | High | Open a chat prompt directly in the editor for targeted, in-place edits without switching to the sidebar. |
| G-11 | **Code actions (right-click → "Explain with Arc", "Fix with Arc")** | Cline, Kilo Code, Copilot | High | Right-click context menu entries that send selected code + a prompt to the agent. |
| G-13 | **Notebook (.ipynb) support** | Copilot, Kilo Code | Low | Read/write/execute Jupyter notebook cells. |
| G-17 | **Custom modes via Arc settings UI** | Kilo Code, Copilot, Roo Code | Medium | Arc supports user-defined modes via `.toml` files (system prompts, tool restrictions, write-globs). Gap: no UI in settings to create or customize modes — requires manual file editing. |
| G-24 | **Automatic re-indexing (default-on)** | Copilot, Kilo Code (kilo-indexing), Continue | High | Arc has `IndexWatcher` (`fs.watch`, debounce, poll fallback, `reindexFile`). Gap: watcher is not started by default — index isn't kept hot automatically. |
| G-27 | **Context tracking (per-file read/edit history)** | Cline | Medium | Arc has `touchedFiles` in tool results and post-edit LSP diagnostic checks. Gap: no persistent `FileContextTracker` with per-file access timestamps and read/edit history. |

---

## 2. Enhancements: Arc Has It, but Competitors Do It Better

| # | Enhancement | Current State | Target | Inspiration |
|---|------------|---------------|--------|-------------|
| E-02 | **Structured post-edit verification** | Post-edit LSP check, `runAfter` cmd, pre-write & post-edit hooks exist | Add a structured verification loop: after edits, auto-run lint/typecheck and fix errors before presenting the result. Kilo Code calls this "self-checking." | Kilo Code |
| E-05 | **Retry with exponential backoff** | Provider failover with 30s failure cache; 3 fixed-delay retries for Anthropic; classifies 429/rate-limit errors | Exponential backoff with jitter, parse `Retry-After` headers, per-provider retry policies. | Codex |
| E-09 | **Rule hot-reload** | Rules loaded once at startup | Watch `.arc/rules/` for changes and reload without restarting the session | — |
| E-12 | **Network interception** | `browser.network` reads last 50 requests; no modify capability | Allow the agent to intercept, mock, or modify network requests for testing | Playwright |
| E-13 | **Multi-tab management** | Single page per browser instance | Multiple tabs with `browser.newTab`, `browser.switchTab` | — |
| E-17 | **MCP sampling / roots support** | Only tools, resources, and prompts | Support MCP `sampling` and `roots` capabilities for richer server-agent interaction | MCP spec |

---

## 3. Blue Ocean: Things Nobody Has (Yet) That People Want

These are features no competitor currently ships (or ships well), based on community feature requests, pain points, and emerging trends.

| # | Feature | Rationale | Complexity |
|---|---------|-----------|------------|
| B-03 | **Tamper-evident audit log export (SOC 2)** | Arc has `session.exportTrace` (Markdown/JSON timeline). Gap: not tamper-evident — no cryptographic chaining, no persistent structured format suitable for compliance. | Medium |
| B-15 | **Full agent resume across restarts** | Arc snapshots agent state (`agent.snapshot()`) on deactivate and restores messages/steps/todos on reactivate; chat history is persisted. Gap: MCP connections, browser state, and background processes are NOT preserved across restarts. Full resume is a differentiator. | Medium |
| B-21 | **Incremental indexing (wired up by default)** | Arc has `IndexWatcher` (`fs.watch`, debounce, `reindexFile`) but it isn't started by default. Wire it up so incremental re-indexing is automatic and instant out of the box. | Low |
| B-22 | **Prompt caching awareness** | Anthropic and OpenAI support prompt caching. Arc should structure its system prompt and conversation history to maximize cache hits, reducing cost and latency. | Medium |
| B-24 | **Streaming diff updates** | When the agent edits a file, show the diff streaming in real-time in the editor, character by character, instead of the current "edit complete" notification. | High |

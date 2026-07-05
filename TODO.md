# Arc Implementation TODO

> Ordered by dependency. `(ref: G-10)` = source in WISHLIST.md.

---

## Phase 1: Core Infrastructure

| Task | Ref | Description |
|------|-----|-------------|
| ✅ 1.1 IndexWatcher default-on | G-24, B-21 | Start `fs.watch`-based `IndexWatcher` on session init (`indexing.autoWatch`, `--no-watch` opt-out). Emit `index.updated`. Poll fallback for unreliable filesystems. |
| ✅ 1.2 FileContextTracker | G-27 | Persistent per-file read/edit history in `.arc/context.db`. Hook `touchedFiles`. Expose to agent context. LRU eviction. |
| ✅ 1.3 Rule hot-reload | E-09 | Watch `.arc/rules/`, re-parse on change, diff & apply to active session. Graceful fallback on invalid files. |
| ✅ 1.4 Exponential backoff + jitter | E-05 | Replace fixed-delay retries. Parse `Retry-After`. Per-provider policies with retry budgets. |
| ✅ 1.5 Prompt caching | B-22 | `cache_control` breakpoints (static prefix → history → latest). Minimize dynamic content in cacheable prefix. |

---

## Phase 2: Editor & Browser UX

| Task | Ref | Description |
|------|-----|-------------|
| ✅ 2.1 Inline chat (Ctrl+L) | G-10 | Floating input at cursor → agent → inline diff. Esc to dismiss. Similar to Copilot's inline chat. Uses FileContextTracker. |
| ✅ 2.2 Right-click code actions | G-11 | "Explain with Arc", "Fix with Arc" via `codeActionProvider`. Include LSP diagnostics. Active session + selection gated. |
| ✅ 2.3 Post-edit verification loop | E-02 | Auto lint → typecheck after edits, feed diagnostics to agent, retry fix up to N. Config in `.arc/verify.toml`. |
| ✅ 2.4 Streaming diffs | B-24 | Real-time streaming diff panel replacing "edit complete" notification. Accept/reject on finalize. |
| ✅ 2.5 Custom modes UI | G-17 | Webview panel to create/edit `.toml` modes. Fields: name, prompt, tools, write-globs, model. Validate on save. |
| ✅ 2.6 Multi-tab management | E-13 | `browser.newTab`, `.switchTab`, `.closeTab`, `.listTabs`. Existing tools accept optional `tabId`. |
| ✅ 2.7 Network interception | E-12 | `browser.intercept(pattern, mock)` / `.unintercept()` for mocking, blocking, or logging requests. |

---

## Phase 3: Enterprise & Advanced

| Task | Ref | Description |
|------|-----|-------------|
| ✅ 3.1 Full agent resume | B-15 | Extend `agent.snapshot()`: browser tabs (2.6), MCP connections, background processes. Restore on reactivate. `--resume-session`. Graceful degradation. |
| ✅ 3.2 Tamper-evident audit log | B-03 | JSONL export with SHA-256 hash chain. `arc audit verify <file>`. Include FileContextTracker (1.2). |
| ✅ 3.3 MCP sampling + roots | E-17 | `sampling/createMessage` → LLM, `roots/list` → workspace URIs. Permission gate per server. |
| ✅ 3.4 Notebook (.ipynb) support | G-13 | Index, read, edit, execute cells. Use workspace kernel. Render outputs (text + images). |

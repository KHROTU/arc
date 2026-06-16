# Arc — WISHLIST

A prioritized list of features, refinements, and capability gaps identified by comparing Arc against six competitors:

- **OpenAI Codex** (`openai/codex`, the Rust workspace under `codex-rs/`)
- **Anthropic Claude Code** (`anthropics/claude-code`, plugin-driven)
- **Cline** (`cline/cline`, `apps/vscode`)
- **Roo Code** (`RooCodeInc/Roo-Code`)
- **Kilo Code** (`Kilo-Org/kilocode`)
- **Continue** (`continuedev/continue`, `core/` + `extensions/vscode`)

> *Note on counting:* the README compares VSIX size against **five** extensions
> (Cline, BLACKBOXAI Agent, Roo Code, Kilo Code, Continue). BLACKBOXAI Agent is
> closed-source so it was skipped; the four open-source extension competitors
> plus Codex and Claude Code form the six-way comparison below. If a 7th slot
> is desired, Black Box's behavior would have to be derived from its
> marketplace listing rather than source.
>
> *Per the instructions, the following are explicitly **out of scope** and not
> tracked here:* CLI/TUI front-ends, JetBrains/cross-IDE ports, cloud
> dashboards/teams/SSO, hosted backend services, telemetry endpoints, paid
> plans, and proprietary model gateways.

Items are grouped by theme and tagged with the competitor(s) that already ship
the capability. Each tag references files actually present in the cloned
repositories so you can cross-check designs without re-cloning.

Priority key:

- 🔴 **P0** — table-stakes gap, ship before public 0.1
- 🟠 **P1** — strong differentiator, ship for 0.2
- 🟡 **P2** — quality / polish
- 🟢 **P3** — nice-to-have, optional

---

## 1. Plan / Mode System

Arc has a single behaviour ("agent") with an ad-hoc `shouldPlanFirst` heuristic
in `packages/host/src/agent/agent.ts` that injects a system message. Every
competitor exposes named, swappable *modes* that change the persona, the
allowed toolset, and the file-edit scope.

### 🔴 P0 — First-class Modes (Plan / Act / Ask / Architect / Debug / Orchestrator)
- *Roo*: `packages/types/src/mode.ts` ships `DEFAULT_MODES` with `architect`,
  `code`, `ask`, `debug`, `orchestrator`, each with `roleDefinition`,
  `whenToUse`, `groups` (tool-group whitelist), and per-mode `fileRegex` write
  restrictions.
- *Cline*: `src/core/prompts/system-prompt/components/act_vs_plan_mode.ts`
  ships a Plan vs Act distinction; `plan_mode_respond` and `act_mode_respond`
  tools enforce the boundary.
- *Continue*: agent / chat / edit / autocomplete are separate request paths in
  `core/`.

**Wishlist:**
1. Add a `Mode` registry (`packages/host/src/modes/`) with `slug`,
   `roleDefinition`, `allowedTools`, `writeGlob` (regex/glob restriction),
   `description`, `whenToUse`.
2. Ship 4 defaults: `plan` (no write/shell), `code` (full), `ask` (read-only
   + webfetch + semanticSearch), `debug` (full + bias toward `lsp.problems`,
   `shell.run` repro).
3. User-defined modes via `.arc/modes/<slug>.toml` (workspace) and
   `~/.arc/modes/` (global). Override `roleDefinition` and tool list.
4. A `mode.switch` pseudo-tool so the agent itself can hop (Roo's
   `SwitchModeTool.ts`).
5. Move the existing `shouldPlanFirst` heuristic into the `plan` mode and gate
   it on whether a `code`-tier mode was explicitly requested.

### 🟠 P1 — Per-mode File Write Restrictions
- *Roo*: `GroupOptions.fileRegex` blocks edits that don't match the mode's
  regex (e.g., architect mode can only edit `*.md`).

**Wishlist:** Honor `writeGlob` inside `file.edit`/`file.write` tools, before
the pre-write hooks run. Return a structured error with the violated mode so
the model can retry by escalating.

---

## 2. Skills / Reusable Procedural Knowledge

Arc has `prompts/` (workspace `AGENTS.md`, `CLAUDE.md`, `.arc/prompts/*.md`)
and `shell.customRun` skills. Every other competitor has a much richer "Skill"
concept that bundles instructions, scripts, references, and discovery
metadata.

### 🔴 P0 — Skills Subsystem
- *Codex*: `codex-rs/skills/` ships `install_system_skills` writing a sealed
  directory under `~/.codex/skills/.system/`. Each skill is a directory
  containing `SKILL.md` (YAML frontmatter: `name`, `description`,
  `short-description`), plus `agents/`, `assets/`, `references/`, `scripts/`.
  See `codex-rs/skills/src/assets/samples/skill-creator/`.
- *Claude Code*: plugins (`plugins/*/skills/`) bundle skills with hooks and
  agents (e.g., `frontend-design`, `hookify`).
- *Roo*: `src/services/skills/SkillsManager.ts`, plus a dedicated `SkillTool`
  and `apps/vscode/skills-lock.json` (it pins versions).
- *Cline*: identical `UseSkillToolHandler.ts` + `skills-lock.json`.
- *Continue*: `skills/cn-check/SKILL.md` and a `readSkill` tool
  (`core/tools/definitions/readSkill.ts`).

**Wishlist:**
1. `packages/host/src/skills/` with: a `SKILL.md` parser (YAML frontmatter +
   markdown body), a registry that scans `.arc/skills/<name>/` (workspace)
   and `~/.arc/skills/<name>/` (global), and a `skill-read` tool.
2. Inject the *titles + short-descriptions only* of available skills into the
   system prompt (so the model can decide to read one without paying tokens
   for content up-front). Mirror Codex's
   `context/available_skills_instructions.rs` approach.
3. A `skill.use` pseudo-tool that returns the full skill body (and lists its
   `scripts/`, `references/`, `assets/` paths) so the model loads it on
   demand.
4. A `skill-creator` built-in skill that walks the user through writing one
   (Codex's pattern).
5. A `skills-lock.json` alongside `.arc/` for reproducible pins when skills
   are pulled from a registry (Roo/Cline pattern).

### 🟡 P2 — Skill Marketplace / Discovery
- *Claude Code* has `/plugin` discovery; *Kilo* has
  `MarketplacePanelProvider.ts`.

**Wishlist:** stub a `arc.skills.add <git-url>` command that clones into
`~/.arc/skills/` and validates the `SKILL.md`. No hosted marketplace.

---

## 3. Slash Commands & User Workflows

Arc has VS Code commands but no in-chat `/` command grammar. Every competitor
supports them.

### 🔴 P0 — Slash Command Parser & Built-ins
- *Cline*: `src/core/slash-commands/index.ts` defines
  `SUPPORTED_DEFAULT_COMMANDS = ["newtask", "smol", "compact", "newrule",
  "reportbug", "deep-planning", "explain-changes"]`.
- *Codex*: `codex-rs/cli/` + `docs/slash_commands.md` cover `/init`, `/diff`,
  `/compact`, etc.
- *Roo*: `RunSlashCommandTool.ts`.
- *Claude Code*: every plugin contributes commands like `/code-review`,
  `/feature-dev`, `/commit`, `/ralph-loop`.
- *Continue*: `core/commands/slash/customSlashCommand.ts`,
  `mcpSlashCommand.ts`, `promptFileSlashCommand.ts`,
  `ruleBlockSlashCommand.ts`.

**Wishlist:**
1. Parse leading `/cmd args` in `Composer.tsx` before sending to the agent.
2. Built-ins: `/new`, `/compact`, `/clear`, `/checkpoints`, `/revert`,
   `/cost`, `/model`, `/mode`, `/tools`, `/skills`, `/mcp`, `/rules`,
   `/init` (scan workspace, scaffold `AGENTS.md`), `/diff` (open repo diff).
3. User commands: scan `.arc/commands/<name>.md` like Claude Code — file body
   is a prompt template with `{{args}}` substitution.
4. MCP-prompt-to-slash binding: any MCP prompt becomes
   `/<server>.<prompt-name>`. (Cline/Roo do this.)

### 🟡 P2 — Workflows / Recipes
- *Cline*: `parseSlashCommands` handles `localWorkflowToggles` and
  `globalWorkflowToggles` — markdown files that expand to multi-step prompts.

**Wishlist:** `.arc/workflows/*.md` that expand to a queued sequence of
user-as-agent messages.

---

## 4. Hooks System

Arc has `packages/host/src/hooks/hooks.ts` with two events: `preWrite` and
`postEdit`. Every other competitor has a richer event model.

### 🔴 P0 — Expanded Hook Events
- *Codex*: `codex-rs/hooks/src/` lifecycle hook engine. `HookEventName`
  enumerates: `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`,
  `UserPromptSubmit`, `Notification`, plus matcher groups, async vs sync,
  per-hook `timeout_sec`, `status_message`, and per-platform commands
  (`command_windows`).
- *Cline*: `src/core/hooks/` with `hook-executor.ts`,
  `precompact-executor.ts`, `notification-hook.ts`, `PreToolUseHook…` —
  near-1:1 with Claude Code's hook spec.
- *Claude Code*: `examples/hooks/bash_command_validator_example.py` and
  `examples/settings/settings-strict.json` show JSON-RPC-over-stdin hooks
  that can `deny`, `ask`, or rewrite tool inputs.

**Wishlist:** Extend `hooks.json` schema with:
1. Events: `session.start`, `user.submit`, `pre.tool`, `post.tool`,
   `pre.compact`, `post.compact`, `pre.handoff`, `notification`, `stop`,
   `subagent.spawn`.
2. Matchers: `{ tool?: string, mode?: string, modelTier?: string }`.
3. Command type returning a JSON object `{ decision: "allow"|"deny"|"ask",
   modifiedArgs?: any, message?: string }` so hooks can mutate tool args
   pre-execution (Cline/Claude).
4. Per-platform: `command` + `command_windows` (Codex).
5. Built-in hook helpers: a `secret-scan` (already there), a
   `lint-on-save` template, and a `test-on-edit` template.

### 🟠 P1 — `PreToolUse` Veto / Mutation
Today, only writes are guarded. Add a hook chain *before* `shell.run`,
`browser.*`, `webfetch`, `mcp.call` that can deny or edit args.

### 🟡 P2 — Session-start Context Injection
- *Claude Code*: `SessionStart` hook in the `explanatory-output-style` plugin
  injects educational tone instructions per session.

**Wishlist:** Session-start hooks may emit a `developer`-role message that is
prepended to the conversation.

---

## 5. Permissions / Sandboxing / Approvals

Arc has a flat `arc.shell.approval` setting (`always` / `allowlist` / `off`)
and a single allowlist of base commands.

### 🔴 P0 — Per-Tool Auto-Approve Matrix
- *Cline*: `src/core/task/tools/autoApprove.ts` per-tool decisions (read,
  write, edit, shell, browser, web-fetch, MCP-access, MCP-use, subagent) ×
  *local* vs *external* paths × `yoloModeToggled` × `autoApproveAllToggled`.
- *Roo*: `src/core/auto-approval/`.
- *Kilo*: `kilo-provider/auto-approve.ts`.

**Wishlist:** Replace the single allowlist with a structured matrix:

```jsonc
{
  "arc.approvals": {
    "read":          "auto",          // file.read, file.grep, file.glob, file.semanticSearch
    "write.local":   "auto",          // edits inside workspace
    "write.external":"ask",           // edits resolving outside workspace
    "shell.safe":    "auto",          // commands matching allowlist
    "shell.other":   "ask",
    "browser":       "ask",
    "webfetch":      "ask",
    "mcp":           { "default": "ask", "perServer": { "github": "auto" } }
  }
}
```

Plus a "YOLO" toggle that approves everything for the current session only
(Cline), and a session-scoped "always allow this command line" decision (cf.
Codex `command_canonicalization.rs` + `approved_command_prefix_saved.rs`).

### 🟠 P1 — OS-Level Sandbox for Shell
- *Codex*: `codex-rs/sandboxing/src/` ships `seatbelt` (macOS),
  `landlock` + `bwrap` (Linux), and `windows-sandbox-rs/` (Windows). Plus
  network policy SBPL files and a configurable `restricted_read_only` profile.
- *Claude Code*: `examples/settings/settings-strict.json` shows a Bash
  sandbox with `allowedDomains`, `allowLocalBinding`, `httpProxyPort`.

**Wishlist:** A `arc.shell.sandbox.profile = "off" | "read-only" | "workspace"`
where `workspace` confines writes to the workspace root and disables outbound
network unless the destination is in `arc.shell.sandbox.allowedDomains`. Use
the existing `node:child_process` flow but layer Seatbelt / Landlock / WSB
when present. Fall back to no-op + warning if not supported on the host.

### 🟡 P2 — Per-Command Approval Memory
- *Codex*: `approved_command_prefix_saved.rs` lets the user permanently bless
  a command-line *prefix* (e.g., `git push origin`).

**Wishlist:** When the user approves a shell prompt, offer "Always allow",
"Always allow exact prefix", "Just this once". Persist to
`.arc/approvals.json`.

---

## 6. Diff / Edit Engine

Arc's edit engine (`packages/host/src/edit/apply.ts`) is solid for
SEARCH/REPLACE blocks with `exact → trim → blank-collapse → windowed-fuzzy →
regex` fallback. Competitors go further.

### 🟠 P1 — Apply-Patch (Unified Diff Format)
- *Codex*: `codex-rs/core/src/apply_patch.rs` + `codex-rs/apply-patch/`
  parses Codex's "V4A" patch format with multiple hunks per file, supports
  *add*, *delete*, *update* operations, and rejects malformed patches with
  precise error positions.
- *Cline*: `ApplyPatchHandler.ts`.
- *Roo*: `ApplyPatchTool.ts` + `src/core/tools/apply-patch/`.
- *Continue*: `core/edit/lazy/unifiedDiffApply.ts`.

**Wishlist:** Add a `file.applyPatch` tool that accepts the V4A format (or
unified `diff -u` output) and dispatches multi-file, multi-hunk edits in a
single call. Reuse the existing `tryExtractDiffBlock` matching as the
fallback strategy per hunk. Helps Anthropic/OpenAI models that prefer that
format.

### 🟠 P1 — "Lazy" / Streamed Apply (Diff Preview as Model Writes)
- *Cline*: `apps/vscode/src/integrations/editor/` has a streaming diff view.
- *Continue*: `core/edit/streamDiffLines.ts` + `recursiveStream.ts` +
  `lazy/streamLazyApply.ts` render diff hunks as the model emits the
  REPLACE block.
- *Kilo*: `packages/kilo-vscode/src/diff/` and `DiffVirtualProvider.ts`.

**Wishlist:** Open a VS Code `vscode.diff(...)` editor when `file.edit`
starts; stream the REPLACE side into the right pane via a content provider so
users can watch and Cmd-Z to reject. Mirror Cline's "accept changes" /
"reject changes" UI.

### 🟡 P2 — Multi-Edit Tool
- *Continue*: `core/tools/definitions/multiEdit.ts` performs N find/replace
  pairs against one file atomically.
- *Codex*: `apply_patch.rs` handles N hunks in one call.

**Wishlist:** `file.multiEdit` taking `{ path, edits: [{ search, replace,
replaceAll? }] }`. Apply atomically; if any hunk fails, revert.

### 🟡 P2 — Tree-sitter–aware Edit Targeting
- *Continue*: `core/edit/lazy/findInAst.ts` uses tree-sitter to find function
  bodies / class members.
- *Cline*/*Roo*: `src/services/tree-sitter/` with queries for ~15 languages.

**Wishlist:** When the SEARCH text matches a fully-qualified symbol pattern
(`Foo.bar()`, `class Baz:`), narrow the search window using a tree-sitter
query before the windowed fuzzy match. Same parser can power
`list_code_definition_names` (below).

### 🟡 P2 — `list_code_definitions` / Repo-Map Tool
- *Cline*: `ListCodeDefinitionNamesToolHandler.ts`.
- *Continue*: `core/tools/definitions/viewRepoMap.ts` +
  `viewSubdirectory.ts`.

**Wishlist:** A `file.outline` tool returning the symbol map (`top-level fns
/ classes / exports`) for one file or a directory, computed once per repo
via tree-sitter and cached. Cheaper than reading the file fully.

---

## 7. Context Providers / @-mentions

Arc has an "attach selection" pathway but no first-class `@` mention grammar.

### 🟠 P1 — `@`-mention Providers
- *Cline*: `src/core/mentions/` resolves `@file`, `@folder`,
  `@problems`, `@terminal`, `@git-commit`, `@url`.
- *Continue*: `core/context/providers/` has 30+ providers — `@file`,
  `@codebase`, `@folder`, `@open` (open files), `@terminal`, `@problems`,
  `@search`, `@url`, `@docs`, `@git-diff`, `@git-commit`, `@issue`, `@jira`,
  `@github-issue`, `@clipboard`, `@os`, `@http`, `@postgres`, `@discord`,
  `@google`, plus user-defined `CustomContextProvider`.
- *Roo*: `src/core/mentions/`.

**Wishlist:** Composer parses `@token` and resolves through a provider
registry. Ship `@file`, `@selection`, `@symbol`, `@problems`, `@terminal`,
`@git-diff`, `@docs:<name>`, `@url`, `@clipboard` for v0.1. Allow MCP
resources to be addressable as `@<server>:<resource-uri>`. Plus `@<skill>`
and `@<rule>` for the upcoming skills/rules systems.

### 🟡 P2 — Docs Indexer (per-package documentation context)
- *Continue*: `core/context/providers/DocsContextProvider.ts` +
  `core/indexing/docs/` indexes `docs.continue.dev`-style URLs into the
  vector DB so users can `@docs react`.

**Wishlist:** `arc.docs.sources = [{ name, url }]` config; recursively fetch
& chunk; embed via the existing semantic backend; reachable via `@docs:name`.

---

## 8. Autocomplete / Inline Completion / Next-Edit

Arc is chat-only. Every competitor ships at least inline-completion-as-you-type,
and Continue ships *Next Edit* prediction.

### 🟠 P1 — Inline Completion (FIM / ghost-text)
- *Continue*: `core/autocomplete/CompletionProvider.ts` with classification,
  filtering, snippet collection, prefiltering, postprocessing, templating —
  a serious FIM stack.
- *Cline*/*Roo*/*Kilo*: rely on host LMs (VS Code LM API) for ghost text.

**Wishlist:** A `vscode.InlineCompletionItemProvider` that hits whichever
provider supports FIM (`fim` flag per `ProviderKind`). Reuse the existing
`light` tier for completions, default off (opt-in). Configurable via
`arc.autocomplete.enabled` and `arc.autocomplete.modelTier`.

### 🟢 P3 — Next-Edit Prediction
- *Continue*: `core/nextEdit/NextEditProvider.ts` predicts the *next edit*
  somewhere else in the file after the cursor change.

**Wishlist:** Optional; only if FIM lands first. Listen for `onDidChange…`,
diff the last 200 chars, ask the light model "what edits become necessary
elsewhere?" and surface as a code-action.

---

## 9. Subagent / Orchestration Improvements

Arc has `SubagentRunner` and the `subagent.spawn` tool with `batch`. Good
foundation; competitors layer richer orchestration.

### 🟠 P1 — Roo-style Orchestrator Mode
- *Roo*: dedicated `orchestrator` mode whose system prompt teaches the model
  to delegate via `new_task` (one task per subagent slot), and a
  `SubagentBuilder.ts` / `SubagentRunner.ts` family.
- *Cline*: `src/core/task/tools/subagent/AgentConfigLoader.ts` loads
  per-agent configs (name, model, tools, role).

**Wishlist:** Per-subagent config files at `.arc/agents/<name>.toml` with
`role`, `tier`, `allowedTools`, `writeGlob`, `description`. The `subagent.spawn`
tool gains an `agent: string` arg that loads the config. Codex calls the
analogue "agent registry" (`codex-rs/core/src/agent/registry.rs`).

### 🟠 P1 — Worktree-Isolated Agents
- *Kilo*: `packages/kilo-vscode/src/agent-manager/` is essentially a full
  worktree manager — `WorktreeManager.ts`, `GitOps.ts`,
  `WorktreeStateManager.ts`, `SessionTerminalManager.ts`, `PRStatusPoller.ts`,
  `promotion-handoff.ts`. (This is your `TODO.md` "agent team" item; the
  existing Kilo implementation is a great reference.)

**Wishlist:** A `subagent.spawnWorktree` tool that creates a `git worktree`
under `.arc/worktrees/<branch>`, runs the subagent there, and reports back
a diff + suggested branch name. Optional `autoPR` if `gh` is on PATH.

### 🟡 P2 — Codex-style Identity Agents
- *Codex*: `codex-rs/agent-identity/` plus
  `core/src/agent/agent_names.txt` (Euclid, Archimedes, …) gives each
  spawned agent a stable identity for logs/UI.

**Wishlist:** Cute, low-cost. Assign each subagent a name from a curated
list, display it in `AgentProcess.tsx`, and persist for the session so
re-spawned agents keep their badge.

### 🟢 P3 — Loop-Detection
- *Cline*: `apps/vscode/src/core/task/loop-detection.ts` detects when the
  model is repeatedly invoking the same tool with the same args and aborts.
- *Roo*: `ToolRepetitionDetector.ts`.

**Wishlist:** Track `(toolName, hash(args))` across the last 5 tool calls; if
3+ identical → emit `guidance` to the model and require a different action.

---

## 10. Memory / Long-Lived Context

Arc compacts in-session but has no persistent cross-session memory.

### 🟠 P1 — Project Memory (`AGENTS.md` write-back)
- *Codex*: `codex-rs/memories/` is an entire two-phase pipeline that
  extracts memories from rollouts, consolidates them under `~/.codex/memories/`,
  and gits the directory.
- *Claude Code*: `CLAUDE.md` (already supported on the read side in Arc) is
  amended via the `/memorize` UX (the model can suggest additions).

**Wishlist:**
1. A `memory.add` pseudo-tool that appends to `.arc/MEMORY.md` (workspace) or
   `~/.arc/MEMORY.md` (global), categorized (`preferences`, `architecture`,
   `gotchas`).
2. Auto-load these at session start, just like the current `AGENTS.md` /
   `CLAUDE.md` loader (`packages/host/src/prompts/prompts.ts`).
3. Optional background "memory consolidation" — at session end, if the
   conversation produced ≥N tool calls, run a summarizer to extract durable
   facts and offer to commit them.

### 🟡 P2 — Conversation Search
- *Cline* / *Roo* / *Kilo*: persist past chats and let the user search them.

**Wishlist:** `ChatHistory` already exists; add full-text search across past
turns (sqlite FTS5 or a tiny in-memory inverted index) and a "Resume task"
gesture.

---

## 11. Rules System (Targeted Instructions)

Arc has `injectRelevantRules()` in `prompts/prompts.ts` that pulls
`@glob`/`@ext`/`@keywords`-tagged sections from prompt files. Good start.

### 🟡 P2 — `.arc/rules/*.md` + `requestRule` tool
- *Continue*: `core/tools/definitions/requestRule.ts` and
  `core/tools/definitions/createRuleBlock.ts` make rules a first-class
  artifact the model can list/create on demand.
- *Cline*: `src/shared/cline-rules` and `/newrule` slash command.
- *Roo*: rule files under `.roo/rules/`.

**Wishlist:**
1. Promote `.arc/rules/<name>.md` to a separate directory (today rules live
   inside prompt files). Each rule has `glob`, `description`, body.
2. `rule.list`, `rule.read`, `rule.create` tools.
3. A `/newrule` slash command (see §3).

---

## 12. Provider Coverage & Auth

Arc already has a strong `catalog.ts` (15+ provider kinds). A few additions
match what the competitors ship:

### 🟡 P2 — Missing Provider Adapters
- **VS Code LM API** is listed as a `ProviderKind` but I didn't find a
  transport for it under `packages/host/src/providers/`. Cline/Kilo route a
  lot of traffic through this (no API key needed, works with Copilot subs).
  → Implement `vscode-lm.ts` that uses
  `vscode.lm.selectChatModels(...).sendRequest(...)`.
- **AWS Bedrock** and **Vertex AI**: present in Roo
  (`src/services/code-index/embedders/bedrock.ts` and friends) and Cline.
  Not present in Arc.
- **GitHub Copilot proper** (separate from VS Code LM): Kilo
  (`packages/core/src/github-copilot/`) authenticates against the Copilot
  device-code flow.

### 🟡 P2 — OAuth Device Flow Provider Auth
- *Anthropic Claude Code* and Kilo use OAuth device-code for first-time
  set-up. Arc only handles raw API keys (good for power users, but rough for
  newcomers).

**Wishlist:** For Anthropic + OpenAI, offer an OAuth-style "Sign in with…"
button that opens a browser, polls a code, and stores the resulting token in
the existing `SecretStorage` slot.

### 🟢 P3 — Per-Provider Rate-Limit Backoff
The current `FailureCache` blacklists for 30s on any error. Differentiate
HTTP 429 (respect `Retry-After`) from 5xx (exponential) from auth errors
(don't retry).

---

## 13. MCP — additional ergonomics

Solid baseline: stdio + http, resources, prompts, list-changed
notifications, runtime register/remove/toggle. Items competitors add:

### 🟡 P2 — MCP OAuth
- *Cline*: `apps/vscode/src/services/mcp/McpOAuthManager.ts` +
  `McpOAuthRedirectResolver.ts` + `StreamableHttpReconnectHandler.ts`
  implements MCP's OAuth 2.1 spec end-to-end.

**Wishlist:** Implement OAuth flow for `http` transport servers that respond
401 with WWW-Authenticate. Persist tokens in SecretStorage.

### 🟡 P2 — MCP Server Marketplace
- *Cline*: `loadMcpDocumentation.ts` + a curated catalog.

**Wishlist:** Optional. Skip if you don't want to host one; otherwise read
from a community-maintained JSON list.

### 🟢 P3 — MCP Sampling (host-side LLM available to servers)
The MCP spec lets a server *ask the client* to sample an LLM. Arc could
expose its current model registry as a sampling target for MCP servers (you
already have all the routing logic).

---

## 14. Browser Tooling

Arc's Playwright integration is minimal-but-fine (navigate, click, type,
screenshot, evaluate, readDom, close).

### 🟡 P2 — Console + Network Capture
- *Cline*: `BrowserToolHandler.ts` captures console logs and pending network
  requests in the same response as the screenshot. Critical for debugging
  webapps.

**Wishlist:** Attach `page.on('console')` and `page.on('requestfinished')`
listeners; surface the last N entries with every browser tool response.

### 🟡 P2 — Hover / Scroll / Wait
**Wishlist:** Add `browser.hover`, `browser.scroll`, `browser.waitFor`
(selector or URL change). Cheap wins.

### 🟢 P3 — Persistent Browser Profile Option
**Wishlist:** Allow `arc.browser.userDataDir = "<path>"` so the model can
operate on authenticated sessions (Cline supports this).

---

## 15. UI / Webview

### 🟠 P1 — Diff View Inside the Webview
- *Cline*, *Roo*, *Continue* all render inline diffs in chat with
  accept/reject buttons (not just a unified-diff blob in markdown).

**Wishlist:** Render `result.diffHunks` from `file.edit` as a real
side-by-side diff in `AgentProcess.tsx`, with per-hunk accept/reject. On
reject, surface the chosen text back to the model via a tool result so it
can correct course.

### 🟡 P2 — Cost & Token-Usage Surfaces
Per-message and per-turn cost is tracked in `usageByModel`; add a small
header strip in `ArcChat.tsx` ("$0.043 used · 12k/200k tokens · 4 tools").
Cline/Roo already do this prominently.

### 🟡 P2 — Conversation Branching / Forking
- *Kilo*: `fork-session.ts`, `fork-handoff.ts`.

**Wishlist:** From any past assistant message, allow "Fork from here" to
clone the conversation and continue along a different path. The checkpoint
store already snapshots files per turn, so file-state can ride along.

### 🟡 P2 — Image / Screenshot Input
- *Cline*, *Roo*, *Continue* all accept pasted images and forward them as
  multimodal content to vision-capable models.

**Wishlist:** Composer accepts paste-image; transports pass
`image_url` / inline base64 content blocks for OpenAI/Anthropic/Google.

### 🟢 P3 — Localization
- *Roo* ships 15+ `package.nls.<lang>.json` files plus a `locales/` tree.

**Wishlist:** At minimum, externalize all UI strings via `vscode.l10n` so
contributors can drop in translations.

---

## 16. Telemetry, Logging, Diagnostics

Arc has a single `vscode.OutputChannel`. Competitors ship much richer
debugging surfaces.

### 🟡 P2 — Rollout / Replay
- *Codex*: `codex-rs/rollout/` + `rollout-trace/` writes every
  request/response/tool-call to a structured JSONL on disk, then
  `codex-rs/external-agent-sessions/` can replay a rollout. Invaluable for
  reproducing model misbehaviour.

**Wishlist:** Optional `arc.debug.recordRollouts = true` that writes
`.arc/rollouts/<turn-id>.jsonl` with every transport event, tool call,
result, and timing. Pair with a `arc.replayRollout <id>` command that
re-runs the conversation read-only against the saved transcript (great for
testing changes to system prompts and the agent loop).

### 🟢 P3 — OpenTelemetry Export (opt-in)
- *Codex*: `codex-rs/otel/`.

Only worth it for power users; gated behind config.

---

## 17. Testing / Eval Infrastructure

Arc has a solid unit test suite under `packages/host/test/`. Competitors
ship eval harnesses.

### 🟢 P3 — Built-in Eval Runner
- *Cline*: `evals/`. *Continue*: `eval/`. *Codex*: golden snapshots.

**Wishlist:** A `pnpm eval` script that runs a small bench of agentic tasks
(SWE-bench-lite style) against the configured model and reports
pass-rate/cost. Lets you compare model upgrades objectively.

### 🟡 P2 — System-Prompt Snapshot Tests
- *Cline*: `apps/vscode/src/core/prompts/system-prompt/__tests__/__snapshots__/`
  pins exact prompt output per model family.

**Wishlist:** Add Vitest snapshot tests over the assembled system prompt for
each provider × model-tier × mode triple. Catches accidental prompt drift.

---

## 18. Observability of the Agent Loop

### 🟡 P2 — Step Timeline / Timing
- *Codex* & *Cline* surface per-tool latency. Arc's `ProcessStep` already
  has `ts`; just display deltas in `AgentProcess.tsx` ("read … 23 ms",
  "edit … 1.4 s", "shell … 12 s").

### 🟡 P2 — Plan Auto-Update Reminders
- *Cline*: `focus-chain/` periodically nudges the model: "Update your focus
  chain if it's stale." Prevents the model from forgetting its plan in long
  sessions.

**Wishlist:** Every N turns or after any `shell.run`, if `todoItems` was
last updated >10 turns ago, inject a short system reminder to re-evaluate
the plan.

---

## 19. Code-Mode (sandboxed JS for batched tool calls)

### 🟢 P3 — Code-Mode Tool
- *Codex*: `codex-rs/code-mode/` ships a `v8` (deno_core_icudata) sandbox
  that lets the model emit a small JS program calling several tools in one
  round-trip — drastically cuts the per-tool latency tax on long loops.

**Wishlist:** Too heavy for a 1 MB extension goal, but worth tracking. A
much-cheaper alternative: bundle a JSON DSL ("plan": [{tool, args}, ...])
that the agent loop executes server-side without round-tripping each step.

---

## 20. Small Quality-of-Life Tools / Polish

These are tiny but every competitor has them:

| Item | Where seen | Notes |
| --- | --- | --- |
| 🟡 `attempt_completion` style "I'm done" tool | Cline `AttemptCompletionHandler.ts`, Roo `AttemptCompletionTool.ts` | Lets the agent declare success explicitly with a summary; better than just "no more tool calls". |
| 🟡 `report_bug` slash | Cline `/reportbug`, `ReportBugHandler.ts` | Posts to GH issues with sanitized context. |
| 🟡 `generate_explanation` of a code region | Cline `GenerateExplanationToolHandler.ts` | Useful as a code-action right-click. |
| 🟡 `searchWebGating` | Continue `core/tools/searchWebGating.vitest.ts` | Gates `webfetch`/`webSearch` on per-domain allowlist (privacy). |
| 🟡 `viewDiff` tool | Continue `core/tools/definitions/viewDiff.ts` | Returns the working-tree git diff for any path so the model can see uncommitted state. |
| 🟡 `viewSubdirectory` tool | Continue | Compact recursive listing with truncation, for big repos. |
| 🟡 `read_file_range` | Continue | Avoids reading large files in full when only N lines are needed. Arc has `offset/limit`; surface it as a separate spec'd tool too. |
| 🟡 Multi-root workspace awareness | Cline `WorkspacePathAdapter.ts`, `WorkspaceRootManager.ts`; Roo `src/integrations/workspace/` | Today Arc assumes single root; resolve paths correctly when multi-root. |
| 🟡 Continue/resume on extension reload | Cline persists per-task state | Arc's `chat/history.ts` is close but doesn't auto-restore an in-flight turn. |
| 🟡 `condense`/`/compact` user-triggered | Cline `CondenseHandler.ts`, Codex `compact.rs` | Arc has internal compaction; expose a slash command. |
| 🟢 Speech-to-text composer | Kilo `speech-to-text/` | Cute differentiator. |
| 🟢 Background terminal "what's stuck?" detector | Cline `runTerminalCommand.timeout.vitest.ts` (Continue) | Auto-classify a hanging process and offer to kill. |

---

## 21. Architectural / Internal Quality

These don't add user-visible features but pay long-term dividends:

### 🟡 P2 — Stream Cancellation Cleanup
The current `stop()` aborts via `AbortController` but several transports
(`anthropic.ts`, `openai-compatible.ts`) need an explicit check for the
signal in their `for await` loops to release fetch sockets immediately.
Audit each transport.

### 🟡 P2 — Type-safe Protocol Boundary
`WebviewMsg`/`HostMsg` are large discriminated unions hand-maintained in
`protocol.ts`. Continue uses generated zod schemas (`packages/types/`),
Cline uses protobuf (`apps/vscode/proto/`). Generating types from a single
schema source would prevent host↔webview drift.

### 🟡 P2 — `ToolContext` Builder
`agent.ts` currently constructs `ToolContext` inline with an `as any` cast
in a few places. Promote to a `buildToolContext(options)` helper and remove
the cast.

### 🟢 P3 — Tests for the agent loop edge cases
Add tests for: handoff during a parallel phase, `stop()` mid-stream cancels
both the LLM and pending tool calls, retract a turn that had subagent
spawns, MCP server crash mid-call.

### 🟢 P3 — Tree-shake `lucide-react`
Tiny: import icons individually (`import Send from 'lucide-react/icons/send'`)
to shave the webview bundle by ~40 KB and keep the 1 MB footprint claim
robust as features grow.

---

## Summary Matrix (Arc vs Competitors)

✅ = present in Arc (today) · ⚠️ = partially present · ❌ = missing
Competitor columns: **CX** = Codex, **CC** = Claude Code, **Cln** = Cline,
**Roo** = Roo Code, **Klo** = Kilo Code, **Cnt** = Continue.

| Capability | Arc | CX | CC | Cln | Roo | Klo | Cnt |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Multi-provider routing | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| Tier-aware model selection | ✅ | ⚠️ | — | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Failover / weighted providers | ✅ | ⚠️ | — | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| Subagents (delegation) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Worktree-isolated agents | ❌ | — | — | — | — | ✅ | — |
| Named modes (plan/code/etc) | ❌ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Per-mode tool/write restrictions | ❌ | — | ✅ | ✅ | ✅ | ⚠️ | — |
| Skills (SKILL.md) | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Slash commands | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Hooks (multi-event) | ⚠️ | ✅ | ✅ | ✅ | — | — | — |
| OS sandboxing (seatbelt/landlock/wsb) | ❌ | ✅ | ✅ | — | — | — | — |
| Per-tool auto-approve matrix | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Apply-patch / multi-hunk diff format | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Live streaming diff UI | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tree-sitter symbol map | ❌ | — | — | ✅ | ✅ | ⚠️ | ✅ |
| Semantic code search | ✅ | ⚠️ | — | ✅ | ✅ | ✅ | ✅ |
| `@`-mention context providers | ❌ | — | — | ✅ | ✅ | ⚠️ | ✅ |
| Docs indexer | ❌ | — | — | — | — | — | ✅ |
| Inline completion (FIM) | ❌ | — | — | — | — | — | ✅ |
| Next-edit prediction | ❌ | — | — | — | — | — | ✅ |
| Image input (multimodal) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| MCP client | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| MCP OAuth | ❌ | — | — | ✅ | — | — | — |
| Browser console+network capture | ❌ | — | — | ✅ | ✅ | — | — |
| Persistent memory pipeline | ❌ | ✅ | ⚠️ | — | — | — | — |
| Checkpoints / revert | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | — |
| Rollout / replay | ❌ | ✅ | — | — | — | — | — |
| Loop-detection | ❌ | — | — | ✅ | ✅ | — | — |
| Cost/usage UI | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Conversation fork | ❌ | — | — | — | — | ✅ | — |
| Localization (>1 lang) | ❌ | — | — | ⚠️ | ✅ | ✅ | ✅ |
| Code-mode (V8 sandbox batched calls) | ❌ | ✅ | — | — | — | — | — |

---

## Suggested Roadmap (8 sprints)

| Sprint | Theme | Items |
| :-: | --- | --- |
| 1 | **Modes** | §1 (modes registry, 4 built-ins, per-mode write glob, `mode.switch` tool) |
| 2 | **Skills + Slash** | §2 (full skills) + §3 (slash parser & built-ins) |
| 3 | **Permissions + Hooks** | §5 (auto-approve matrix, per-prefix memory) + §4 (expanded events, PreToolUse veto) |
| 4 | **Edit UX** | §6 (apply-patch tool, streaming diff in webview, multi-edit) + §15 (in-webview diff with accept/reject) |
| 5 | **Context** | §7 (`@`-mentions + provider registry) + §10 (`.arc/MEMORY.md` write-back) + §11 (rules dir) |
| 6 | **Subagents v2** | §9 (per-agent config files, worktree subagents, identity names) |
| 7 | **Diagnostics** | §16 (rollouts + replay), §18 (timing, plan-update reminders), §20 (`attempt_completion`, `/compact`, multi-root) |
| 8 | **Polish** | §12 (VS Code LM API transport, Bedrock, OAuth), §13 (MCP OAuth), §14 (browser console+network), §15 (image input, cost strip, localization scaffolding) |

Sprints 1–3 close most of the "I expected this and didn't find it" gaps that
new users hit in the first 10 minutes; sprints 4–6 establish parity on the
"power user" workflows where Cline/Roo currently win; sprints 7–8 are the
items that turn a good agent into a great long-running collaborator.

---

*Generated by exhaustively reading `packages/arc/**` and `packages/host/**`
in Arc and the corresponding source trees in the six competitors. All
competitor citations point to files actually present in the cloned repos at
the time of this audit (June 2026).*

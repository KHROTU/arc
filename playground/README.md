# Arc Agent Playground

A self-contained workspace for the Arc agent to read, explore, and exercise every built-in tool.

## Before you begin

**Run the restore script first.** The agent modifies files; the script resets to a known clean baseline:

```
node C:/Users/khrot/Desktop/Work/arc/scripts/restore-playground.mjs
```

Or on Windows:

```
pwsh C:/Users/khrot/Desktop/Work/arc/scripts/restore-playground.ps1
```

The clean snapshot lives at `C:/Users/khrot/Desktop/Work/arc/scripts/playground-clean.zip`. Do not modify that archive — the restore script extracts from it.

## Structure

```
src/          TypeScript source files with intentional issues for LSP tools
  index.ts    Entry point — has a type mismatch and unused import (lsp.problems)
  config.json Configuration to read and modify (file.read, file.edit)
  utils.ts    Helper with a "REPLACE_ME" sentinel (file.edit test)
  style.css   CSS with a duplicated rule (lsp.problemsFor on style files)
web/          Static HTML page for browser tools
  index.html       Page for browser.navigate / browser.readDom / browser.click / browser.screenshot
  script.js        JS wired to the HTML (browser.evaluate)
  handoff-designs.html  Handoff banner design concept gallery
scripts/      Shell commands
  demo.ps1    PowerShell script to run (shell.run)
  slow.ps1    Long-running script for timeout parameter testing
  interactive.ps1  Interactive script waiting on stdin (shell.backgroundRun, shell.check, shell.write)
  build.ps1   Simulated build script for runAfter parameter testing
data/         Text and structured data
  sample.json  Nested JSON to read and traverse
  todo.txt     Plain text to read and edit (file.read, file.edit, file.write)
  urls.txt     List of URLs for webfetch tool testing
```

## What to test

| Tool | File / Action |
|------|---------------|
| file.read | Read `data/sample.json`, `data/todo.txt`, `src/config.json` |
| file.edit | Edit `src/utils.ts` — replace `REPLACE_ME` with actual content |
| file.write | Write a new file `data/output.txt` with results |
| shell.run | Run `scripts/demo.ps1` (prints env info + file listing) |
| shell.run (timeout) | Run `scripts/slow.ps1` with `timeout=3` (should be killed) and `timeout=-1` (should complete) |
| webfetch | Fetch `https://example.com` and verify HTML content |
| webfetch (error) | Fetch `https://httpbin.org/status/404` (expect 404) |
| file.edit (runAfter) | Edit `src/utils.ts` with `runAfter: "pwsh scripts/build.ps1"` |
| file.write (runAfter) | Write `data/generated.txt` with `runAfter: "pwsh scripts/build.ps1"` |
| lsp.problems | Check workspace-wide diagnostics (src/index.ts has deliberate issues) |
| lsp.problemsFor | Check `src/index.ts` and `src/style.css` individually |
| todo.write | Set a 3-step plan: inspect → fix → verify |
| browser.navigate | Navigate to `web/index.html` |
| browser.readDom | Read the accessibility tree of the loaded page |
| browser.click / type | Interact with the form on the page |
| browser.screenshot | Capture the page |
| browser.evaluate | Run JS in the page context |
| browser.close | Close the browser |
| subagent.spawn | Spawn a subagent to count lines in `src/` |
| subagent.spawn (batch) | Spawn 3 subagents in parallel: count lines in `src/index.ts`, `src/utils.ts`, `src/style.css` |
| subagent.spawn (rules) | Spawn a subagent with `blockedCommands: ["rm", "del"]` — subagent attempts a blocked command and approval routes to parent |
| handoff | Escalate to a heavier model for a complex reasoning step |
| clarification.askUser | Ask whether to keep or delete a generated file |
| file.grep | Grep for `REPLACE_ME` across workspace, `export function` in `*.ts`, `import` in `src/*.ts` |
| file.glob | Glob `**/*.ts`, `src/**/*`, `scripts/*.ps1` |
| shell.backgroundRun | Run `slow.ps1` in background, poll with shell.check |
| shell.check | Poll a background process for output and exit status |
| shell.write | Send input to `interactive.ps1` via stdin after backgroundRun |

## New Parameter Coverage

| Param | Tool | Test |
|-------|------|------|
| `timeout` (seconds) | shell.run | Run `slow.ps1` with tight and generous limits |
| `runAfter` (command) | file.edit | Run `build.ps1` automatically after an edit |
| `runAfter` (command) | file.write | Run `build.ps1` automatically after writing |
| `offset`, `limit` (lines) | file.read | Read `utils.ts` L1-5, `sample.json` L2-11, `index.ts` L8 only |
| `include` (pattern) | file.grep | Grep `*.ts` files only vs `*.json` files only |
| `batch` (array) | subagent.spawn | Spawn multiple subagents in one turn, collect all results |
| `rules.blockedCommands` | subagent.spawn | Block specific shell commands in subagent; approval routes to parent |
| `rules.requireApproval` | subagent.spawn | Require parent approval for all subagent shell commands |

## Tier 2: Subagent Features

| Feature | How to test |
|---------|-------------|
| Subagent streaming | Spawn a subagent that reads multiple files — watch the transcript for live subagent progress in the purple-bordered card |
| Parallel subagent batch | Ask: "Spawn 3 subagents in parallel using batch mode to count lines in src/index.ts, src/utils.ts, and src/style.css" |
| Subagent run rules | Ask: "Spawn a subagent to list files, but block the 'rm' and 'del' commands" |
| Collapsible chat list | Toggle the panel button in the fullscreen top bar to collapse/expand the chat list sidebar |

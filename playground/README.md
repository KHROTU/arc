# Arc Agent Playground

A self-contained workspace for the Arc agent to read, explore, and exercise every built-in tool.

## Structure

```
src/          TypeScript source files with intentional issues for LSP tools
  index.ts    Entry point — has a type mismatch and unused import (lsp.problems)
  config.json Configuration to read and modify (file.read, file.edit)
  utils.ts    Helper with a "REPLACE_ME" sentinel (file.edit test)
  style.css   CSS with a duplicated rule (lsp.problemsFor on style files)
web/          Static HTML page for browser tools
  index.html  Page for browser.navigate / browser.readDom / browser.click / browser.screenshot
  script.js   JS wired to the HTML (browser.evaluate)
scripts/      Shell commands
  demo.ps1   PowerShell script to run (shell.run)
data/         Text and structured data
  sample.json  Nested JSON to read and traverse
  todo.txt     Plain text to read and edit (file.read, file.edit, file.write)
```

## What to test

| Tool | File / Action |
|------|---------------|
| file.read | Read `data/sample.json`, `data/todo.txt`, `src/config.json` |
| file.edit | Edit `src/utils.ts` — replace `REPLACE_ME` with actual content |
| file.write | Write a new file `data/output.txt` with results |
| shell.run  | Run `scripts/demo.ps1` (prints env info + file listing) |
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
| handoff | Escalate to a heavier model for a complex reasoning step |
| clarification.askUser | Ask whether to keep or delete a generated file |

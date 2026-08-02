# Arc Agent Playground

A self-contained workspace for the Arc agent to read, explore, and exercise every built-in tool.

## Structure

```
.arc/         Arc configuration directory
  mcp.json    Single MCP server: context7
  skills/     Skill definitions (skill.read, skill.use)
    demo-skill.md  Conventions for working in the playground
  rules/      Rule definitions (rule.read, rule.list)
    test-rule.md   No destructive commands policy
src/          TypeScript source files with intentional issues for LSP tools
  index.ts    Entry point — has a type mismatch and unused import (lsp.problems)
  config.json Configuration to read and modify (file.read, file.edit)
  utils.ts    Helper with a "REPLACE_ME" sentinel (file.edit test)
  style.css   CSS with a duplicated rule (lsp.problemsFor on style files)
web/          Static HTML page for browser tools
  index.html       Page for browser.navigate / browser.readDom / browser.click / browser.screenshot
  script.js        JS wired to the HTML (browser.evaluate)
scripts/      Shell commands
  demo.ps1    PowerShell script to run (shell.run)
  slow.ps1    Long-running script for timeout parameter testing
  interactive.ps1  Interactive script waiting on stdin (shell.backgroundRun, shell.check, shell.write)
  build.ps1   Simulated build script for runAfter parameter testing
  lint.ps1    Simulated lint check for customRun chaining
  check.ps1   Simulated test run for customRun chaining
data/         Text and structured data
  sample.json  Nested JSON to read and traverse
  todo.txt     Plain text task checklist
  urls.txt     URLs for webfetch and web.search queries
test/         Test files
  example.test.ts    Vitest test suite (test.run); has a REPLACE_ME test that fails until fixed
  checkpoint-compare-a.md  Initial state fixture for checkpoint.compare
  checkpoint-compare-b.md  Modified state fixture for checkpoint.compare
package.json  Local Vitest test script for test.run
tsconfig.json TypeScript project for LSP diagnostic coverage
notebook-demo.ipynb  Jupyter notebook for notebook.read/editCell/addCell/deleteCell/execute
```

## Tool Coverage Matrix

### File Tools

| Tool | Action |
|------|--------|
| file.read | Read `data/sample.json`, `data/todo.txt`, `src/config.json`; test offset/limit |
| file.edit | Replace `REPLACE_ME` in `src/utils.ts`; test runAfter with `scripts/build.ps1` |
| file.write | Write `data/output.txt`, `data/generated.txt`; test runAfter |
| file.grep | Grep for `REPLACE_ME`, `export function`, `import`; test include pattern |
| file.glob | Glob `**/*.ts`, `src/**/*`, `scripts/*.ps1`, `**/*.md` |
| file.semanticSearch | Search for "conventions", "destructive commands", "REPLACE_ME sentinel" |

### Shell Tools

| Tool | Action |
|------|--------|
| shell.run | Run `demo.ps1`; test timeout with `slow.ps1` (3s kill vs -1 complete) |
| shell.backgroundRun | Background `slow.ps1`, `interactive.ps1` |
| shell.check | Poll background process output and exit status |
| shell.write | Send stdin to `interactive.ps1` |
| shell.customRun | Create named pipeline 'full_check' (lint + build + check) |
| shell.editCustomRun | Edit pipeline: add demo.ps1, rename to 'pipeline'; test error on nonexistent id |
| shell.runCustomRun | Run the 'pipeline' custom run by id |

### LSP Tools

| Tool | Action |
|------|--------|
| lsp.problems | Check workspace-wide diagnostics (`src/index.ts` has type mismatch + unused import) |
| lsp.problemsFor | Check `src/index.ts` and `src/style.css` individually |

### Web Tools

| Tool | Action |
|------|--------|
| web.fetch | Fetch `https://example.com`, `httpbin.org/html`, `httpbin.org/json`; test 404 + DNS errors |
| web.search | Search "Arc agentic coding assistant", "TypeScript type narrowing" |

### Browser Tools

| Tool | Action |
|------|--------|
| browser.navigate | Navigate to `web/index.html` |
| browser.readDom | Read accessibility tree of loaded page |
| browser.readPage | Read page text content |
| browser.click | Click the form buttons |
| browser.type | Type into form inputs |
| browser.screenshot | Capture the page |
| browser.evaluate | Run JS in page context |
| browser.console | Read browser console messages |
| browser.network | Read network request log |
| browser.domSnapshot | Get full page snapshot |
| browser.drag | Drag from one selector to another |
| browser.dialog | Handle browser dialogs (alert, confirm, prompt) |
| browser.runCode | Run arbitrary Playwright code |
| browser.hover | Hover over a selector |
| browser.scroll | Scroll to a selector or by pixels |
| browser.waitFor | Wait for selector, URL, or state |
| browser.newTab / switchTab / closeTab / listTabs | Tab management |
| browser.intercept / unintercept | Network request interception |
| browser.close | Close browser |

### MCP Tools

| Tool | Action |
|------|--------|
| mcp.call | Call `context7/resolve` or `context7/query` on the context7 server |
| mcp.create | Register a new MCP server |
| mcp.remove | Remove an MCP server |
| mcp.toggle | Enable/disable an MCP server |
| mcp.resources/list | List resources on a server |
| mcp.resources/read | Read resource by URI |
| mcp.prompts/list | List prompts on a server |
| mcp.prompts/get | Get prompt by name |

### Subagent Tools

| Tool | Action |
|------|--------|
| subagent.spawn | Single, batch (parallel), and rule-constrained subagents |
| subagent.askParent | Subagent asks parent for clarification |

### Checkpoint Tools

| Tool | Action |
|------|--------|
| checkpoint.revert | Revert file edits to checkpoint state |
| checkpoint.list | List all saved checkpoints with indices |
| checkpoint.compare | Compare two checkpoints by index or turnId |

### Mode / Skill / Memory / Rule Tools

| Tool | Action |
|------|--------|
| mode.switch | Switch between plan/code/audit/debug modes |
| skill.read | Read `.arc/skills/demo-skill.md` |
| skill.use | Load skill into agent context |
| memory.add | Add memory entry with category |
| memory.list | List all memory entries |
| memory.edit | Edit memory by index |
| memory.delete | Delete memory by index |
| rule.list | List `.arc/rules/` entries |
| rule.read | Read `test-rule.md` |
| rule.create | Create a new rule |

### Git Tools

| Tool | Action |
|------|--------|
| git.changedFiles | List files changed since last commit |
| git.diffUnstaged | Read unstaged diff |
| git.diffStaged | Read staged diff |
| git.branchDiff | Diff current branch vs base |
| git.commitMessage | Generate commit message from diff |

### Notebook Tools

| Tool | Action |
|------|--------|
| notebook.read | List cells / read specific cell by index |
| notebook.editCell | Edit cell source (fix REPLACE_ME in cell 1) |
| notebook.addCell | Add new code cell |
| notebook.deleteCell | Delete cell by index |
| notebook.execute | Execute cell and return output |

### Other Tools

| Tool | Action |
|------|--------|
| todo.write | Set multi-step plans |
| test.run | Run `test/example.test.ts` (vitest) |
| handoff | Escalate to a heavier model tier |
| clarification.askUser | Ask whether to keep/delete a file |
| session.exportTrace | Export full session execution trace as markdown + JSON |

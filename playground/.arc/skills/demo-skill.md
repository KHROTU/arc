# Demo Skill — Arc Playground Conventions

This skill teaches conventions for working in the Arc Agent Playground.

## File naming

- TypeScript files go in `src/`, PowerShell scripts in `scripts/`, data in `data/`
- Generated files go in `data/` with descriptive names like `output.txt` or `generated.txt`

## Edit conventions

- Use `file.edit` for in-place changes, `file.write` for new files
- Always run validation scripts after editing: `pwsh scripts/build.ps1` and `pwsh scripts/lint.ps1`
- Check for `REPLACE_ME` sentinels with `file.grep` before finalizing

## Shell conventions

- PowerShell scripts use `pwsh` as the shell command
- Background processes should be checked with `shell.check`
- Interactive scripts need stdin via `shell.write`

## Test conventions

- Run `test.run` with scope `test/example.test.ts` after making changes
- Use `checkpoint.revert` if edits cause problems
- Compare checkpoints with `checkpoint.compare` to review changes between turns

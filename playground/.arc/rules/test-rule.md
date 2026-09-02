# Test Rule - No destructive commands in playground

Always avoid destructive shell commands in the playground workspace:
- Do not run `rm`, `del`, `rmdir`, or `Remove-Item` recursively
- Do not modify the `.arc/` directory except for skills and rules
- Do not delete any file in `web/` or `test/` directories

When editing TypeScript files, run `pwsh scripts/lint.ps1` afterward to check for leftover `REPLACE_ME` sentinels.

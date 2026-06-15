# i was supposed to ship these with 0.0.3 but im way to tired already bruv

## worse agent team

- Formal orchestration layer on top of sub-agents.
- Lead agent (high-reasoning model) decomposes tasks; specialist agents (cheap models) execute domains like CSS, testing, docs.
- *note: "lowest in priority … almost never work out as good as you'd think."*

## agent team

- Spawn isolated git worktrees for independent tasks, execute in parallel.
- Merge-supervision view to review and integrate results back to main.
- *note: "not really. this is basically the one from above."*

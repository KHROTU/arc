# Contributing to Arc

Thanks for contributing! This document covers how the repository is organized, how to build and test, and how to land changes.

## Repository layout

```
packages/
  host/           @arc/host: backend engine
  arc/            arc-code: extension (host integration + webview UI)
  arc/webview-ui/ the sidebar/fullscreen chat UI (Preact, bundled with esbuild)
```

## Requirements

- Node.js `>=18.18.0`
- pnpm 9 (`corepack enable` or `npm i -g pnpm@9`)

## Setup

```sh
pnpm install
```

## Building

```sh
pnpm build          # builds all packages
pnpm build:ext      # host + extension bundle (what runs in VS Code)
pnpm build:webview  # webview UI bundle
pnpm watch          # rebuild on change
```

The extension is run from `packages/arc` (F5 debug host or `pnpm --filter arc-code package` for a VSIX).

## Testing

```sh
pnpm test           # runs the full suite
pnpm --filter @arc/host test   # engine tests only
```

- Browser-based tests (`browser-tabs.test.ts`) skip automatically when the Playwright Chromium download is not installed.
- When you change engine behavior, add a unit test next to the code it covers (`packages/host/test/`).

## Branch model

- `main` is the public, released line. We do not accept pull requests against `main`, as it is for squash merges of `dev` only.
- `dev` is the public contribution branch. Open pull requests against `dev` whenever you like, however large or small.
- Releases are cut by maintainers: `dev` is squashed into a single versioned commit and promoted to `main`.
- Version bumps are managed by maintainers only.

## Commit conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.
- Keep subjects under 72 characters; put the *why* in the body when it isn't obvious.
- Line endings are normalized via `.gitattributes` — keep files LF (`.ps1` may stay CRLF).

## Pull request checklist

- [ ] `pnpm test` passes (engine + extension suites)
- [ ] `pnpm build:ext` completes without errors
- [ ] Follows the existing code style (no linter is configured — keep new code consistent with surrounding files)
- [ ] New behavior has a test where practical
- [ ] No version-field or version-reference changes (maintainers handle version bumps)

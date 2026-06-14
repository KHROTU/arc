# Third-Party Notices

Arc incorporates or depends on the following third-party software and assets. Each entry includes the applicable license, its role in the project, and the attribution required.

---

## Licensed Components Shipped with Arc

### react, react-dom (v18.3.1)
MIT License — Copyright (c) Meta Platforms, Inc. and affiliates.
Used as the webview UI framework for all chat and settings surfaces.

### framer-motion (v11.5.4)
MIT License — Copyright (c) 2018 Framer B.V.
Provides spring-physics animations for handoff banners, clarification cards, and process timeline transitions.

### lucide-react (v0.439.0)
ISC License — Copyright (c) 2020 Lucide Contributors.
Provides the icon set used throughout the extension (Send, Square, Plus, Settings, ChevronRight, ArrowRight, Terminal, Bot, et al.).

### vscode-uri
MIT License — Copyright (c) Microsoft Corporation.
URI parsing and manipulation utilities used by the host package.

### diff
BSD-3-Clause License — Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>.
Used by `packages/host/src/edit/apply.ts` for unified-diff computation during search/replace file edits.

---

## Build-Time Dependencies (Not Shipped)

### esbuild (v0.23.0)
MIT License — Copyright (c) 2020 Evan Wallace.
Bundles the extension host entry (`extension.js`) and webview UI (`webview.js`) for the VS Code extension.

### TypeScript (v5.5.4)
Apache-2.0 License — Copyright (c) Microsoft Corporation. All rights reserved.
Type-checker and compiler for the host and extension packages.

### vitest (v2.0.5)
MIT License — Copyright (c) 2021-Present Vitest Contributors.
Test runner for the host and extension test suites.

### @vscode/vsce (v2.32.0)
MIT License — Copyright (c) Microsoft Corporation.
Packages the compiled extension into a `.vsix` bundle.

### pnpm (v9.0.0)
MIT License — Copyright (c) 2016 Zoltan Kochan and other pnpm contributors.
Monorepo package manager.

### glob (v13.0.6)
ISC License — Copyright (c) Isaac Z. Schlueter and Contributors.
Used by build scripts (`scripts/remove-blank-lines.mjs`, `scripts/remove-comments.mjs`) for bulk file processing.

---

## Optional Peer Dependencies

### Playwright
Apache-2.0 License — Copyright (c) Microsoft Corporation.
Arc's browser tools (`browser.navigate`, `browser.click`, `browser.type`, `browser.screenshot`, `browser.evaluate`, `browser.readDom`, `browser.close`) use Playwright as an optional peer dependency. Users install it separately via `npx playwright install`. Without Playwright present, the tools return a descriptive error. The package is dynamically loaded so it is never bundled.

---

## Platform API

### Microsoft VS Code Engine API
MIT License — Copyright (c) Microsoft Corporation.
Arc targets VS Code `^1.95.0` and uses the extension host API (`vscode.window.*`, `vscode.workspace.*`, `vscode.commands.*`, Webview provider interfaces). These APIs are part of the VS Code platform and are not vendored.

---

## Assets

- `assets/arc-logo-mono.svg` — Original to Arc (KHROTU, 2026).
- `assets/arc-logo-pride.svg` — Original to Arc (KHROTU, 2026). Used during Pride Month (June, UTC); the mono variant is used at all other times.

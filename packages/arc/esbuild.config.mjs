import esbuild from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

await mkdir(resolve(__dirname, "dist"), { recursive: true });

const host = {
  entryPoints: [resolve(__dirname, "src/extension/host-entry.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: resolve(__dirname, "dist/extension.js"),
  external: ["vscode", "playwright", "playwright-core", "playwright-firefox"],
  sourcemap: true,
  logLevel: "info",
  alias: {
    "playwright": "playwright",
  },
  plugins: [
    {
      name: "skip-playwright",
      setup(b) {
        b.onResolve({ filter: /^playwright/ }, (args) => ({ path: args.path, external: true }));
      },
    },
  ],
};

const webview = {
  entryPoints: [resolve(__dirname, "webview-ui/src/entry.tsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: resolve(__dirname, "dist/webview.js"),
  jsx: "automatic",
  loader: { ".svg": "text", ".png": "dataurl" },
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production") },
  sourcemap: true,
  logLevel: "info",
  plugins: [
    {
      name: "css",
      setup(b) {
        b.onEnd(async (r) => {
          if (r.errors.length) return;
          const cssSrc = resolve(__dirname, "webview-ui/src/styles.css");
          if (existsSync(cssSrc)) {
            await copyFile(cssSrc, resolve(__dirname, "dist/styles.css"));
          }
        });
      },
    },
  ],
};

const ctx1 = await esbuild.context(host);
const ctx2 = await esbuild.context(webview);
if (watch) {
  await ctx1.watch();
  await ctx2.watch();
  const fs = await import("node:fs");
  fs.watch(resolve(__dirname, "webview-ui/src/styles.css"), async () => {
    const cssSrc = resolve(__dirname, "webview-ui/src/styles.css");
    if (existsSync(cssSrc)) await copyFile(cssSrc, resolve(__dirname, "dist/styles.css"));
  });
  console.log("[arc] watching...");
} else {
  await ctx1.rebuild();
  await ctx2.rebuild();
  await ctx1.dispose();
  await ctx2.dispose();
}

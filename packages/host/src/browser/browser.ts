import * as path from "node:path";
export interface BrowserAdapter {
  navigate(url: string): Promise<{ ok: boolean; output: string }>;
  click(selector: string): Promise<{ ok: boolean; output: string }>;
  type(selector: string, text: string): Promise<{ ok: boolean; output: string }>;
  screenshot(outPath?: string): Promise<{ ok: boolean; output: string }>;
  evaluate(script: string): Promise<{ ok: boolean; output: string }>;
  readDom(): Promise<{ ok: boolean; output: string }>;
  close(): Promise<void>;
}
export type BrowserKind = "chromium" | "firefox";
interface MinimalPlaywright {
  chromium?: { launch: (opts: { headless?: boolean }) => Promise<PlaywrightBrowser> };
  firefox?: { launch: (opts: { headless?: boolean }) => Promise<PlaywrightBrowser> };
}
interface PlaywrightBrowser {
  newContext(): Promise<{ newPage(): Promise<PlaywrightPage> }>;
  close(): Promise<void>;
}
interface PlaywrightPage {
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
  click(selector: string, opts: { timeout: number }): Promise<unknown>;
  fill(selector: string, text: string, opts: { timeout: number }): Promise<unknown>;
  screenshot(opts: { path: string }): Promise<unknown>;
  evaluate(script: string): Promise<unknown>;
  accessibility: { snapshot(): Promise<unknown> };
}
export async function createBrowser(kind: BrowserKind = "chromium", headless = true): Promise<BrowserAdapter> {
  let pw: MinimalPlaywright;
  try {
    const dyn = "play" + "wright";
    pw = (await import(dyn)) as MinimalPlaywright;
  } catch {
    return stub("Playwright is not installed. Run: pnpm add -D playwright");
  }
  const launcher = (kind === "firefox" ? pw.firefox : pw.chromium);
  if (!launcher) return stub("Requested browser launcher is not present in the installed Playwright bundle.");
  const browser = await launcher.launch({ headless });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const adapter: BrowserAdapter = {
    async navigate(url) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
        return { ok: true, output: `Navigated to ${url}` };
      } catch (e) {
        return { ok: false, output: `Navigation failed: ${(e as Error).message}` };
      }
    },
    async click(selector) {
      try {
        await page.click(selector, { timeout: 5_000 });
        return { ok: true, output: `Clicked ${selector}` };
      } catch (e) {
        return { ok: false, output: `Click failed: ${(e as Error).message}` };
      }
    },
    async type(selector, text) {
      try {
        await page.fill(selector, text, { timeout: 5_000 });
        return { ok: true, output: `Typed into ${selector}` };
      } catch (e) {
        return { ok: false, output: `Type failed: ${(e as Error).message}` };
      }
    },
    async screenshot(outPath) {
      try {
        const p = outPath || path.join(process.cwd(), `arc-shot-${Date.now()}.png`);
        await page.screenshot({ path: p });
        return { ok: true, output: `Saved ${p}` };
      } catch (e) {
        return { ok: false, output: `Screenshot failed: ${(e as Error).message}` };
      }
    },
    async evaluate(script) {
      try {
        const result = await page.evaluate(script);
        return { ok: true, output: typeof result === "string" ? result : JSON.stringify(result, null, 2) };
      } catch (e) {
        return { ok: false, output: `Eval failed: ${(e as Error).message}` };
      }
    },
    async readDom() {
      try {
        const a11y = await page.accessibility.snapshot();
        return { ok: true, output: JSON.stringify(a11y, null, 2) };
      } catch (e) {
        return { ok: false, output: `Accessibility snapshot failed: ${(e as Error).message}` };
      }
    },
    async close() {
      await browser.close().catch(() => undefined);
    },
  };
  return adapter;
}
function stub(message: string): BrowserAdapter {
  return {
    async navigate() { return { ok: false, output: message }; },
    async click() { return { ok: false, output: message }; },
    async type() { return { ok: false, output: message }; },
    async screenshot() { return { ok: false, output: message }; },
    async evaluate() { return { ok: false, output: message }; },
    async readDom() { return { ok: false, output: message }; },
async close() {  },
  };
}
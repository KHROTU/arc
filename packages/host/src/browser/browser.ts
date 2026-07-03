import * as path from "node:path";
export interface BrowserAdapter {
  navigate(url: string): Promise<{ ok: boolean; output: string }>;
  click(selector: string): Promise<{ ok: boolean; output: string }>;
  type(selector: string, text: string): Promise<{ ok: boolean; output: string }>;
  screenshot(outPath?: string): Promise<{ ok: boolean; output: string }>;
  evaluate(script: string): Promise<{ ok: boolean; output: string }>;
  readDom(): Promise<{ ok: boolean; output: string }>;
  readPage(): Promise<{ ok: boolean; output: string }>;
  hover(selector: string): Promise<{ ok: boolean; output: string }>;
  scroll(pixels?: number, selector?: string): Promise<{ ok: boolean; output: string }>;
  waitFor(selector?: string, urlPattern?: string, state?: "networkidle" | "load" | "domcontentloaded"): Promise<{ ok: boolean; output: string }>;
  drag(fromSelector: string, toSelector: string): Promise<{ ok: boolean; output: string }>;
  dialog(accept: boolean, promptText?: string): Promise<{ ok: boolean; output: string }>;
  runCode(code: string): Promise<{ ok: boolean; output: string }>;
  close(): Promise<void>;
  consoleLog(): string[];
  networkLog(): string[];
  domSnapshot(): string;
}
export type BrowserKind = "chromium" | "firefox";
interface ConsoleEntry { level: string; text: string; location: string; ts: number }
interface NetworkEntry { url: string; method: string; status: number; timing: number; ts: number }
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
  hover(selector: string, opts: { timeout: number }): Promise<unknown>;
  dragAndDrop(selector: string, targetSelector: string, opts: { timeout: number }): Promise<unknown>;
  waitForSelector(selector: string, opts: { state: string; timeout: number }): Promise<unknown>;
  waitForURL(url: string | RegExp, opts: { timeout: number }): Promise<unknown>;
  waitForLoadState(state: string): Promise<unknown>;
  evaluate(script: string): Promise<unknown>;
  screenshot(opts: { path: string }): Promise<unknown>;
  accessibility: { snapshot(): Promise<unknown> };
  content(): Promise<string>;
  on(event: string, fn: (...args: unknown[]) => void): void;
}
const MAX_LOG_ENTRIES = 50;
export async function createBrowser(kind: BrowserKind = "chromium", headless = true): Promise<BrowserAdapter> {
  let pw: MinimalPlaywright;
  try {
    pw = (await import("playwright")) as MinimalPlaywright;
  } catch {
    return stubAdapter("Playwright is not installed. Run: pnpm add -D playwright");
  }
  const launcher = (kind === "firefox" ? pw.firefox : pw.chromium);
  if (!launcher) return stubAdapter("Requested browser launcher is not present in the installed Playwright bundle.");
  const browser = await launcher.launch({ headless });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleLog: ConsoleEntry[] = [];
  const networkLog: NetworkEntry[] = [];
  let dialogAction: { accept: boolean; promptText?: string } | null = null;
  page.on("dialog", (d: any) => {
    const action = dialogAction ?? { accept: false };
    dialogAction = null;
    if (action.accept) {
      if (action.promptText !== undefined) d.accept(action.promptText);
      else d.accept();
    } else {
      d.dismiss();
    }
  });
  page.on("console", (msg: any) => {
    if (consoleLog.length >= MAX_LOG_ENTRIES) consoleLog.shift();
    consoleLog.push({
      level: msg.type() ?? "log",
      text: msg.text()?.slice(0, 500) ?? "",
      location: msg.location()?.url ?? "",
      ts: Date.now(),
    });
  });
  page.on("requestfinished", (req: any) => {
    if (networkLog.length >= MAX_LOG_ENTRIES) networkLog.shift();
    const timing = req.timing() ?? {};
    networkLog.push({
      url: req.url()?.slice(0, 300) ?? "",
      method: req.method() ?? "GET",
      status: req.response()?.status() ?? 0,
      timing: timing.responseEnd ?? timing.startTime ?? 0,
      ts: Date.now(),
    });
  });
  function captureSummary(): string {
    const parts: string[] = [];
    if (consoleLog.length) {
      parts.push("--- Console (last " + consoleLog.length + ") ---");
      for (const c of consoleLog) parts.push(`[${c.level}] ${c.text}${c.location ? " (" + c.location + ")" : ""}`);
    }
    if (networkLog.length) {
      parts.push("--- Network (last " + networkLog.length + ") ---");
      for (const n of networkLog) parts.push(`${n.method} ${n.status} ${n.url} ${n.timing}ms`);
    }
    return parts.join("\n");
  }
  const adapter: BrowserAdapter = {
    async navigate(url) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
        const cap = captureSummary();
        return { ok: true, output: `Navigated to ${url}${cap ? "\n\n" + cap : ""}` };
      } catch (e) { return { ok: false, output: `Navigation failed: ${(e as Error).message}` }; }
    },
    async click(selector) {
      try {
        await page.click(selector, { timeout: 5_000 });
        const cap = captureSummary();
        return { ok: true, output: `Clicked ${selector}${cap ? "\n\n" + cap : ""}` };
      } catch (e) { return { ok: false, output: `Click failed: ${(e as Error).message}` }; }
    },
    async type(selector, text) {
      try {
        await page.fill(selector, text, { timeout: 5_000 });
        const cap = captureSummary();
        return { ok: true, output: `Typed into ${selector}${cap ? "\n\n" + cap : ""}` };
      } catch (e) { return { ok: false, output: `Type failed: ${(e as Error).message}` }; }
    },
    async screenshot(outPath) {
      try {
        const p = outPath || path.join(process.cwd(), `arc-shot-${Date.now()}.png`);
        await page.screenshot({ path: p });
        const cap = captureSummary();
        return { ok: true, output: `Saved ${p}${cap ? "\n\n" + cap : ""}` };
      } catch (e) { return { ok: false, output: `Screenshot failed: ${(e as Error).message}` }; }
    },
    async evaluate(script) {
      try {
        const result = await page.evaluate(script);
        return { ok: true, output: typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? String(result) };
      } catch (e) { return { ok: false, output: `Eval failed: ${(e as Error).message}` }; }
    },
    async readDom() {
      try {
        const a11y = await page.accessibility.snapshot();
        return { ok: true, output: JSON.stringify(a11y, null, 2) };
      } catch (e) { return { ok: false, output: `Accessibility snapshot failed: ${(e as Error).message}` }; }
    },
    async hover(selector) {
      try {
        await page.hover(selector, { timeout: 5_000 });
        return { ok: true, output: `Hovered ${selector}` };
      } catch (e) { return { ok: false, output: `Hover failed: ${(e as Error).message}` }; }
    },
    async scroll(pixels, selector) {
      try {
        if (selector) {
          await page.evaluate(`(function(){const el=document.querySelector("${selector.replace(/"/g, '\\"')}");if(el)el.scrollIntoView({behavior:"smooth",block:"center"});})()`);
          return { ok: true, output: `Scrolled to ${selector}` };
        }
        await page.evaluate(`window.scrollBy(0, ${pixels ?? 300})`);
        return { ok: true, output: `Scrolled by ${pixels ?? 300}px` };
      } catch (e) { return { ok: false, output: `Scroll failed: ${(e as Error).message}` }; }
    },
    async waitFor(selector, urlPattern, state) {
      try {
        if (selector) {
          await page.waitForSelector(selector, { state: "visible", timeout: 10_000 });
          return { ok: true, output: `Selector "${selector}" appeared` };
        }
        if (urlPattern) {
          await page.waitForURL(urlPattern, { timeout: 10_000 });
          return { ok: true, output: `URL matched "${urlPattern}"` };
        }
        await page.waitForLoadState(state ?? "networkidle");
        return { ok: true, output: `Page reached state "${state ?? "networkidle"}"` };
      } catch (e) { return { ok: false, output: `Wait failed: ${(e as Error).message}` }; }
    },
    async drag(fromSelector, toSelector) {
      try {
        await page.dragAndDrop(fromSelector, toSelector, { timeout: 10_000 });
        return { ok: true, output: `Dragged ${fromSelector} onto ${toSelector}` };
      } catch (e) { return { ok: false, output: `Drag failed: ${(e as Error).message}` }; }
    },
    async dialog(accept, promptText) {
      dialogAction = { accept, promptText };
      return { ok: true, output: accept ? (promptText !== undefined ? `Dialog will be accepted with "${promptText}".` : "Dialog will be accepted.") : "Dialog will be dismissed." };
    },
    async runCode(code) {
      try {
        const fn = new Function("page", code) as (page: unknown) => Promise<unknown>;
        const result = await fn(page);
        return { ok: true, output: typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? String(result) };
      } catch (e) { return { ok: false, output: `Playwright code failed: ${(e as Error).message}` }; }
    },
    async readPage() {
      try {
        const html = await page.content() as string;
        const text = (await page.evaluate("document.body?.innerText ?? ''")) as string;
        return { ok: true, output: (text || html).slice(0, 4000) };
      } catch (e) { return { ok: false, output: `Read page failed: ${(e as Error).message}` }; }
    },
    async close() { await browser.close().catch(() => undefined); },
    consoleLog() { return consoleLog.map((c) => `[${c.level}] ${c.text}`); },
    networkLog() { return networkLog.map((n) => `${n.method} ${n.status} ${n.url} ${n.timing}ms`); },
    domSnapshot() { return captureSummary(); },
  };
  return adapter;
}
function stubAdapter(message: string): BrowserAdapter {
  return {
    async navigate() { return { ok: false, output: message }; },
    async click() { return { ok: false, output: message }; },
    async type() { return { ok: false, output: message }; },
    async screenshot() { return { ok: false, output: message }; },
    async evaluate() { return { ok: false, output: message }; },
    async readDom() { return { ok: false, output: message }; },
    async readPage() { return { ok: false, output: message }; },
    async hover() { return { ok: false, output: message }; },
    async scroll() { return { ok: false, output: message }; },
    async waitFor() { return { ok: false, output: message }; },
    async drag() { return { ok: false, output: message }; },
    async dialog() { return { ok: false, output: message }; },
    async runCode() { return { ok: false, output: message }; },
    async close() {},
    consoleLog() { return []; },
    networkLog() { return []; },
    domSnapshot() { return message; },
  };
}
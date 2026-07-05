import { describe, it, expect, afterEach } from "vitest";
import { createBrowser } from "../src/browser/browser";
import type { BrowserAdapter } from "../src/browser/browser";
describe("createBrowser multi-tab and interception", () => {
  let browser: BrowserAdapter | undefined;
  afterEach(async () => {
    if (browser) await browser.close();
    browser = undefined;
  });
  it("opens, lists, switches, and closes tabs", async () => {
    browser = await createBrowser("chromium", true);
    await browser.navigate("data:text/html,<h1>first</h1>");
    const opened = await browser.newTab("data:text/html,<h1>second</h1>");
    expect(opened.ok).toBe(true);
    expect(opened.tabId).toBeDefined();
    const list = await browser.listTabs();
    expect(list.tabs?.length).toBe(2);
    expect(list.tabs?.find((t) => t.id === opened.tabId)?.active).toBe(true);
    const firstTabId = list.tabs?.find((t) => t.id !== opened.tabId)?.id as string;
    const switched = await browser.switchTab(firstTabId);
    expect(switched.ok).toBe(true);
    const listAfterSwitch = await browser.listTabs();
    expect(listAfterSwitch.tabs?.find((t) => t.id === firstTabId)?.active).toBe(true);
    const closed = await browser.closeTab(opened.tabId as string);
    expect(closed.ok).toBe(true);
    const listAfterClose = await browser.listTabs();
    expect(listAfterClose.tabs?.length).toBe(1);
  });
  it("reports an error for an unknown tab id", async () => {
    browser = await createBrowser("chromium", true);
    const res = await browser.switchTab("nonexistent-tab");
    expect(res.ok).toBe(false);
  });
  it("intercepts and blocks matching requests", async () => {
    browser = await createBrowser("chromium", true);
    const intercepted = await browser.intercept("**/blocked-resource*", { block: true });
    expect(intercepted.ok).toBe(true);
    const result = await browser.evaluate(`
      fetch("https://example.invalid/blocked-resource").then(() => "resolved").catch(() => "rejected")
    `);
    expect(result.output).toContain("rejected");
  });
  it("mocks a response body for matching requests", async () => {
    browser = await createBrowser("chromium", true);
    await browser.navigate("data:text/html,<h1>mock</h1>");
    await browser.intercept("**/mock-api*", { status: 200, body: "{\"mocked\":true}", contentType: "application/json" });
    const result = await browser.evaluate(`
      fetch("https://example.invalid/mock-api").then((r) => r.text())
    `);
    expect(result.output).toContain("mocked");
  });
  it("stops intercepting after unintercept", async () => {
    browser = await createBrowser("chromium", true);
    await browser.intercept("**/toggle-api*", { block: true });
    const unintercepted = await browser.unintercept("**/toggle-api*");
    expect(unintercepted.ok).toBe(true);
    const again = await browser.unintercept("**/toggle-api*");
    expect(again.ok).toBe(false);
  });
});

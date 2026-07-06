import { createRoot } from "react-dom/client";
import App from "./App";
const root = document.getElementById("root");
if (!root) {
  document.body.innerHTML = "<pre style='color:#f88;padding:20px'>Arc: #root element missing</pre>";
} else {
  window.addEventListener("error", (ev) => {
    const el = document.createElement("pre");
    el.style.cssText = "color:#f88;padding:12px;white-space:pre-wrap;font:12px monospace;background:#2a1010;border:1px solid #f44;margin:8px;border-radius:4px;";
    el.textContent = `[arc webview error]\n${(ev as ErrorEvent).error?.stack ?? ev.message}`;
    root.appendChild(el);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const el = document.createElement("pre");
    el.style.cssText = "color:#f88;padding:12px;white-space:pre-wrap;font:12px monospace;background:#2a1010;border:1px solid #f44;margin:8px;border-radius:4px;";
    el.textContent = `[arc webview unhandled rejection]\n${(ev.reason as Error)?.stack ?? String(ev.reason)}`;
    root.appendChild(el);
  });
  try {
    const mode = (root.getAttribute("data-mode") as "sidebar" | "fullscreen") || "sidebar";
    const mono = root.getAttribute("data-mono") || "";
    const pride = root.getAttribute("data-pride") || "";
    const monoText = root.getAttribute("data-mono-text") || "";
    const version = root.getAttribute("data-version") || "0.0.0";
    const isPride = root.getAttribute("data-pride-active") === "true";
    const toolTree = (root.getAttribute("data-tool-tree") as "auto" | "collapsed") || "auto";
    let providerCatalog: { kind: string; label: string; tags: string[]; defaultBaseUrl?: string }[] = [];
    try { providerCatalog = JSON.parse(root.getAttribute("data-catalog") || "[]"); } catch { }
    createRoot(root).render(<App mode={mode} monoLogo={mono} prideLogo={pride} monoLogoText={monoText} prideActive={isPride} toolTreeMode={toolTree} version={version} providerCatalog={providerCatalog} />);
  } catch (err) {
    root.innerHTML = `<pre style="color:#f88;padding:20px;white-space:pre-wrap;font:12px monospace">${(err as Error)?.stack ?? String(err)}</pre>`;
  }
}
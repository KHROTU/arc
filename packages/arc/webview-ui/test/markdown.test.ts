import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/util/markdown";
describe("markdown self-check", () => {
  it("renders all six heading levels", () => {
    const md = ["# H1", "## H2", "### H3", "#### H4", "##### H5", "###### H6"].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain("<h1>H1</h1>");
    expect(html).toContain("<h2>H2</h2>");
    expect(html).toContain("<h3>H3</h3>");
    expect(html).toContain("<h4>H4</h4>");
    expect(html).toContain("<h5>H5</h5>");
    expect(html).toContain("<h6>H6</h6>");
  });
  it("renders bold, italic, strikethrough, and nested variants", () => {
    const md = "Plain **bold** and *italic* and ~~strike~~. ***bold-italic*** and **bold with *italic* inside**.";
    const html = renderMarkdown(md);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<del>strike</del>");
    expect(html).toContain("<strong><em>bold-italic</em></strong>");
    expect(html).toContain("<strong>bold with <em>italic</em> inside</strong>");
  });
  it("renders a multi-level nested list with mixed ordered/unordered", () => {
    const md = [
      "- outer 1",
      "  - inner a",
      "    - inner-inner 1",
      "    - inner-inner 2",
      "  - inner b",
      "- outer 2",
      "  1. ordered a",
      "  2. ordered b",
      "    - mixed unordered inside ordered",
    ].join("\n");
    const html = renderMarkdown(md);
    expect((html.match(/<ul class="arc-md-ul">/g) ?? []).length).toBeGreaterThanOrEqual(3); 
    expect(html).toContain('<ol class="arc-md-ol">');
    const openLi = (html.match(/<li[\s>]/g) ?? []).length;
    const closeLi = (html.match(/<\/li>/g) ?? []).length;
    expect(closeLi).toBe(openLi);
  });
  it("renders a task list with checked and unchecked items", () => {
    const md = ["- [ ] todo unchecked", "- [x] todo checked", "- [ ] another unchecked"].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain('type="checkbox" disabled');
    expect(html).toContain("checked");
    const checkboxMatches = html.match(/<input type="checkbox"[^>]*>/g) ?? [];
    expect(checkboxMatches.length).toBe(3);
    expect(checkboxMatches.filter((c) => c.includes("checked")).length).toBe(1);
  });
  it("renders a table with left/center/right alignment", () => {
    const md = [
      "| Col A | Col B | Col C |",
      "|:------|:-----:|------:|",
      "| left | center | right |",
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain('<table class="arc-md-table">');
    expect(html).toContain('<th style="text-align:left">Col A</th>');
    expect(html).toContain('<th style="text-align:center">Col B</th>');
    expect(html).toContain('<th style="text-align:right">Col C</th>');
    expect(html).toContain('<td style="text-align:center">center</td>');
    expect(html).toContain('<td style="text-align:right">right</td>');
  });
  it("renders a blockquote containing a nested code block", () => {
    const md = [
      "> A blockquote",
      "> > with a nested",
      "> > ```python",
      "> > def f(x):",
      "> >     return x * 2",
      "> > ```",
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain('<blockquote class="arc-md-quote">');
    expect((html.match(/<blockquote class="arc-md-quote">/g) ?? []).length).toBe(2);
    expect(html).toContain('<pre class="arc-md-pre"');
    expect(html).toContain('data-lang="python"');
    const bqOpen = html.indexOf('<blockquote class="arc-md-quote">');
    const preOpen = html.indexOf('<pre class="arc-md-pre"');
    const preClose = html.indexOf("</pre>");
    const bqClose = html.lastIndexOf("</blockquote>");
    expect(bqOpen).toBeLessThan(preOpen);
    expect(preOpen).toBeLessThan(preClose);
    expect(preClose).toBeLessThan(bqClose);
  });
  it("renders fenced code blocks with Python syntax highlighting", () => {
    const md = ["```python", "def greet(name):", "    return f\"Hello, {name}!\"", "", "print(greet(\"world\"))", "```"].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain('<pre class="arc-md-pre" data-lang="python">');
    expect(html).toContain('<span class="arc-syn-kw">def</span>');
    expect(html).toContain('<span class="arc-syn-kw">return</span>');
    expect(html).toContain('<span class="arc-syn-str">');
  });
  it("renders an inline link and an image with alt-text", () => {
    const md = "Inline [link](https://example.com) and image: ![alt text](https://example.com/x.png).";
    const html = renderMarkdown(md);
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer" target="_blank">link</a>');
    expect(html).toContain('<img src="https://example.com/x.png" alt="alt text" loading="lazy" />');
  });
  it("renders a horizontal rule (---, ***, ___) ", () => {
    expect(renderMarkdown("---")).toContain('<hr class="arc-md-hr" />');
    expect(renderMarkdown("***")).toContain('<hr class="arc-md-hr" />');
    expect(renderMarkdown("___")).toContain('<hr class="arc-md-hr" />');
  });
  it("escapes raw HTML instead of rendering it", () => {
    const md = "Hello <script>alert(1)</script> world";
    const html = renderMarkdown(md);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("escapes HTML and attribute breaks inside links and images", () => {
    const html = renderMarkdown('[</a><style>.arc-approval-deny{display:none}</style><a>](https://example.com" autofocus="true) ![x" onerror="alert(1)](/safe.png)');
    expect(html).not.toContain("<style>");
    expect(html).not.toContain('autofocus="true"');
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;/a&gt;&lt;style&gt;");
  });
});
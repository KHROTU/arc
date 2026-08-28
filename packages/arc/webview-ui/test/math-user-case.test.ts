import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/util/markdown";
describe("user-reported math case", () => {
  it("renders $17802 \\times 16 + 4$ as math", () => {
    const html = renderMarkdown("which is $17802 \\times 16 + 4$), suggesting");
    expect(html).toContain('class="katex"');
    expect(html).toContain("1");
    expect(html).toContain("7");
    expect(html).toContain("×");
    expect(html).not.toContain("$17802");
  });
  it("keeps plain currency as literal text", () => {
    const html = renderMarkdown("Cost is $5 and $1,000 total.");
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("$5");
  });
  it("renders single-line block math $$...$$ without swallowing the rest", () => {
    const md = [
      "### Calculus",
      "$$\\frac{d}{dx}\\left[\\int_{a}^{x} f(t)\\,dt\\right] = f(x)$$",
      "",
      "And then the next paragraph still renders.",
      "",
      "## Next Section",
      "More content here.",
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("∫");
    expect(html).toContain("<p>And then the next paragraph still renders.</p>");
    expect(html).toContain("<h2>Next Section</h2>");
    expect(html).toContain("More content here.");
  });
  it("renders block math across multiple lines and trailing close", () => {
    const md = [
      "$$",
      "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}",
      "$$",
      "",
      "after",
    ].join("\n");
    const html = renderMarkdown(md);
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("∑");
    expect(html).toContain("π");
    expect(html).toContain("<p>after</p>");
  });
});
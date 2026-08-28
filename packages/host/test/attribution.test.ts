import { describe, it, expect } from "vitest";
import { attributionHeaders } from "../src/providers/attribution";
describe("attribution headers", () => {
  it("sends the OpenRouter dialect for openrouter with its own title header", () => {
    const h = attributionHeaders("openrouter");
    expect(h["http-referer"]).toBe("https://github.com/KHROTU/arc");
    expect(h["x-openrouter-title"]).toBe("Arc");
    expect(h["x-openrouter-categories"]).toBe("ide-extension");
    expect(h["user-agent"]).toMatch(/^Arc\//);
  });
  it("sends HTTP-Referer + X-Title for OpenRouter-dialect routers", () => {
    for (const kind of ["poe", "zenmux", "requesty", "orcarouter", "fastrouter", "anyapi", "unorouter"] as const) {
      const h = attributionHeaders(kind);
      expect(h["http-referer"]).toBe("https://github.com/KHROTU/arc");
      expect(h["x-title"]).toBe("Arc");
    }
  });
  it("sends lowercase referer/title for Vercel", () => {
    const h = attributionHeaders("vercel");
    expect(h["http-referer"]).toBe("https://github.com/KHROTU/arc");
    expect(h["x-title"]).toBe("Arc");
  });
  it("adds X-Source for LLM Gateway", () => {
    const h = attributionHeaders("llmgateway");
    expect(h["x-source"]).toBe("github.com");
    expect(h["x-title"]).toBe("Arc");
  });
  it("sends mandatory Copilot headers for github-copilot", () => {
    const h = attributionHeaders("github-copilot");
    expect(h["copilot-integration-id"]).toBe("vscode-chat");
    expect(h["editor-version"]).toBe("Arc/0.6.1");
    expect(h["user-agent"]).toBe("Arc/0.6.1");
  });
  it("sends vendor-prefixed integration headers", () => {
    expect(attributionHeaders("cohere")["x-client-name"]).toBe("Arc");
    expect(attributionHeaders("cerebras")["x-cerebras-3rd-party-integration"]).toBe("arc");
    expect(attributionHeaders("perplexity")["x-pplx-integration"]).toBe("arc/0.6.1");
    expect(attributionHeaders("perplexity-agent")["x-pplx-integration"]).toBe("arc/0.6.1");
    expect(attributionHeaders("google")["x-goog-api-client"]).toBe("arc/0.6.1");
    expect(attributionHeaders("gcp-vertex")["x-goog-api-client"]).toBe("arc/0.6.1");
    expect(attributionHeaders("kilo-gateway")["x-kilocode-feature"]).toBe("arc");
    expect(attributionHeaders("helicone")["helicone-property-app"]).toBe("Arc");
    expect(attributionHeaders("inference")["x-inference-metadata-app"]).toBe("Arc");
    expect(attributionHeaders("portkey")["x-portkey-metadata"]).toContain("Arc");
    expect(attributionHeaders("litellm-proxy")["x-litellm-tags"]).toBe("app:arc");
  });
  it("always includes a descriptive user-agent and the safe default set", () => {
    for (const kind of ["openai", "deepseek", "mistral", "groq", "xai", "anthropic"] as const) {
      const h = attributionHeaders(kind);
      expect(h["user-agent"]).toMatch(/^Arc\/0\.6\.1 \(\+https:\/\/github\.com\/KHROTU\/arc\)$/);
    }
  });
});
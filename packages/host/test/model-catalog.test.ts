import { describe, it, expect } from "vitest";
import { parseOpenRouterCatalogue, matchModelInfo, groupProviderModels, stripVariantCandidates, formatFallbackName, type OpenRouterModelInfo } from "../src/providers/model-catalog";
function catalogueFrom(entries: { id: string; name?: string; context_length?: number; max_completion_tokens?: number; prompt?: string; completion?: string; input_modalities?: string[] }[]): Map<string, OpenRouterModelInfo> {
  return parseOpenRouterCatalogue({
    data: entries.map((e) => ({
      id: e.id,
      name: e.name,
      context_length: e.context_length,
      top_provider: { max_completion_tokens: e.max_completion_tokens },
      pricing: { prompt: e.prompt, completion: e.completion },
      architecture: { input_modalities: e.input_modalities },
    })),
  });
}
describe("parseOpenRouterCatalogue", () => {
  it("extracts display name, context, max output, pricing per 1M, and capabilities", () => {
    const map = parseOpenRouterCatalogue({
      data: [
        {
          id: "zai/glm-5.3-flash",
          canonical_slug: "zai/glm-5.3-flash",
          name: "Z AI: GLM 5.3 Flash",
          context_length: 1048576,
          top_provider: { max_completion_tokens: 131072 },
          pricing: { prompt: "0.000002", completion: "0.000008" },
          architecture: { input_modalities: ["text", "image"] },
        },
      ],
    });
    const info = map.get("zai/glm-5.3-flash");
    expect(info).toBeDefined();
    expect(info?.displayName).toBe("GLM 5.3 Flash");
    expect(info?.contextLength).toBe(1048576);
    expect(info?.maxOutputTokens).toBe(131072);
    expect(info?.priceInPer1m).toBeCloseTo(2);
    expect(info?.priceOutPer1m).toBeCloseTo(8);
    expect(info?.imageInput).toBe(true);
  });
});
describe("matchModelInfo", () => {
  const map = catalogueFrom([{ id: "zai/glm-5.3-flash", name: "Z AI: GLM 5.3 Flash" }]);
  it("matches direct and normalized ids", () => {
    expect(matchModelInfo(map, "zai/glm-5.3-flash")?.displayName).toBe("GLM 5.3 Flash");
    expect(matchModelInfo(map, "glm-5-3-flash")?.displayName).toBe("GLM 5.3 Flash");
    expect(matchModelInfo(map, "glm-5.3-flash")).toBeDefined();
  });
  it("returns undefined for unrelated ids", () => {
    expect(matchModelInfo(map, "openai/gpt-4o")).toBeUndefined();
  });
  it("strips variants to reach the base slug", () => {
    const cands = stripVariantCandidates("glm-5.3-flash:free");
    expect(cands).toContain("glm-5.3-flash");
    expect(formatFallbackName("glm-5-3-flash")).toBe("GLM 5.3 Flash");
  });
  it("matches HF-style underscore ids to their vendor/model pair", () => {
    const map = catalogueFrom([{ id: "qwen/qwen3-14b", name: "Qwen: Qwen3 14B" }]);
    expect(matchModelInfo(map, "Qwen_Qwen3-14B")?.displayName).toBe("Qwen3 14B");
  });
  it("formats unknown slugs without mangling version hyphens or size suffixes", () => {
    expect(formatFallbackName("qwen3-14b")).toBe("Qwen3 14B");
    expect(formatFallbackName("Qwen_Qwen3.5-32B")).toBe("Qwen3.5 32B");
    expect(formatFallbackName("meta-llama/Llama-4-405B-Instruct")).toBe("Llama 4 405B Instruct");
  });
});
describe("groupProviderModels", () => {
  it("groups the same model across providers into one OpenRouter-labelled alias", async () => {
    const map = catalogueFrom([{ id: "zai/glm-5.3-flash", name: "Z AI: GLM 5.3 Flash", context_length: 1048576, max_completion_tokens: 131072, prompt: "0.000002", completion: "0.000008", input_modalities: ["text"] }]);
    const grouped = await groupProviderModels([
      { slug: "zai/glm-5.3-flash", providerId: "a" },
      { slug: "glm-5-3-flash", providerId: "b" },
    ], map);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe("GLM 5.3 Flash");
    expect(grouped[0].providers).toEqual([
      { slug: "zai/glm-5.3-flash", providerId: "a" },
      { slug: "glm-5-3-flash", providerId: "b" },
    ]);
    expect(grouped[0].info?.contextLength).toBe(1048576);
    expect(grouped[0].info?.priceInPer1m).toBeCloseTo(2);
  });
  it("falls back to the formatted slug when OpenRouter has no match", async () => {
    const grouped = await groupProviderModels([{ slug: "some-unknown-model-v2", providerId: "a" }], new Map());
    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe("Some Unknown Model V2");
    expect(grouped[0].info).toBeUndefined();
  });
  it("keeps free/thinking variants in the same alias", async () => {
    const grouped = await groupProviderModels([
      { slug: "glm-5.3-flash", providerId: "a" },
      { slug: "glm-5.3-flash:free", providerId: "a" },
    ], new Map());
    expect(grouped).toHaveLength(1);
  });
});
import type { ProviderKind } from "../protocol/protocol.js";
export interface ProviderSpec {
  kind: ProviderKind;
  label: string;
  defaultBaseUrl?: string;
  docs?: string;
}
export const PROVIDERS: ProviderSpec[] = [
  { kind: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", docs: "https://developers.openai.com/api/docs/pricing" },
  { kind: "openrouter", label: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1", docs: "https://openrouter.ai/models" },
  { kind: "anthropic", label: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1", docs: "https://platform.claude.com/docs/en/about-claude/models/overview" },
  { kind: "google", label: "Google AI", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", docs: "https://ai.google.dev/gemini-api/docs/models" },
  { kind: "groq", label: "Groq", defaultBaseUrl: "https://api.groq.com/openai/v1", docs: "https://console.groq.com/docs/models" },
  { kind: "mistral", label: "Mistral", defaultBaseUrl: "https://api.mistral.ai/v1", docs: "https://docs.mistral.ai/getting-started/models/models_overview/" },
  { kind: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com", docs: "https://api-docs.deepseek.com/quick_start/pricing" },
  { kind: "xai", label: "xAI", defaultBaseUrl: "https://api.x.ai/v1", docs: "https://docs.x.ai/developers/models" },
  { kind: "cohere", label: "Cohere", defaultBaseUrl: "https://api.cohere.ai/compatibility/v1", docs: "https://docs.cohere.com/docs/models" },
  { kind: "fireworks", label: "Fireworks AI", defaultBaseUrl: "https://api.fireworks.ai/inference/v1", docs: "https://fireworks.ai/models" },
  { kind: "together", label: "Together AI", defaultBaseUrl: "https://api.together.xyz/v1", docs: "https://docs.together.ai/docs/inference-models" },
  { kind: "perplexity", label: "Perplexity", defaultBaseUrl: "https://api.perplexity.ai", docs: "https://docs.perplexity.ai/guides/pricing" },
  { kind: "deepinfra", label: "DeepInfra", defaultBaseUrl: "https://api.deepinfra.com/v1/openai", docs: "https://deepinfra.com/models" },
  { kind: "cerebras", label: "Cerebras", defaultBaseUrl: "https://api.cerebras.ai/v1", docs: "https://cerebras.ai/pricing" },
  { kind: "ollama", label: "Ollama", defaultBaseUrl: "http://127.0.0.1:11434", docs: "https://ollama.com/library" },
  { kind: "minimax", label: "MiniMax", defaultBaseUrl: "https://api.minimax.io/v1", docs: "https://platform.minimax.io/docs" },
  { kind: "minimax-cn", label: "MiniMax (CN)", defaultBaseUrl: "https://api.minimaxi.com/v1", docs: "https://platform.minimax.io/docs" },
  { kind: "kimi", label: "Kimi", defaultBaseUrl: "https://api.moonshot.ai/v1", docs: "https://platform.moonshot.ai/docs" },
  { kind: "kimi-cn", label: "Kimi (CN)", defaultBaseUrl: "https://api.moonshot.cn/v1", docs: "https://platform.moonshot.cn/docs" },
  { kind: "z-ai", label: "Z.ai", defaultBaseUrl: "https://api.z.ai/api/paas/v4", docs: "https://docs.z.ai" },
  { kind: "z-ai-cn", label: "Z.ai (CN)", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", docs: "https://open.bigmodel.cn/dev/howuse/model" },
  { kind: "vscode-lm", label: "VS Code Language Models" },
  { kind: "openai-compatible", label: "OpenAI-compatible" },
  { kind: "minimax", label: "MiniMax", defaultBaseUrl: "https://api.minimax.io/v1", docs: "https://platform.minimax.io/docs" },
  { kind: "minimax-cn", label: "MiniMax (CN)", defaultBaseUrl: "https://api.minimaxi.com/v1", docs: "https://platform.minimax.io/docs" },
  { kind: "kimi", label: "Kimi", defaultBaseUrl: "https://api.moonshot.ai/v1", docs: "https://platform.moonshot.ai/docs" },
  { kind: "kimi-cn", label: "Kimi (CN)", defaultBaseUrl: "https://api.moonshot.cn/v1", docs: "https://platform.moonshot.cn/docs" },
  { kind: "z-ai", label: "Z.ai", defaultBaseUrl: "https://api.z.ai/api/paas/v4", docs: "https://docs.z.ai" },
  { kind: "z-ai-cn", label: "Z.ai (CN)", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", docs: "https://open.bigmodel.cn/dev/howuse/model" },
];
export function getProviderSpec(kind: ProviderKind): ProviderSpec | undefined {
  return PROVIDERS.find((p) => p.kind === kind);
}
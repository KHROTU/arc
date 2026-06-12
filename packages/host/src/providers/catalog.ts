import type { ProviderKind } from "../protocol/protocol.js";
export interface ProviderSpec {
  kind: ProviderKind;
  label: string;
  defaultBaseUrl?: string;
  docs?: string;
  defaultModels?: { id: string; label: string; contextWindow: number; costPer1mIn: number; costPer1mOut: number }[];
}
const OPENAI_DEFAULTS = [
  { id: "gpt-5.5", label: "GPT-5.5", contextWindow: 1_000_000, costPer1mIn: 5, costPer1mOut: 30 },
  { id: "gpt-5.5-pro", label: "GPT-5.5 Pro", contextWindow: 1_000_000, costPer1mIn: 30, costPer1mOut: 180 },
  { id: "gpt-5.4", label: "GPT-5.4", contextWindow: 1_000_000, costPer1mIn: 2.5, costPer1mOut: 15 },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", contextWindow: 400_000, costPer1mIn: 0.75, costPer1mOut: 4.5 },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano", contextWindow: 400_000, costPer1mIn: 0.2, costPer1mOut: 1.25 },
  { id: "gpt-5.4-pro", label: "GPT-5.4 Pro", contextWindow: 400_000, costPer1mIn: 30, costPer1mOut: 180 },
];
const ANTHROPIC_DEFAULTS = [
  { id: "claude-fable-5", label: "Claude Fable 5", contextWindow: 1_000_000, costPer1mIn: 10, costPer1mOut: 50 },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", contextWindow: 1_000_000, costPer1mIn: 5, costPer1mOut: 25 },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextWindow: 1_000_000, costPer1mIn: 3, costPer1mOut: 15 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextWindow: 200_000, costPer1mIn: 1, costPer1mOut: 5 },
];
const GOOGLE_DEFAULTS = [
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)", contextWindow: 1_000_000, costPer1mIn: 2, costPer1mOut: 12 },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", contextWindow: 1_000_000, costPer1mIn: 1.5, costPer1mOut: 9 },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", contextWindow: 1_000_000, costPer1mIn: 0.5, costPer1mOut: 3 },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", contextWindow: 1_000_000, costPer1mIn: 0.25, costPer1mOut: 1.5 },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", contextWindow: 1_048_576, costPer1mIn: 1.25, costPer1mOut: 10 },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", contextWindow: 1_000_000, costPer1mIn: 0.3, costPer1mOut: 2.5 },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", contextWindow: 1_000_000, costPer1mIn: 0.1, costPer1mOut: 0.4 },
];
const GROQ_DEFAULTS = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", contextWindow: 128_000, costPer1mIn: 0.15, costPer1mOut: 0.6 },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", contextWindow: 128_000, costPer1mIn: 0.075, costPer1mOut: 0.3 },
  { id: "moonshotai/kimi-k2-instruct-0905", label: "Kimi K2 Instruct (0905)", contextWindow: 256_000, costPer1mIn: 1, costPer1mOut: 3 },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17Bx16E", contextWindow: 128_000, costPer1mIn: 0.11, costPer1mOut: 0.34 },
  { id: "qwen/qwen3-32b", label: "Qwen3 32B", contextWindow: 131_072, costPer1mIn: 0.29, costPer1mOut: 0.59 },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", contextWindow: 128_000, costPer1mIn: 0.59, costPer1mOut: 0.79 },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", contextWindow: 128_000, costPer1mIn: 0.05, costPer1mOut: 0.08 },
];
const DEEPSEEK_DEFAULTS = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", contextWindow: 1_000_000, costPer1mIn: 0.14, costPer1mOut: 0.28 },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", contextWindow: 1_000_000, costPer1mIn: 0.435, costPer1mOut: 0.87 },
];
const XAI_DEFAULTS = [
  { id: "grok-4.3", label: "Grok 4.3", contextWindow: 1_000_000, costPer1mIn: 1.25, costPer1mOut: 2.5 },
  { id: "grok-build-0.1", label: "Grok Build 0.1 (coding)", contextWindow: 256_000, costPer1mIn: 1, costPer1mOut: 2 },
];
const MISTRAL_DEFAULTS = [
  { id: "mistral-large-latest", label: "Mistral Large 3", contextWindow: 256_000, costPer1mIn: 2, costPer1mOut: 6 },
  { id: "mistral-medium-latest", label: "Mistral Medium 3.5", contextWindow: 128_000, costPer1mIn: 1, costPer1mOut: 3 },
  { id: "mistral-small-latest", label: "Mistral Small 4", contextWindow: 128_000, costPer1mIn: 0.2, costPer1mOut: 0.6 },
  { id: "magistral-medium-latest", label: "Magistral Medium 1.2 (reasoning)", contextWindow: 128_000, costPer1mIn: 2, costPer1mOut: 5 },
  { id: "codestral-latest", label: "Codestral", contextWindow: 256_000, costPer1mIn: 0.3, costPer1mOut: 0.9 },
  { id: "devstral-medium-latest", label: "Devstral 2 (coding agent)", contextWindow: 256_000, costPer1mIn: 0.5, costPer1mOut: 1.5 },
];
const COHERE_DEFAULTS = [
  { id: "command-a-03-2025", label: "Command A", contextWindow: 256_000, costPer1mIn: 2.5, costPer1mOut: 10 },
  { id: "command-r-plus-08-2024", label: "Command R+ (08-2024)", contextWindow: 128_000, costPer1mIn: 2.5, costPer1mOut: 10 },
  { id: "command-r-08-2024", label: "Command R (08-2024)", contextWindow: 128_000, costPer1mIn: 0.15, costPer1mOut: 0.6 },
  { id: "command-r7b-12-2024", label: "Command R7B", contextWindow: 128_000, costPer1mIn: 0.0375, costPer1mOut: 0.15 },
];
const FIREWORKS_DEFAULTS = [
  { id: "accounts/fireworks/models/deepseek-v4-pro", label: "DeepSeek V4 Pro (Fireworks)", contextWindow: 1_000_000, costPer1mIn: 1.74, costPer1mOut: 3.48 },
  { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", label: "Llama 3.3 70B (Fireworks)", contextWindow: 131_072, costPer1mIn: 0.9, costPer1mOut: 0.9 },
  { id: "accounts/fireworks/models/llama4-maverick-instruct-basic", label: "Llama 4 Maverick (Fireworks)", contextWindow: 256_000, costPer1mIn: 0.3, costPer1mOut: 0.9 },
  { id: "accounts/fireworks/models/qwen3-235b-a22b", label: "Qwen3 235B A22B (Fireworks)", contextWindow: 256_000, costPer1mIn: 0.9, costPer1mOut: 0.9 },
];
const TOGETHER_DEFAULTS = [
  { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B Turbo (Together)", contextWindow: 131_072, costPer1mIn: 0.88, costPer1mOut: 0.88 },
  { id: "deepseek-ai/DeepSeek-V4-Pro", label: "DeepSeek V4 Pro (Together)", contextWindow: 1_000_000, costPer1mIn: 2.1, costPer1mOut: 4.4 },
  { id: "Qwen/Qwen3-235B-A22B-Instruct-2507-tput", label: "Qwen3 235B A22B (Together)", contextWindow: 262_144, costPer1mIn: 0.2, costPer1mOut: 0.6 },
];
const PERPLEXITY_DEFAULTS = [
  { id: "sonar", label: "Sonar", contextWindow: 127_000, costPer1mIn: 1, costPer1mOut: 1 },
  { id: "sonar-pro", label: "Sonar Pro", contextWindow: 200_000, costPer1mIn: 3, costPer1mOut: 15 },
  { id: "sonar-reasoning-pro", label: "Sonar Reasoning Pro", contextWindow: 127_000, costPer1mIn: 2, costPer1mOut: 8 },
  { id: "sonar-deep-research", label: "Sonar Deep Research", contextWindow: 200_000, costPer1mIn: 2, costPer1mOut: 8 },
];
const DEEPINFRA_DEFAULTS = [
  { id: "meta-llama/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B (DeepInfra)", contextWindow: 131_072, costPer1mIn: 0.23, costPer1mOut: 0.4 },
  { id: "deepseek-ai/DeepSeek-V3.1", label: "DeepSeek V3.1 (DeepInfra)", contextWindow: 163_840, costPer1mIn: 0.27, costPer1mOut: 1.1 },
  { id: "Qwen/Qwen3-235B-A22B", label: "Qwen3 235B A22B (DeepInfra)", contextWindow: 131_072, costPer1mIn: 0.2, costPer1mOut: 0.6 },
];
const CEREBRAS_DEFAULTS = [
  { id: "gpt-oss-120b", label: "GPT-OSS 120B (Cerebras)", contextWindow: 128_000, costPer1mIn: 0.35, costPer1mOut: 0.75 },
  { id: "zai-glm-4.7", label: "ZAI GLM 4.7 (Cerebras, preview)", contextWindow: 128_000, costPer1mIn: 2.25, costPer1mOut: 2.75 },
];
const OLLAMA_DEFAULTS = [
  { id: "gpt-oss", label: "GPT-OSS 20B (local)", contextWindow: 128_000, costPer1mIn: 0, costPer1mOut: 0 },
  { id: "llama3.3", label: "Llama 3.3 70B (local)", contextWindow: 128_000, costPer1mIn: 0, costPer1mOut: 0 },
  { id: "qwen3", label: "Qwen 3 (local)", contextWindow: 128_000, costPer1mIn: 0, costPer1mOut: 0 },
  { id: "qwen3-coder", label: "Qwen 3 Coder (local)", contextWindow: 256_000, costPer1mIn: 0, costPer1mOut: 0 },
  { id: "deepseek-r1", label: "DeepSeek R1 (local)", contextWindow: 128_000, costPer1mIn: 0, costPer1mOut: 0 },
  { id: "gemma3", label: "Gemma 3 (local)", contextWindow: 128_000, costPer1mIn: 0, costPer1mOut: 0 },
];
export const PROVIDERS: ProviderSpec[] = [
  { kind: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", docs: "https://developers.openai.com/api/docs/models", defaultModels: OPENAI_DEFAULTS },
  { kind: "openrouter", label: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1", docs: "https://openrouter.ai/docs", defaultModels: [] },
  { kind: "anthropic", label: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1", docs: "https://platform.claude.com/docs/en/about-claude/models/overview", defaultModels: ANTHROPIC_DEFAULTS },
  { kind: "google", label: "Google AI", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", docs: "https://ai.google.dev/gemini-api/docs/models", defaultModels: GOOGLE_DEFAULTS },
  { kind: "groq", label: "Groq", defaultBaseUrl: "https://api.groq.com/openai/v1", docs: "https://console.groq.com/docs/models", defaultModels: GROQ_DEFAULTS },
  { kind: "mistral", label: "Mistral", defaultBaseUrl: "https://api.mistral.ai/v1", docs: "https://docs.mistral.ai/getting-started/models/models_overview/", defaultModels: MISTRAL_DEFAULTS },
  { kind: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1", docs: "https://api-docs.deepseek.com/quick_start/pricing", defaultModels: DEEPSEEK_DEFAULTS },
  { kind: "xai", label: "xAI (Grok)", defaultBaseUrl: "https://api.x.ai/v1", docs: "https://docs.x.ai/developers/models", defaultModels: XAI_DEFAULTS },
  { kind: "cohere", label: "Cohere", defaultBaseUrl: "https://api.cohere.ai/compatibility/v1", docs: "https://docs.cohere.com/docs/models", defaultModels: COHERE_DEFAULTS },
  { kind: "fireworks", label: "Fireworks AI", defaultBaseUrl: "https://api.fireworks.ai/inference/v1", docs: "https://fireworks.ai/models", defaultModels: FIREWORKS_DEFAULTS },
  { kind: "together", label: "Together AI", defaultBaseUrl: "https://api.together.xyz/v1", docs: "https://docs.together.ai/docs/inference-models", defaultModels: TOGETHER_DEFAULTS },
  { kind: "perplexity", label: "Perplexity", defaultBaseUrl: "https://api.perplexity.ai", docs: "https://docs.perplexity.ai/docs/getting-started/pricing", defaultModels: PERPLEXITY_DEFAULTS },
  { kind: "deepinfra", label: "DeepInfra", defaultBaseUrl: "https://api.deepinfra.com/v1/openai", docs: "https://deepinfra.com/models", defaultModels: DEEPINFRA_DEFAULTS },
  { kind: "cerebras", label: "Cerebras", defaultBaseUrl: "https://api.cerebras.ai/v1", docs: "https://inference-docs.cerebras.ai/", defaultModels: CEREBRAS_DEFAULTS },
  { kind: "ollama", label: "Ollama (local)", defaultBaseUrl: "http://127.0.0.1:11434", docs: "https://ollama.com/library", defaultModels: OLLAMA_DEFAULTS },
  { kind: "vscode-lm", label: "VS Code Language Models" },
  { kind: "openai-compatible", label: "OpenAI-compatible (custom)" },
];
export function getProviderSpec(kind: ProviderKind): ProviderSpec | undefined {
  return PROVIDERS.find((p) => p.kind === kind);
}
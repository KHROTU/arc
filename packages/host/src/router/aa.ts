export interface AAModel {
  name: string;
  slug: string;
  provider: string;
  score?: number;
}
export const AA_INTELLIGENCE: AAModel[] = [
  { name: "Claude Opus 5", slug: "claude-opus-5", provider: "Anthropic", score: 61 },
  { name: "Claude Fable 5", slug: "claude-fable-5", provider: "Anthropic", score: 60 },
  { name: "GPT-5.6 Sol", slug: "gpt-5-6-sol", provider: "OpenAI", score: 59 },
  { name: "Kimi K3", slug: "kimi-k3", provider: "Kimi", score: 57 },
  { name: "GPT-5.6 Terra", slug: "gpt-5-6-terra", provider: "OpenAI", score: 55 },
  { name: "Grok 4.5", slug: "grok-4-5", provider: "SpaceXAI", score: 54 },
  { name: "Claude Sonnet 5", slug: "claude-sonnet-5", provider: "Anthropic", score: 53 },
  { name: "GPT-5.6 Luna", slug: "gpt-5-6-luna", provider: "OpenAI", score: 51 },
  { name: "GLM-5.2", slug: "glm-5-2", provider: "Z AI", score: 51 },
  { name: "Muse Spark 1.1", slug: "muse-spark-1-1", provider: "Meta", score: 51 },
  { name: "Gemini 3.5 Flash", slug: "gemini-3-5-flash", provider: "Google", score: 50 },
  { name: "Gemini 3.6 Flash", slug: "gemini-3-6-flash", provider: "Google", score: 50 },
  { name: "DeepSeek V4 Flash 0731", slug: "deepseek-v4-flash-0731", provider: "DeepSeek", score: 50 },
  { name: "Gemini 3.1 Pro Preview", slug: "gemini-3-1-pro-preview", provider: "Google", score: 46 },
  { name: "Qwen3.7 Max", slug: "qwen3-7-max", provider: "Alibaba", score: 46 },
  { name: "MiniMax-M3", slug: "minimax-m3", provider: "MiniMax", score: 44 },
  { name: "DeepSeek V4 Pro", slug: "deepseek-v4-pro", provider: "DeepSeek", score: 44 },
  { name: "GPT-5.3 Codex", slug: "gpt-5-3-codex", provider: "OpenAI", score: 44 },
  { name: "Motif 3", slug: "motif-3", provider: "Motif Technologies", score: 44 },
  { name: "Muse Spark", slug: "muse-spark", provider: "Meta", score: 43 },
  { name: "MiMo-V2.5-Pro", slug: "mimo-v2-5-pro", provider: "Xiaomi", score: 42 },
  { name: "Kimi K2.7 Code", slug: "kimi-k2-7-code", provider: "Kimi", score: 42 },
  { name: "Hy3", slug: "hy3", provider: "Tencent", score: 41 },
  { name: "Nex-N2-Pro", slug: "nex-n2-pro", provider: "Nex AGI", score: 41 },
  { name: "Inkling", slug: "inkling", provider: "Thinking Machines", score: 41 },
  { name: "Inkling Small", slug: "inkling-small", provider: "Thinking Machines", score: 40 },
  { name: "Qwen3.6 Plus", slug: "qwen3-6-plus", provider: "Alibaba", score: 40 },
  { name: "Qwen3.7 Plus", slug: "qwen3-7-plus", provider: "Alibaba", score: 39 },
  { name: "JT-4.1 Flash 236B A21B", slug: "jt-4-1-flash-236b-a21b", provider: "China Mobile", score: 39 },
  { name: "Agnes 2.5 Pro Alpha", slug: "agnes-2-5-pro-alpha", provider: "Sapiens AI", score: 39 },
  { name: "Nemotron 3 Ultra", slug: "nemotron-3-ultra", provider: "NVIDIA", score: 38 },
  { name: "MiMo-V2.5", slug: "mimo-v2-5", provider: "Xiaomi", score: 37 },
  { name: "Qwen3.6 27B", slug: "qwen3-6-27b", provider: "Alibaba", score: 37 },
  { name: "Gemini 3.5 Flash-Lite", slug: "gemini-3-5-flash-lite", provider: "Google", score: 36 },
  { name: "MiMo-V2-Omni-0327", slug: "mimo-v2-omni-0327", provider: "Xiaomi", score: 36 },
  { name: "Grok 4.3", slug: "grok-4-3", provider: "SpaceXAI", score: 36 },
  { name: "MiMo-V2-Omni", slug: "mimo-v2-omni", provider: "Xiaomi", score: 35 },
  { name: "Kimi K2.6", slug: "kimi-k2-6", provider: "Kimi", score: 35 },
  { name: "Claude Sonnet 4.6", slug: "claude-sonnet-4-6", provider: "Anthropic", score: 34 },
  { name: "KAT-Coder-Pro V2", slug: "kat-coder-pro-v2", provider: "KwaiKAT", score: 34 },
  { name: "Qwen3.5 397B A17B", slug: "qwen3-5-397b-a17b", provider: "Alibaba", score: 34 },
  { name: "Hy3-preview", slug: "hy3-preview", provider: "Tencent", score: 34 },
  { name: "LongCat 2.0", slug: "longcat-2-0", provider: "LongCat", score: 33 },
  { name: "MiMo-V2-Flash", slug: "mimo-v2-flash", provider: "Xiaomi", score: 33 },
  { name: "Qwen3.5 122B A10B", slug: "qwen3-5-122b-a10b", provider: "Alibaba", score: 32 },
  { name: "Qwen3.6 35B A3B", slug: "qwen3-6-35b-a3b", provider: "Alibaba", score: 32 },
  { name: "G9v3-39A5B", slug: "g9v3-39a5b", provider: "AI9Stars", score: 31 },
  { name: "Qwen3.5 Omni Plus", slug: "qwen3-5-omni-plus", provider: "Alibaba", score: 31 },
  { name: "Ring-2.6-1T", slug: "ring-2-6-1t", provider: "InclusionAI", score: 31 },
  { name: "o3", slug: "o3", provider: "OpenAI", score: 30 },
  { name: "Step 3.7 Flash", slug: "step-3-7-flash", provider: "StepFun", score: 30 },
  { name: "Mistral Medium 3.5", slug: "mistral-medium-3-5", provider: "Mistral", score: 30 },
  { name: "Claude 4.5 Haiku", slug: "claude-4-5-haiku", provider: "Anthropic", score: 30 },
  { name: "Gemma 4 31B", slug: "gemma-4-31b", provider: "Google", score: 29 },
  { name: "GPT-5.5 Instant", slug: "gpt-5-5-instant", provider: "OpenAI", score: 29 },
  { name: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", provider: "DeepSeek", score: 29 },
  { name: "JT-35B-Flash", slug: "jt-35b-flash", provider: "China Mobile", score: 28 },
  { name: "KAT-Coder-Pro V1", slug: "kat-coder-pro-v1", provider: "KwaiKAT", score: 28 },
  { name: "Ling-2.6-1T", slug: "ling-2-6-1t", provider: "InclusionAI", score: 26 },
  { name: "Doubao Seed Code", slug: "doubao-seed-code", provider: "ByteDance Seed", score: 26 },
  { name: "Gemini 2.5 Pro", slug: "gemini-2-5-pro", provider: "Google", score: 26 },
  { name: "Gemma 4 26B A4B", slug: "gemma-4-26b-a4b", provider: "Google", score: 26 },
  { name: "NVIDIA Nemotron 3 Super", slug: "nvidia-nemotron-3-super", provider: "NVIDIA", score: 25 },
  { name: "Gemini 3.1 Flash-Lite", slug: "gemini-3-1-flash-lite", provider: "Google", score: 25 },
  { name: "Qwen3.5 35B A3B", slug: "qwen3-5-35b-a3b", provider: "Alibaba", score: 24 },
  { name: "gpt-oss-120b", slug: "gpt-oss-120b", provider: "OpenAI", score: 24 },
  { name: "Command A+", slug: "command-a", provider: "Cohere", score: 23 },
  { name: "K-EXAONE", slug: "k-exaone", provider: "LG AI Research", score: 22 },
  { name: "ERNIE 5.0 Thinking Preview", slug: "ernie-5-0-thinking-preview", provider: "Baidu", score: 22 },
  { name: "Gemma 4 12B", slug: "gemma-4-12b", provider: "Google", score: 22 },
  { name: "Nova 2.0 Pro Preview", slug: "nova-2-0-pro-preview", provider: "Amazon", score: 22 },
  { name: "Qwen3.5 9B", slug: "qwen3-5-9b", provider: "Alibaba", score: 21 },
  { name: "Mercury 2", slug: "mercury-2", provider: "Inception", score: 21 },
  { name: "Qwen3 Coder Next", slug: "qwen3-coder-next", provider: "Alibaba", score: 21 },
  { name: "Nova 2.0 Omni", slug: "nova-2-0-omni", provider: "Amazon", score: 21 },
  { name: "Apriel-v1.6-15B-Thinker", slug: "apriel-v1-6-15b-thinker", provider: "ServiceNow", score: 21 },
  { name: "EXAONE 4.5 33B", slug: "exaone-4-5-33b", provider: "LG AI Research", score: 20 },
  { name: "Qwen3.5 4B", slug: "qwen3-5-4b", provider: "Alibaba", score: 20 },
  { name: "North Mini Code", slug: "north-mini-code", provider: "Cohere", score: 20 },
  { name: "Mistral Small 4", slug: "mistral-small-4", provider: "Mistral", score: 20 },
  { name: "Devstral 2", slug: "devstral-2", provider: "Mistral", score: 19 },
  { name: "Nova 2.0 Lite", slug: "nova-2-0-lite", provider: "Amazon", score: 19 },
  { name: "Qwen3.5 Omni Flash", slug: "qwen3-5-omni-flash", provider: "Alibaba", score: 19 },
  { name: "JT-MINI", slug: "jt-mini", provider: "China Mobile", score: 19 },
  { name: "Trinity Large Thinking", slug: "trinity-large-thinking", provider: "Arcee AI", score: 18 },
  { name: "Magistral Medium 1.2", slug: "magistral-medium-1-2", provider: "Mistral", score: 18 },
  { name: "HyperNova 60B 2605", slug: "hypernova-60b-2605", provider: "Multiverse Computing", score: 18 },
  { name: "Nemotron Cascade 2 30B A3B", slug: "nemotron-cascade-2-30b-a3b", provider: "NVIDIA", score: 18 },
  { name: "Devstral Small 2", slug: "devstral-small-2", provider: "Mistral", score: 17 },
  { name: "K2 Think V2", slug: "k2-think-v2", provider: "MBZUAI Institute of Foundation Models", score: 17 },
  { name: "LongCat Flash Lite", slug: "longcat-flash-lite", provider: "LongCat", score: 17 },
  { name: "HyperCLOVA X SEED Think", slug: "hyperclova-x-seed-think", provider: "Naver", score: 17 },
  { name: "Qwen3 Next 80B A3B", slug: "qwen3-next-80b-a3b", provider: "Alibaba", score: 17 },
  { name: "Mi:dm K 2.5 Pro", slug: "mi-dm-k-2-5-pro", provider: "Korea Telecom", score: 16 },
  { name: "G9v3-3B", slug: "g9v3-3b", provider: "AI9Stars", score: 16 },
  { name: "Mistral Large 3", slug: "mistral-large-3", provider: "Mistral", score: 16 },
  { name: "INTELLECT-3", slug: "intellect-3", provider: "Prime Intellect", score: 16 },
  { name: "Solar Open 100B", slug: "solar-open-100b", provider: "Upstage", score: 15 },
  { name: "Nemotron 3 Nano Omni 30B A3B Reasoning", slug: "nemotron-3-nano-omni-30b-a3b-reasoning", provider: "NVIDIA", score: 15 },
  { name: "gpt-oss-20b", slug: "gpt-oss-20b", provider: "OpenAI", score: 15 },
  { name: "Llama 4 Maverick", slug: "llama-4-maverick", provider: "Meta", score: 14 },
  { name: "K2-V2", slug: "k2-v2", provider: "MBZUAI Institute of Foundation Models", score: 14 },
  { name: "NVIDIA Nemotron 3 Nano", slug: "nvidia-nemotron-3-nano", provider: "NVIDIA", score: 14 },
  { name: "Solar Pro 3", slug: "solar-pro-3", provider: "Upstage", score: 14 },
  { name: "Ling 2.6 Flash", slug: "ling-2-6-flash", provider: "InclusionAI", score: 14 },
  { name: "DiffusionGemma 26B A4B", slug: "diffusiongemma-26b-a4b", provider: "Google", score: 13 },
  { name: "Motif-2-12.7B", slug: "motif-2-12-7b", provider: "Motif Technologies", score: 13 },
  { name: "Nova Premier", slug: "nova-premier", provider: "Amazon", score: 13 },
  { name: "Llama Nemotron Super 49B v1.5", slug: "llama-nemotron-super-49b-v1-5", provider: "NVIDIA", score: 12 },
  { name: "Tri-21B-Think", slug: "tri-21b-think", provider: "Trillion Labs", score: 12 },
  { name: "Gemma 4 E4B", slug: "gemma-4-e4b", provider: "Google", score: 12 },
  { name: "MiniCPM5-1B", slug: "minicpm5-1b", provider: "OpenBMB", score: 12 },
  { name: "Sarvam 105B", slug: "sarvam-105b", provider: "Sarvam", score: 12 },
  { name: "Celeris-1", slug: "celeris-1", provider: "Celeris", score: 12 },
  { name: "Magistral Small 1.2", slug: "magistral-small-1-2", provider: "Mistral", score: 11 },
  { name: "Nanbeige4.1-3B", slug: "nanbeige4-1-3b", provider: "Nanbeige", score: 11 },
  { name: "Ministral 3 14B", slug: "ministral-3-14b", provider: "Mistral", score: 11 },
  { name: "EXAONE 4.0 32B", slug: "exaone-4-0-32b", provider: "LG AI Research", score: 11 },
  { name: "Llama 4 Scout", slug: "llama-4-scout", provider: "Meta", score: 10 },
  { name: "Hermes 4 70B", slug: "hermes-4-70b", provider: "Nous Research", score: 10 },
  { name: "Falcon-H1R-7B", slug: "falcon-h1r-7b", provider: "TII UAE", score: 10 },
  { name: "Gemma 4 E2B", slug: "gemma-4-e2b", provider: "Google", score: 10 },
  { name: "Qwen3 Omni 30B A3B", slug: "qwen3-omni-30b-a3b", provider: "Alibaba", score: 10 },
  { name: "Step3 VL 10B", slug: "step3-vl-10b", provider: "StepFun", score: 9 },
  { name: "Llama 3.3 70B", slug: "llama-3-3-70b", provider: "Meta", score: 9 },
  { name: "Llama Nemotron Ultra", slug: "llama-nemotron-ultra", provider: "NVIDIA", score: 9 },
  { name: "ERNIE 4.5 300B A47B", slug: "ernie-4-5-300b-a47b", provider: "Baidu", score: 9 },
  { name: "Hermes 4 405B", slug: "hermes-4-405b", provider: "Nous Research", score: 9 },
  { name: "NVIDIA Nemotron Nano 12B v2 VL", slug: "nvidia-nemotron-nano-12b-v2-vl", provider: "NVIDIA", score: 9 },
  { name: "Ministral 3 8B", slug: "ministral-3-8b", provider: "Mistral", score: 9 },
  { name: "Granite 4.1 30B", slug: "granite-4-1-30b", provider: "IBM", score: 9 },
  { name: "NVIDIA Nemotron Nano 9B V2", slug: "nvidia-nemotron-nano-9b-v2", provider: "NVIDIA", score: 9 },
  { name: "NVIDIA Nemotron 3 Nano 4B", slug: "nvidia-nemotron-3-nano-4b", provider: "NVIDIA", score: 9 },
  { name: "Kimi Linear 48B A3B Instruct", slug: "kimi-linear-48b-a3b-instruct", provider: "Kimi", score: 9 },
  { name: "Llama 3.1 405B", slug: "llama-3-1-405b", provider: "Meta", score: 9 },
  { name: "LFM2.5-8B-A1B", slug: "lfm2-5-8b-a1b", provider: "Liquid AI", score: 8 },
  { name: "Ring-flash-2.0", slug: "ring-flash-2-0", provider: "InclusionAI", score: 8 },
  { name: "Olmo 3.1 32B Think", slug: "olmo-3-1-32b-think", provider: "Allen Institute for AI", score: 8 },
  { name: "Command A", slug: "command-a", provider: "Cohere", score: 8 },
  { name: "Qwen3.5 2B", slug: "qwen3-5-2b", provider: "Alibaba", score: 8 },
  { name: "Llama 3.1 Nemotron 70B", slug: "llama-3-1-nemotron-70b", provider: "NVIDIA", score: 8 },
  { name: "Ministral 3 3B", slug: "ministral-3-3b", provider: "Mistral", score: 7 },
  { name: "Granite 4.1 8B", slug: "granite-4-1-8b", provider: "IBM", score: 7 },
  { name: "Sarvam 30B", slug: "sarvam-30b", provider: "Sarvam", score: 7 },
  { name: "Olmo 3.1 32B Instruct", slug: "olmo-3-1-32b-instruct", provider: "Allen Institute for AI", score: 6 },
  { name: "R1 1776", slug: "r1-1776", provider: "Perplexity", score: 6 },
  { name: "Llama 3.2 90B", slug: "llama-3-2-90b", provider: "Meta", score: 6 },
  { name: "Phi-4 Mini", slug: "phi-4-mini", provider: "Microsoft", score: 6 },
  { name: "Qwen3.5 0.8B", slug: "qwen3-5-0-8b", provider: "Alibaba", score: 5 },
  { name: "DeepHermes 3 - Mistral 24B", slug: "deephermes-3-mistral-24b", provider: "Nous Research", score: 5 },
  { name: "Jamba 1.7 Large", slug: "jamba-1-7-large", provider: "AI21 Labs", score: 5 },
  { name: "Granite 4.0 H Small", slug: "granite-4-0-h-small", provider: "IBM", score: 5 },
  { name: "LFM2 24B A2B", slug: "lfm2-24b-a2b", provider: "Liquid AI", score: 5 },
  { name: "Phi-4", slug: "phi-4", provider: "Microsoft", score: 5 },
  { name: "Nova Micro", slug: "nova-micro", provider: "Amazon", score: 5 },
  { name: "Granite 4.1 3B", slug: "granite-4-1-3b", provider: "IBM", score: 5 },
  { name: "Phi-4 Multimodal", slug: "phi-4-multimodal", provider: "Microsoft", score: 5 },
  { name: "MiniCPM-V 4.6 1.3B", slug: "minicpm-v-4-6-1-3b", provider: "OpenBMB", score: 4 },
  { name: "Jamba Reasoning 3B", slug: "jamba-reasoning-3b", provider: "AI21 Labs", score: 4 },
  { name: "Reka Flash 3", slug: "reka-flash-3", provider: "Reka AI", score: 4 },
  { name: "Olmo 3 7B Think", slug: "olmo-3-7b-think", provider: "Allen Institute for AI", score: 4 },
  { name: "Molmo 7B-D", slug: "molmo-7b-d", provider: "Allen Institute for AI", score: 4 },
  { name: "Ling-mini-2.0", slug: "ling-mini-2-0", provider: "InclusionAI", score: 4 },
  { name: "Llama 3.2 11B", slug: "llama-3-2-11b", provider: "Meta", score: 3 },
  { name: "Exaone 4.0 1.2B", slug: "exaone-4-0-1-2b", provider: "LG AI Research", score: 3 },
  { name: "Olmo 3 7B", slug: "olmo-3-7b", provider: "Allen Institute for AI", score: 3 },
  { name: "LFM2.5-1.2B-Thinking", slug: "lfm2-5-1-2b-thinking", provider: "Liquid AI", score: 3 },
  { name: "Jamba 1.7 Mini", slug: "jamba-1-7-mini", provider: "AI21 Labs", score: 3 },
  { name: "LFM2 2.6B", slug: "lfm2-2-6b", provider: "Liquid AI", score: 3 },
  { name: "LFM2.5-1.2B-Instruct", slug: "lfm2-5-1-2b-instruct", provider: "Liquid AI", score: 3 },
  { name: "Granite 4.0 H 1B", slug: "granite-4-0-h-1b", provider: "IBM", score: 3 },
  { name: "Gemma 3 270M", slug: "gemma-3-270m", provider: "Google", score: 2 },
  { name: "Apertus 70B Instruct", slug: "apertus-70b-instruct", provider: "Swiss AI Initiative", score: 2 },
  { name: "Granite 4.0 Micro", slug: "granite-4-0-micro", provider: "IBM", score: 2 },
  { name: "DeepHermes 3 - Llama-3.1 8B", slug: "deephermes-3-llama-3-1-8b", provider: "Nous Research", score: 2 },
  { name: "Granite 4.0 1B", slug: "granite-4-0-1b", provider: "IBM", score: 2 },
  { name: "Molmo2-8B", slug: "molmo2-8b", provider: "Allen Institute for AI", score: 2 },
  { name: "LFM2 8B A1B", slug: "lfm2-8b-a1b", provider: "Liquid AI", score: 2 },
  { name: "LFM2.5-VL-1.6B", slug: "lfm2-5-vl-1-6b", provider: "Liquid AI", score: 1 },
  { name: "Granite 4.0 350M", slug: "granite-4-0-350m", provider: "IBM", score: 1 },
  { name: "Tiny Aya Global", slug: "tiny-aya-global", provider: "Cohere", score: 1 },
  { name: "Apertus 8B Instruct", slug: "apertus-8b-instruct", provider: "Swiss AI Initiative", score: 1 },
  { name: "Granite 4.0 H 350M", slug: "granite-4-0-h-350m", provider: "IBM", score: 1 },
  { name: "Gemini 3 Deep Think", slug: "gemini-3-deep-think", provider: "Google" },
  { name: "Mi:dm K 2.5 Pro Preview", slug: "mi-dm-k-2-5-pro-preview", provider: "Korea Telecom" },
  { name: "GPT-5.5 Pro", slug: "gpt-5-5-pro", provider: "OpenAI" },
  { name: "Cogito v2.1", slug: "cogito-v2-1", provider: "Deep Cogito" },
];
const norm = (s: string): string => s.toLowerCase().replace(/[\s._:\-+()\/]+/g, "");
interface AAIndexEntry { entry: AAModel; key: string; tokens: string[] }
const AA_INDEX: AAIndexEntry[] = [];
for (const entry of AA_INTELLIGENCE) {
  if (entry.slug) AA_INDEX.push({ entry, key: norm(entry.slug), tokens: tokenSet(entry.slug) });
  AA_INDEX.push({ entry, key: norm(entry.name), tokens: tokenSet(entry.name) });
}
function tokenSet(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const hit = a.filter((t) => setB.has(t)).length;
  return hit / Math.max(a.length, b.length);
}
export interface AAMatch { entry: AAModel; confidence: number }
export function matchIntelligence(modelId: string, label?: string): AAMatch | undefined {
  const id = norm(modelId);
  const labelNorm = label ? norm(label) : "";
  for (const key of [id, labelNorm].filter(Boolean)) {
    const exact = AA_INDEX.find((x) => x.key === key);
    if (exact) return { entry: exact.entry, confidence: 1 };
  }
  for (const x of AA_INDEX) {
    if (x.key.length >= 4 && (id.includes(x.key) || x.key.includes(id))) {
      return { entry: x.entry, confidence: Math.min(x.key.length / Math.max(id.length, x.key.length), 1) };
    }
  }
  const labelTokens = label ? label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) : [];
  const idTokens = modelId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let best: AAMatch | undefined;
  for (const tokens of [labelTokens, idTokens]) {
    if (!tokens.length) continue;
    for (const x of AA_INDEX) {
      const c = tokenOverlap(tokens, x.tokens);
      if (c > 0.5 && (!best || c > best.confidence)) best = { entry: x.entry, confidence: c };
    }
    if (best) return best;
  }
  return undefined;
}
export function lookupIntelligence(modelId: string, label?: string): AAModel | undefined {
  return matchIntelligence(modelId, label)?.entry;
}
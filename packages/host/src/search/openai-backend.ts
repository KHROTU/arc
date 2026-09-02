import type { EmbeddingBackend, EmbeddingRequest, EmbeddingVector } from "./backend.js";
import { readBodyLimited } from "../security/network.js";
import { makeProxyDispatcher } from "../util/proxy.js";
export interface OpenAIEmbeddingOptions {
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
  proxyUrl?: string;
}
export class OpenAIEmbeddingBackend implements EmbeddingBackend {
  readonly id = "openai-compatible";
  readonly dim = 0;
  constructor(readonly model: string, private opts: OpenAIEmbeddingOptions = {}) {}
  async embed(req: EmbeddingRequest): Promise<EmbeddingVector[]> {
    const base = (this.opts.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    const input = Array.isArray(req.input) ? req.input : [req.input];
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    const init: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify({ model: req.model || this.model, input }),
      signal: this.opts.signal ?? AbortSignal.timeout(60_000),
    };
    if (this.opts.proxyUrl) (init as Record<string, unknown>).dispatcher = makeProxyDispatcher(this.opts.proxyUrl);
    const res = await fetch(`${base}/embeddings`, init);
    if (!res.ok) {
      const body = await readBodyLimited(res).catch((error) => (error as Error).message);
      throw new Error(`Embedding request returned ${res.status}: ${body.slice(0, 200)}`);
    }
    const j = JSON.parse(await readBodyLimited(res)) as { data?: { embedding?: number[] }[] };
    if (!j.data?.length) throw new Error("Embedding response missing 'data' array.");
    const out: EmbeddingVector[] = [];
    for (const d of j.data) {
      if (!d.embedding) throw new Error("Embedding response entry missing 'embedding' field.");
      out.push({ values: d.embedding, dim: d.embedding.length });
    }
    if (out.length !== input.length) throw new Error(`Embedding response count mismatch: ${out.length} != ${input.length}`);
    return out;
  }
}
import { describe, it, expect } from "vitest";
import { openAICompatibleTransport } from "../src/providers/openai-compatible";
import { anthropicTransport } from "../src/providers/anthropic";
import { ollamaTransport } from "../src/providers/ollama";
import type { ModelDescriptor, ProviderConfig, ChatMessage } from "../src/protocol/protocol";
function mkReq(): { model: ModelDescriptor; provider: ProviderConfig; messages: ChatMessage[] } {
  return {
    model: {
      id: "m1", label: "m1", tier: "default", contextWindow: 8000,
      costPer1mIn: 0, costPer1mOut: 0,
      providers: [{ id: "p1", kind: "openai-compatible", priority: 0 }],
    },
    provider: { id: "p1", kind: "openai-compatible", label: "p1", enabled: true, baseUrl: "https://example.invalid" },
    messages: [{ id: "u1", role: "user", content: "hi", ts: 0 }],
  };
}
function mockFetchOk(sseBody: string): typeof fetch {
  return (async () => new Response(sseBody, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })) as unknown as typeof fetch;
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
function mockFetchChunked(chunks: string[]): typeof fetch {
  return (async () => {
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (i >= chunks.length) { controller.close(); return; }
        await delay(5);
        controller.enqueue(new TextEncoder().encode(chunks[i++]));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
}
describe("transports end the stream cleanly", () => {
  it("openai-compatible: terminates the for-await after [DONE]", async () => {
    const real = globalThis.fetch;
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null}}]}',
      '',
      'data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}',
      '',
      'data: {"choices":[{"index":0,"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join("\n");
    globalThis.fetch = mockFetchOk(sse) as typeof fetch;
    try {
      const handle = await openAICompatibleTransport.stream(mkReq() as any);
      const events: any[] = [];
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("for-await did not terminate")), 1000));
      await Promise.race([
        (async () => { for await (const ev of handle.events) events.push(ev); })(),
        timeout,
      ]);
      const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
      expect(text).toBe("Hello world");
      expect(events.at(-1)?.type).toBe("done");
    } finally {
      globalThis.fetch = real;
    }
  });
  it("openai-compatible: survives chunk boundaries that split SSE separators", async () => {
    const real = globalThis.fetch;
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hel"}}]}\n',
      '\n',
      'data: {"choices":[{"index":0,"delta":{"content":"lo"}}]}\n',
      '\n',
      'data: {"choices":[{"index":0,"delta":{"content":',
      '" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    globalThis.fetch = mockFetchChunked(chunks);
    try {
      const handle = await openAICompatibleTransport.stream(mkReq() as any);
      const events: any[] = [];
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("for-await hung on a split SSE separator")), 2000));
      await Promise.race([
        (async () => { for await (const ev of handle.events) events.push(ev); })(),
        timeout,
      ]);
      const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
      expect(text).toBe("Hello world");
      expect(events.at(-1)?.type).toBe("done");
      expect(events.filter((e) => e.type === "done").length).toBe(1);
    } finally {
      globalThis.fetch = real;
    }
  });
  it("openai-compatible: terminates the for-await on mid-stream body error", async () => {
    const real = globalThis.fetch;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: "));
        controller.error(new Error("connection reset"));
      },
    });
    globalThis.fetch = (async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    try {
      const handle = await openAICompatibleTransport.stream(mkReq() as any);
      const events: any[] = [];
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("for-await did not terminate")), 1000));
      await Promise.race([
        (async () => { for await (const ev of handle.events) events.push(ev); })(),
        timeout,
      ]);
      expect(events.some((e) => e.type === "error")).toBe(true);
    } finally {
      globalThis.fetch = real;
    }
  });
  it("anthropic: terminates the for-await after message_stop", async () => {
    const real = globalThis.fetch;
    const sse = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}',
      '',
      'data: {"type":"content_block_start","content_block":{"type":"text","id":"tb1"}}',
      '',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
      '',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"message":{"usage":{"input_tokens":5,"output_tokens":2}}}',
      '',
      'data: {"type":"message_stop"}',
      '',
    ].join("\n");
    globalThis.fetch = mockFetchOk(sse) as typeof fetch;
    try {
      const req: any = { ...mkReq(), provider: { id: "p1", kind: "anthropic", label: "p1", enabled: true, baseUrl: "https://example.invalid" } };
      const handle = await anthropicTransport.stream!(req);
      const events: any[] = [];
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("for-await did not terminate")), 1000));
      await Promise.race([
        (async () => { for await (const ev of handle.events) events.push(ev); })(),
        timeout,
      ]);
      expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("hi");
      expect(events.at(-1)?.type).toBe("done");
    } finally {
      globalThis.fetch = real;
    }
  });
  it("ollama: terminates the for-await when j.done is true", async () => {
    const real = globalThis.fetch;
    const lines = [
      JSON.stringify({ message: { role: "assistant", content: "ok" }, done: false }),
      JSON.stringify({ message: { role: "assistant", content: "" }, done: true, prompt_eval_count: 3, eval_count: 1 }),
    ].join("\n");
    globalThis.fetch = mockFetchOk(lines) as typeof fetch;
    try {
      const req: any = { ...mkReq(), provider: { id: "p1", kind: "ollama", label: "p1", enabled: true, baseUrl: "http://127.0.0.1:11434" } };
      const handle = await ollamaTransport.stream!(req);
      const events: any[] = [];
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("for-await did not terminate")), 1000));
      await Promise.race([
        (async () => { for await (const ev of handle.events) events.push(ev); })(),
        timeout,
      ]);
      expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("ok");
      expect(events.at(-1)?.type).toBe("done");
    } finally {
      globalThis.fetch = real;
    }
  });
});
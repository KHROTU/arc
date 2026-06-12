import { AsyncEventQueue, readableToAsyncIterable } from "../util/stream.js";
import type { StreamEvent, StreamHandle, StreamRequest, Transport } from "./transport.js";
export const ollamaTransport: Transport = {
  kind: "ollama",
  async stream(req: StreamRequest): Promise<StreamHandle> {
    const base = (req.provider.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
    const remoteModel = req.model.providers.find((p) => p.id === req.provider.id)?.remoteModel ?? req.model.id;
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: remoteModel,
        stream: true,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    }
    const q = new AsyncEventQueue<StreamEvent>();
    let aborted = false;
    let buffer = "";
    const parseLine = (raw: string): boolean => {
      const t = raw.trim();
      if (!t) return false;
      try {
        const j = JSON.parse(t);
        if (j.message?.content) q.push({ type: "text", delta: j.message.content });
        if (j.message?.thinking) q.push({ type: "thinking", delta: j.message.thinking });
        if (j.done) {
          if (j.prompt_eval_count || j.eval_count) {
            q.push({
              type: "usage",
              usage: { prompt: j.prompt_eval_count ?? 0, completion: j.eval_count ?? 0, thinking: 0, cost: 0 },
            });
          }
          q.push({ type: "done" });
          return true;
        }
      } catch {
      }
      return false;
    };
    (async () => {
      try {
        for await (const chunk of readableToAsyncIterable(res.body as ReadableStream<Uint8Array>)) {
          if (aborted) break;
          buffer += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
          let idx: number;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (parseLine(line)) { q.close(); return; }
          }
        }
        parseLine(buffer);
      } catch (e) {
        if (!aborted) q.push({ type: "error", message: (e as Error).message });
      } finally {
        q.close();
      }
    })();
  return {
    events: q,
    abort: () => { aborted = true; q.close(); },
  };
  },
};
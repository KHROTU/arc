import { AsyncEventQueue, readableToAsyncIterable } from "../util/stream.js";
import { makeProxyDispatcher } from "../util/proxy.js";
import { fromApiToolName, toApiToolName, type StreamEvent, type StreamHandle, type StreamRequest, type Transport } from "./transport.js";
export const anthropicTransport: Transport = {
  kind: "anthropic",
  async stream(req: StreamRequest): Promise<StreamHandle> {
    const base = (req.provider.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
    const remoteModel = req.model.providers.find((p) => p.id === req.provider.id)?.remoteModel ?? req.model.id;
    const systemMsgs = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const conv = req.messages.filter((m) => m.role !== "system").map((m) => {
      if (m.role === "tool") return { role: "user" as const, content: [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }] };
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant" as const,
          content: [
            ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
            ...m.toolCalls.map((t) => ({ type: "tool_use" as const, id: t.id, name: toApiToolName(t.name), input: t.args })),
          ],
        };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    });
    const convWithImages = conv.map((c) => {
      if (c.role !== "user" || typeof c.content !== "string") return c;
      const orig = req.messages.find((m) => m.content === c.content && m.role === "user");
      const images = (orig as any)?.images as { image_url: { url: string } }[] | undefined;
      if (!images?.length) return c;
      const parts: unknown[] = [{ type: "text", text: c.content }];
      for (const img of images) {
        const match = img.image_url.url.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          parts.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
        }
      }
      return { role: "user", content: parts };
    });
    const body: Record<string, unknown> = {
      model: remoteModel,
      max_tokens: req.maxTokens ?? 4096,
      messages: convWithImages,
      stream: true,
    };
    if (systemMsgs) body.system = systemMsgs;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: toApiToolName(t.name),
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": req.provider.apiKey ?? "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
      ...(req.proxyUrl ? { dispatcher: makeProxyDispatcher(req.proxyUrl) } : {}),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic returned ${res.status}: ${text.slice(0, 200)}`);
    }
    const q = new AsyncEventQueue<StreamEvent>();
    let aborted = false;
    void (async () => {
      let buffer = "";
      const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
      try {
        for await (const chunk of readableToAsyncIterable(res.body as ReadableStream<Uint8Array>)) {
          if (aborted) break;
          buffer += chunk;
          let idx: number;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload) as {
                type: string;
                index?: number;
                delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string };
                content_block?: { type: string; name?: string; id?: string };
                message?: { usage?: { input_tokens: number; output_tokens: number } };
              };
              if (j.type === "content_block_start" && j.content_block) {
                if (j.content_block.type === "tool_use" && typeof j.index === "number") {
                  toolBlocks.set(j.index, {
                    id: j.content_block.id ?? `tc-${Date.now()}`,
                    name: j.content_block.name ?? "tool",
                    json: "",
                  });
                }
              } else if (j.type === "content_block_delta" && j.delta) {
                if (j.delta.type === "text_delta" && j.delta.text) {
                  q.push({ type: "text", delta: j.delta.text });
                } else if (j.delta.type === "thinking_delta" && j.delta.thinking) {
                  q.push({ type: "thinking", delta: j.delta.thinking });
                } else if (j.delta.type === "input_json_delta" && typeof j.index === "number" && typeof j.delta.partial_json === "string") {
                  const blk = toolBlocks.get(j.index);
                  if (blk) blk.json += j.delta.partial_json;
                }
              } else if (j.type === "content_block_stop" && typeof j.index === "number") {
                const blk = toolBlocks.get(j.index);
                if (blk) {
                  let args: Record<string, unknown> = {};
try { args = blk.json ? JSON.parse(blk.json) : {}; } catch { console.debug("Anthropic stream: failed to parse tool args JSON", blk.json?.slice(0, 200)); }
                  q.push({ type: "tool_call", id: blk.id, name: fromApiToolName(blk.name), args });
                  toolBlocks.delete(j.index);
                }
              } else if (j.type === "message_delta" && j.message?.usage) {
                q.push({ type: "usage", usage: { prompt: j.message.usage.input_tokens ?? 0, completion: j.message.usage.output_tokens ?? 0, thinking: 0, cost: 0 } });
              } else if (j.type === "message_stop") {
                q.push({ type: "done" });
                q.close();
                return;
              }
} catch { console.debug("Anthropic stream: failed to parse event", payload.slice(0, 200)); }
          }
        }
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
import { AsyncEventQueue, readableToAsyncIterable } from "../util/stream.js";
import { makeProxyDispatcher } from "../util/proxy.js";
import { fromApiToolName, toApiToolName, type StreamEvent, type StreamHandle, type StreamRequest, type Transport } from "./transport.js";
import { withRetry, policyFor } from "./retry.js";
const ANTHROPIC_EFFORT: Record<string, string | undefined> = {
  none: undefined,
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};
type ContentBlock = Record<string, unknown>;
const ENV_SPLIT_MARKER = "\n\n---\n\n## Environment\n";
function splitSystemForCache(system: string): ContentBlock[] {
  const idx = system.lastIndexOf(ENV_SPLIT_MARKER);
  if (idx <= 0) {
    return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  }
  const staticPart = system.slice(0, idx);
  const volatilePart = system.slice(idx);
  return [
    { type: "text", text: staticPart, cache_control: { type: "ephemeral" } },
    { type: "text", text: volatilePart },
  ];
}
function markCacheControl(content: unknown): unknown {
  if (typeof content === "string") {
    return [{ type: "text", text: content, cache_control: { type: "ephemeral" } }];
  }
  if (Array.isArray(content) && content.length > 0) {
    const copy = content.slice();
    copy[copy.length - 1] = { ...(copy[copy.length - 1] as ContentBlock), cache_control: { type: "ephemeral" } };
    return copy;
  }
  return content;
}
export function applyPromptCaching(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  if (Array.isArray(out.tools) && out.tools.length > 0) {
    const tools = (out.tools as ContentBlock[]).slice();
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: "ephemeral" } };
    out.tools = tools;
  }
  if (typeof out.system === "string" && out.system) {
    out.system = splitSystemForCache(out.system);
  }
  if (Array.isArray(out.messages) && out.messages.length > 1) {
    const messages = (out.messages as { role: string; content: unknown }[]).slice();
    const cutIdx = messages.length - 2;
    messages[cutIdx] = { ...messages[cutIdx], content: markCacheControl(messages[cutIdx].content) };
    out.messages = messages;
  }
  return out;
}
export const anthropicTransport: Transport = {
  kind: "anthropic",
  async stream(req: StreamRequest): Promise<StreamHandle> {
    const base = (req.provider.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
    const remoteModel = req.model.providers.find((p) => p.id === req.provider.id)?.remoteModel ?? req.model.id;
    const systemMsgs = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const conv = req.messages.filter((m) => m.role !== "system").map((m) => {
      if (m.role === "tool") {
        const content: unknown[] = [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }];
        const images = (m as any).images as { image_url: { url: string } }[] | undefined;
        if (images?.length) {
          for (const img of images) {
            const match = img.image_url.url.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) content.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
          }
        }
        return { role: "user" as const, content };
      }
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
      const orig = req.messages.find((m) => m.content === c.content && (m.role === "user" || m.role === "tool"));
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
    if (req.reasoningEffort) {
      const anthropicEff = ANTHROPIC_EFFORT[req.reasoningEffort];
      if (anthropicEff) {
        body.output_config = { effort: anthropicEff };
      } else {
        body.thinking = { type: "disabled" };
      }
    }
    const cachedBody = applyPromptCaching(body);
    const res = await withRetry(
      () => fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": req.provider.apiKey ?? "",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(cachedBody),
        signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
        ...(req.proxyUrl ? { dispatcher: makeProxyDispatcher(req.proxyUrl) } : {}),
      }),
      policyFor(req.provider.kind),
    );
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
import { AsyncEventQueue, readableToAsyncIterable } from "../util/stream.js";
import { fromApiToolName, toApiToolName, type StreamEvent, type StreamHandle, type StreamRequest, type Transport } from "./transport.js";
export const openAICompatibleTransport: Transport & { withBase: (base: string) => Transport } = {
  kind: "openai",
  withBase(base) {
    return { kind: this.kind, stream: (req) => streamWithBase(req, base) };
  },
  stream(req) {
    return streamWithBase(req, "");
  },
};
async function streamWithBase(req: StreamRequest, baseOverride: string): Promise<StreamHandle> {
  const base = baseOverride || req.provider.baseUrl || "https://api.openai.com/v1";
  const remoteModel = req.model.providers.find((p) => p.id === req.provider.id)?.remoteModel ?? req.model.id;
  const hasThinking = req.messages.some((m) => m.role === "assistant" && m.thinking);
  const body: Record<string, unknown> = {
    model: remoteModel,
    stream: true,
    temperature: req.temperature ?? 0.2,
    messages: req.messages.map((m) => toOpenAIMessage(m)),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: toApiToolName(t.name), description: t.description, parameters: t.parameters },
    }));
  }
  if (hasThinking) {
    body.reasoning_effort = "high";
    body.thinking = { type: "enabled" };
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (req.provider.apiKey) headers.authorization = `Bearer ${req.provider.apiKey}`;
  if (req.provider.kind === "openrouter") {
    headers["http-referer"] = "https://arc.dev";
    headers["x-openrouter-title"] = "Arc";
  } else {
    headers["x-title"] = "Arc";
  }
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Provider ${req.provider.kind} returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const q = new AsyncEventQueue<StreamEvent>();
  let aborted = false;
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  const flushToolCalls = () => {
    for (const entry of toolAcc.values()) {
      if (!entry.name) continue;
      q.push({
        type: "tool_call",
        id: entry.id,
        name: fromApiToolName(entry.name),
        args: safeParseArgs(entry.args) ?? {},
      });
    }
    toolAcc.clear();
  };
  void (async () => {
    let buffer = "";
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
          if (payload === "[DONE]") {
            flushToolCalls();
            q.push({ type: "done" });
            q.close();
            return;
          }
          try {
            const json = JSON.parse(payload);
            const choice = json.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta ?? {};
            if (delta.content) q.push({ type: "text", delta: delta.content });
            if (delta.reasoning_content) q.push({ type: "thinking", delta: delta.reasoning_content });
            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const key = typeof tc.index === "number" ? tc.index : 0;
                let entry = toolAcc.get(key);
                if (!entry) { entry = { id: tc.id ?? `call_${key}`, name: "", args: "" }; toolAcc.set(key, entry); }
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.name = tc.function.name;
                if (typeof tc.function?.arguments === "string") entry.args += tc.function.arguments;
              }
            }
            if (choice.finish_reason === "tool_calls") flushToolCalls();
            if (json.usage) {
              q.push({
                type: "usage",
                usage: {
                  prompt: json.usage.prompt_tokens ?? 0,
                  completion: json.usage.completion_tokens ?? 0,
                  thinking: 0,
                  cost: 0,
                },
              });
            }
          } catch {
          }
        }
      }
    } catch (e) {
      if (!aborted) q.push({ type: "error", message: (e as Error).message });
    } finally {
      if (!aborted) flushToolCalls();
      q.close();
    }
  })();
  return {
    events: q,
    abort: () => {
      aborted = true;
      q.close();
    },
  };
}
function safeParseArgs(s: string | undefined): Record<string, unknown> | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
function toOpenAIMessage(m: import("../protocol/protocol.js").ChatMessage) {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    const msg: Record<string, unknown> = { role: "assistant" };
    msg.reasoning_content = m.thinking || "";
    msg.content = m.content;
    msg.tool_calls = m.toolCalls.map((t) => ({
      id: t.id,
      type: "function",
      function: { name: toApiToolName(t.name), arguments: JSON.stringify(t.args) },
    }));
    return msg;
  }
  if (m.role === "assistant" && m.thinking) {
    return { role: "assistant", reasoning_content: m.thinking, content: m.content };
  }
  return { role: m.role, content: m.content };
}
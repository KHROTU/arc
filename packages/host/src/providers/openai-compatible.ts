import { AsyncEventQueue, readableToAsyncIterable } from "../util/stream.js";
import { makeProxyDispatcher } from "../util/proxy.js";
import { fromApiToolName, toApiToolName, type StreamEvent, type StreamHandle, type StreamRequest, type Transport } from "./transport.js";
import { caps } from "./capability-tracker.js";
import { withRetry, policyFor } from "./retry.js";
const UNSUPPORTED_PARAM_RE = /does not support|unsupported.*param(?:eter)?|unknown.*param(?:eter)?|invalid.*param(?:eter)?/i;
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
  const modelKey = `${req.provider.id}:${remoteModel}`;
  const hasThinking = req.messages.some((m) => m.role === "assistant" && m.thinking);
  const effortLevels: Record<string, string> = { none: "none", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" };
  const eff = req.reasoningEffort ? effortLevels[req.reasoningEffort] : undefined;
  const buildBody = (skipReasoning: boolean): Record<string, unknown> => {
    const wantsThink = hasThinking && !skipReasoning && caps.isSupported(modelKey, "thinking");
    const wantsEffort = !skipReasoning && eff && caps.isSupported(modelKey, "reasoning_effort");
    const body: Record<string, unknown> = {
      model: remoteModel,
      stream: true,
      temperature: req.temperature ?? 0.2,
      messages: req.messages.map((m) => toOpenAIMessage(m, wantsThink, req.provider.kind)),
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: toApiToolName(t.name), description: t.description, parameters: t.parameters },
      }));
    }
    if (req.provider.kind === "openrouter" && (wantsEffort || wantsThink)) {
      body.reasoning = {
        ...(wantsEffort && eff ? { effort: eff } : {}),
        enabled: true,
        exclude: false,
      };
    } else if (wantsEffort) {
      if (req.provider.kind === "google") {
        body.thinking_level = eff;
      } else {
        body.reasoning_effort = eff;
      }
      body.thinking = { type: "enabled" };
    } else if (wantsThink) {
      body.reasoning_effort = "high";
      body.thinking = { type: "enabled" };
    }
    return body;
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (req.provider.apiKey) headers.authorization = `Bearer ${req.provider.apiKey}`;
  if (req.provider.kind === "openrouter") {
    headers["http-referer"] = "https://github.com/KHROTU/arc";
    headers["x-openrouter-title"] = "Arc";
  } else {
    headers["x-title"] = "Arc";
  }
  const MAX_ATTEMPTS = 2;
  const policy = policyFor(req.provider.kind);
  let res!: Response;
  let lastText = "";
  let skipReasoning = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const body = buildBody(skipReasoning);
    res = await withRetry(
      () => fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
        ...(req.proxyUrl ? { dispatcher: makeProxyDispatcher(req.proxyUrl) } : {}),
      }),
      policy,
    );
    if (!res.ok) lastText = await res.text().catch(() => "");
    if (res.ok && res.body) break;
    if (res.status === 400 && UNSUPPORTED_PARAM_RE.test(lastText)) {
      if (eff && lastText.includes("reasoning_effort")) {
        caps.markUnsupported(modelKey, "reasoning_effort");
        skipReasoning = true;
        continue;
      }
      if (lastText.includes("thinking_level")) {
        caps.markUnsupported(modelKey, "reasoning_effort");
        skipReasoning = true;
        continue;
      }
      caps.markUnsupported(modelKey, "thinking");
      skipReasoning = true;
      continue;
    }
    if (!res.ok) throw new Error(`Provider ${req.provider.kind} returned ${res.status}: ${lastText.slice(0, 200)}`);
  }
  if (!res!.ok || !res!.body) {
    throw new Error(`Provider ${req.provider.kind} returned ${res!.status}: ${lastText.slice(0, 200)}`);
  }
  const q = new AsyncEventQueue<StreamEvent>();
  let aborted = false;
  let lastUsage: { prompt: number; completion: number; thinking: number; cost: number } | undefined;
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
    let inThink = false;
    let thinkingBuf = "";
    const reasoningDetailTextById = new Map<string, string>();
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
            if (lastUsage) { q.push({ type: "usage", usage: lastUsage }); lastUsage = undefined; }
            q.push({ type: "done" });
            q.close();
            return;
          }
          try {
            const json = JSON.parse(payload);
            const choice = json.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta ?? {};
            const emitReasoningFromDetails = (): string => {
              if (!Array.isArray(delta.reasoning_details)) return "";
              let out = "";
              for (let i = 0; i < delta.reasoning_details.length; i++) {
                const d = delta.reasoning_details[i];
                if (typeof d === "string") {
                  out += d;
                  continue;
                }
                const text = typeof d?.text === "string"
                  ? d.text
                  : typeof d?.reasoning === "string"
                    ? d.reasoning
                    : "";
                if (!text) continue;
                const baseId = typeof d?.id === "string" && d.id
                  ? d.id
                  : `${d?.index ?? i}`;
                const id = baseId;
                const prev = reasoningDetailTextById.get(id) ?? "";
                let deltaText = text;
                if (prev && text.startsWith(prev)) {
                  deltaText = text.slice(prev.length);
                } else if (prev && prev.startsWith(text)) {
                  deltaText = "";
                }
                reasoningDetailTextById.set(id, text);
                if (deltaText) out += deltaText;
              }
              return out;
            };
            const detailsThinking = emitReasoningFromDetails();
            const contentThinking = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
            const plainThinking = typeof delta.reasoning === "string" ? delta.reasoning : "";
            const structuredThinking = detailsThinking || contentThinking || plainThinking;
            if (structuredThinking) q.push({ type: "thinking", delta: structuredThinking });
            if (delta.content) {
              //nodel if you're one of these fuckwit providers that use think tags then truly go fuck yourself
              const text = delta.content as string;
              let s = text;
              while (s) {
                if (inThink) {
                  const ei = s.indexOf("</think>");
                  if (ei >= 0) {
                    thinkingBuf += s.slice(0, ei);
                    const trimmed = thinkingBuf.trim();
                    if (trimmed && !structuredThinking) q.push({ type: "thinking", delta: trimmed });
                    thinkingBuf = "";
                    s = s.slice(ei + 8).trimStart();
                    inThink = false;
                  } else {
                    thinkingBuf += s;
                    s = "";
                  }
                } else {
                  const si = s.indexOf("<think>");
                  if (si >= 0) {
                    if (si > 0) q.push({ type: "text", delta: s.slice(0, si) });
                    s = s.slice(si + 7).trimStart();
                    inThink = true;
                  } else {
                    q.push({ type: "text", delta: s });
                    s = "";
                  }
                }
              }
            }
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
              lastUsage = {
                prompt: json.usage.prompt_tokens ?? 0,
                completion: json.usage.completion_tokens ?? 0,
                thinking: 0,
                cost: 0,
              };
            }
          } catch {
          }
        }
      }
    } catch (e) {
      if (!aborted) q.push({ type: "error", message: (e as Error).message });
    } finally {
      if (!aborted) {
        flushToolCalls();
        if (lastUsage) q.push({ type: "usage", usage: lastUsage });
      }
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
function toOpenAIMessage(m: import("../protocol/protocol.js").ChatMessage, supportsThinking: boolean, providerKind?: import("../protocol/protocol.js").ProviderKind) {
  if (m.role === "tool") {
    const images = (m as any).images as { type: string; image_url: { url: string } }[] | undefined;
    const toolCallId = (m.toolCallId ?? "").trim();
    if (!toolCallId) {
      const content = providerKind === "openrouter"
        ? `Tool output (without tool_call_id):\n${m.content}`
        : m.content;
      return images?.length
        ? { role: "user", content: [{ type: "text", text: content }, ...images.map((img) => ({ type: "image_url", image_url: img.image_url }))] }
        : { role: "user", content };
    }
    return images?.length
      ? { role: "tool", tool_call_id: toolCallId, content: [{ type: "text", text: m.content }, ...images.map((img) => ({ type: "image_url", image_url: img.image_url }))] }
      : { role: "tool", tool_call_id: toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls?.length) {
    const msg: Record<string, unknown> = { role: "assistant" };
    if (supportsThinking && m.thinking) msg.reasoning_content = m.thinking;
    msg.content = m.content;
    msg.tool_calls = m.toolCalls.map((t) => ({
      id: t.id,
      type: "function",
      function: { name: toApiToolName(t.name), arguments: JSON.stringify(t.args) },
    }));
    return msg;
  }
  if (m.role === "assistant" && m.thinking) {
    if (supportsThinking) return { role: "assistant", reasoning_content: m.thinking, content: m.content };
    return { role: "assistant", content: m.content };
  }
  const images = (m as any).images as { type: string; image_url: { url: string } }[] | undefined;
  if (m.role === "user" && images?.length) {
    return {
      role: m.role,
      content: [
        { type: "text", text: m.content },
        ...images.map((img) => ({ type: "image_url", image_url: img.image_url })),
      ],
    };
  }
  return { role: m.role, content: m.content };
}